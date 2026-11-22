"""Regras dos cofres usadas pela API: criar, entrar, dados, conta e e-mail.

As rotas HTTP só traduzem; tudo que decide fica aqui (e é testado sem servidor).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.services import backup, mailer
from app.vaults import crypto, models, registry, store
from app.vaults.sessions import LOGIN_THROTTLE, MAIL_LIMIT, SESSIONS, Session

log = logging.getLogger(__name__)


class ServiceError(store.VaultError):
    """Erro com código para a interface. ``retry_after`` em segundos quando houver espera."""

    def __init__(
        self,
        code: str,
        message: str = "",
        *,
        retry_after: int | None = None,
        revision: int | None = None,
    ):
        super().__init__(code, message)
        self.retry_after = retry_after
        self.revision = revision


# ---------------------------------------------------------------- entrar e sair


def _check_throttle(vault_id: str) -> None:
    wait = LOGIN_THROTTLE.wait_seconds(vault_id)
    if wait > 0:
        raise ServiceError("throttled", "Muitas tentativas. Espere um pouco.", retry_after=wait)


def _verify(vault_id: str, owner: store.Owner, password: str) -> bytes:
    """Confere a senha e devolve a chave de dados. Erros contam para o limite de tentativas."""
    _check_throttle(vault_id)
    if not crypto.verify_password(password, owner.password_hash):
        LOGIN_THROTTLE.fail(vault_id)
        raise ServiceError("bad-password", "Senha incorreta.")
    try:
        key = crypto.unwrap_key(owner.key_wrap, password, vault_id)
    except crypto.CryptoError as exc:  # pragma: no cover - só se o arquivo foi adulterado
        raise ServiceError("corrupted", "A chave do cofre está danificada.") from exc
    LOGIN_THROTTLE.success(vault_id)
    return key


def _open_for_login(vault_id: str) -> Path:
    path = registry.path_for(vault_id)
    state = registry.status(path)
    if state == "error":
        raise ServiceError("unreadable", "Não foi possível ler este cofre.")
    if state == "too-new":
        raise ServiceError("too-new", "Este cofre foi criado por uma versão mais nova do Lume.")
    _check_throttle(vault_id)
    return path


def _migrate_if_needed(vault_id: str, path: Path) -> None:
    """Atualiza o formato do arquivo (com backup antes). Só depois de conferir a senha."""
    with store.connect(path) as conn:
        if store.schema_version(conn) < store.SCHEMA_VERSION:
            backup.create_backup(
                "pre-migration",
                db_path=path,
                backups_dir=registry.vault_backups_dir(vault_id),
                extra_dir=_extra_dir(vault_id),
            )
            store.migrate(conn)


def _fail_login(vault_id: str) -> ServiceError:
    LOGIN_THROTTLE.fail(vault_id)
    wait = LOGIN_THROTTLE.wait_seconds(vault_id)
    return ServiceError("bad-credentials", "E-mail ou senha incorretos.", retry_after=wait or None)


def login(vault_id: str, email: str, password: str) -> Session:
    path = _open_for_login(vault_id)
    # O dono está no formato desde a v1: dá para conferir a senha antes de migrar o arquivo.
    with store.connect(path, readonly=True) as conn:
        owner = store.read_owner(conn)
    # Confere a senha mesmo com e-mail errado: o tempo de resposta não revela qual dos dois errou.
    password_ok = crypto.verify_password(password, owner.password_hash)
    email_ok = registry.normalize_email(email) == registry.normalize_email(owner.email)
    if not (password_ok and email_ok):
        raise _fail_login(vault_id)
    try:
        key = crypto.unwrap_key(owner.key_wrap, password, vault_id)
    except crypto.CryptoError as exc:  # pragma: no cover - só se o arquivo foi adulterado
        raise ServiceError("corrupted", "A chave do cofre está danificada.") from exc
    LOGIN_THROTTLE.success(vault_id)
    _migrate_if_needed(vault_id, path)
    registry.touch_opened(vault_id)
    log.info("Cofre %s aberto", vault_id)
    return SESSIONS.create(vault_id, owner.id, key)


def create(
    *,
    name: str,
    first_name: str,
    last_name: str,
    email: str,
    password: str,
    data: dict[str, Any] | None,
    settings: dict[str, Any] | None,
) -> tuple[Session, str]:
    """Cria o cofre e já abre a sessão. Devolve também o código de recuperação (só agora)."""
    state = models.DataState.model_validate(data) if data is not None else None
    patch = models.SettingsPatch.model_validate(settings) if settings else None
    created = registry.create_vault(
        name=name,
        first_name=first_name,
        last_name=last_name,
        email=email,
        password=password,
        data=state,
        settings=patch,
    )
    session = SESSIONS.create(created.vault_id, created.owner.id, created.data_key)
    return session, created.recovery_code


def recover(vault_id: str, email: str, code: str, new_password: str) -> tuple[Session, str]:
    """Esqueceu a senha: e-mail + código de recuperação definem uma senha nova.

    A chave de dados é a mesma (aberta pelo código), então nada se perde, nem a senha do
    e-mail de envio. O código usado é trocado por um novo, mostrado uma vez.
    """
    registry.validate_password(new_password)
    path = _open_for_login(vault_id)
    with store.connect(path, readonly=True) as conn:
        owner = store.read_owner(conn)
    # Mesma regra da entrada: confere o código mesmo com e-mail errado.
    code_ok = bool(owner.recovery_wrap) and crypto.verify_recovery_code(
        code, owner.recovery_hash or ""
    )
    email_ok = registry.normalize_email(email) == registry.normalize_email(owner.email)
    if not (code_ok and email_ok):
        LOGIN_THROTTLE.fail(vault_id)
        wait = LOGIN_THROTTLE.wait_seconds(vault_id)
        raise ServiceError("bad-recovery", "E-mail ou código incorretos.", retry_after=wait or None)
    try:
        key = crypto.unwrap_key_with_code(owner.recovery_wrap or "", code, vault_id)
    except crypto.CryptoError as exc:  # pragma: no cover - só se o arquivo foi adulterado
        raise ServiceError("corrupted", "A chave do cofre está danificada.") from exc
    LOGIN_THROTTLE.success(vault_id)
    _migrate_if_needed(vault_id, path)
    backup.create_backup(
        "before-recovery",
        db_path=path,
        backups_dir=registry.vault_backups_dir(vault_id),
        extra_dir=_extra_dir(vault_id),
        apply_policy=False,
    )
    now = store.utcnow()
    new_code, recovery = registry.recovery_fields(key, vault_id, now)
    with store.connect(path) as conn:
        store.update_owner(
            conn,
            password_hash=crypto.hash_password(new_password),
            key_wrap=crypto.wrap_key(key, new_password, vault_id),
            password_changed_at=now,
            **recovery,
        )
    SESSIONS.revoke_vault(vault_id)
    registry.touch_opened(vault_id)
    log.info("Cofre %s: senha redefinida com o código de recuperação", vault_id)
    return SESSIONS.create(vault_id, owner.id, key), new_code


def new_recovery_code(session: Session, current_password: str) -> str:
    """Gera outro código de recuperação (o anterior deixa de valer). Pede a senha atual."""
    path = _path(session)
    with store.connect(path) as conn:
        owner = store.read_owner(conn)
        _verify(session.vault_id, owner, current_password)
        code, recovery = registry.recovery_fields(
            session.data_key, session.vault_id, store.utcnow()
        )
        store.update_owner(conn, **recovery)
    return code


def confirm_recovery_code(session: Session) -> dict[str, Any]:
    """O dono confirmou que guardou o código."""
    with store.connect(_path(session)) as conn:
        owner = store.read_owner(conn)
        if owner.recovery_wrap:
            owner = store.update_owner(conn, recovery_confirmed_at=store.utcnow())
    return owner.public()["recovery"]


def logout(token: str | None) -> None:
    SESSIONS.revoke(token)


def _extra_dir(vault_id: str):  # noqa: ANN202 - Path | None
    from app.core.config import get_settings

    extra = get_settings().backup_extra_dir
    return extra / "cofres" / vault_id if extra else None


# ---------------------------------------------------------------- o que a interface carrega


def _path(session: Session):  # noqa: ANN202 - Path
    try:
        return registry.path_for(session.vault_id)
    except registry.RegistryError as exc:
        SESSIONS.revoke(session.token)
        raise ServiceError("unauthenticated", "O cofre não está mais disponível.") from exc


def session_info(session: Session) -> dict[str, Any]:
    path = _path(session)
    with store.connect(path, readonly=True) as conn:
        owner = store.read_owner(conn)
        settings = store.read_settings(conn)
        rev = store.revision(conn)
    return {
        "vault": registry.summary(path).public(),
        "account": owner.public(),
        "settings": settings,
        "revision": rev,
    }


def load_data(session: Session) -> dict[str, Any]:
    with store.connect(_path(session), readonly=True) as conn:
        revision, data = store.read_snapshot(conn)
        return {"revision": revision, "data": data}


def apply_changes(session: Session, payload: dict[str, Any]) -> int:
    changes = models.Changes.model_validate(payload)
    path = _path(session)
    if changes.checkpoint:
        _checkpoint(session.vault_id, path, changes.checkpoint)
    with store.connect(path) as conn:
        try:
            return store.apply_changes(conn, changes)
        except store.RevisionConflict as exc:
            raise ServiceError(
                "conflict", "Os dados mudaram em outra janela.", revision=exc.current
            ) from exc
        except store.InvalidData as exc:
            raise ServiceError("invalid", str(exc)) from exc


def _checkpoint(vault_id: str, path: Path, reason: str) -> None:
    """Cópia verificada do cofre antes de trocar os dados de uma vez.

    Restaurar um backup, carregar o exemplo e apagar tudo podem ser desfeitos na tela só por
    alguns segundos; esta cópia fica na pasta de backups do cofre (com a retenção de sempre: as 3
    mais recentes ficam). Sem a cópia, nada é gravado.
    """
    try:
        backup.create_backup(
            reason,
            db_path=path,
            backups_dir=registry.vault_backups_dir(vault_id),
            extra_dir=_extra_dir(vault_id),
        )
    except backup.BackupError as exc:
        log.warning("Cópia antes de %s falhou: %s", reason, exc)
        raise ServiceError(
            "storage",
            "Não deu para guardar uma cópia do cofre antes de trocar os dados. Nada foi alterado.",
        ) from exc


def vault_backups(session: Session) -> dict[str, Any]:
    """Backups do cofre aberto: quantos há e o mais recente (para Configurações)."""
    _path(session)
    found = backup.list_backups(registry.vault_backups_dir(session.vault_id))
    latest = found[0] if found else None
    return {
        "count": len(found),
        "latest": {
            "createdAt": latest.created_at.isoformat(timespec="seconds"),
            "reason": latest.reason,
        }
        if latest
        else None,
    }


def update_settings(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    patch = models.SettingsPatch.model_validate(payload)
    with store.connect(_path(session)) as conn:
        return store.write_settings(conn, patch)


def rename(session: Session, name: str) -> dict[str, Any]:
    return registry.rename_vault(session.vault_id, name).public()


def delete_vault(session: Session, password: str) -> None:
    path = _path(session)
    with store.connect(path, readonly=True) as conn:
        owner = store.read_owner(conn)
    _verify(session.vault_id, owner, password)
    backup.create_backup(
        "before-delete",
        db_path=path,
        backups_dir=registry.vault_backups_dir(session.vault_id),
        extra_dir=_extra_dir(session.vault_id),
        apply_policy=False,
    )
    SESSIONS.revoke_vault(session.vault_id)
    registry.move_to_trash(session.vault_id)


# ---------------------------------------------------------------- minha conta


def account(session: Session) -> dict[str, Any]:
    with store.connect(_path(session), readonly=True) as conn:
        owner = store.read_owner(conn)
        mail = store.read_mail(conn)
    return {**owner.public(), "mail": _mail_public(mail)}


#: Valor de ``photo`` que mantém a foto atual (o perfil pode ser salvo sem mexer na foto).
KEEP_PHOTO: Any = object()


def update_account(
    session: Session,
    *,
    first_name: str,
    last_name: str,
    email: str,
    photo: str | None = KEEP_PHOTO,
    current_password: str | None = None,
) -> dict[str, Any]:
    path = _path(session)
    first_name = registry.clean_text(first_name, 40)
    last_name = registry.clean_text(last_name, 60)
    if not first_name:
        raise ServiceError("invalid-first-name", "Informe seu nome.")
    email = registry.validate_email(email)
    fields: dict[str, Any] = {"first_name": first_name, "last_name": last_name, "email": email}
    if photo is not KEEP_PHOTO:
        fields["photo"] = registry.validate_photo(photo)
    with store.connect(path) as conn:
        owner = store.read_owner(conn)
        if registry.normalize_email(email) != registry.normalize_email(owner.email):
            # Trocar o e-mail de acesso pede a senha atual.
            _verify(session.vault_id, owner, current_password or "")
        store.update_owner(conn, **fields)
    return account(session)


def change_password(session: Session, current: str, new: str) -> int:
    """Troca a senha, mantém esta sessão e encerra as outras. Retorna quantas foram encerradas."""
    registry.validate_password(new)
    path = _path(session)
    with store.connect(path) as conn:
        owner = store.read_owner(conn)
        key = _verify(session.vault_id, owner, current)
        if crypto.verify_password(new, owner.password_hash):
            raise ServiceError("same-password", "A nova senha é igual à atual.")
        now = store.utcnow()
        store.update_owner(
            conn,
            password_hash=crypto.hash_password(new),
            key_wrap=crypto.wrap_key(key, new, session.vault_id),
            password_changed_at=now,
        )
    return SESSIONS.revoke_vault(session.vault_id, keep=session.token)


# ---------------------------------------------------------------- e-mail de envio


def _mail_public(mail: dict[str, Any] | None) -> dict[str, Any] | None:
    if not mail:
        return None
    return {
        "provider": mail["provider"],
        "host": mail["host"],
        "port": mail["port"],
        "security": mail["security"],
        "username": mail["username"],
        "fromName": mail["from_name"],
        "hasPassword": bool(mail["password_enc"]),
        "updatedAt": mail["updated_at"],
    }


def _mail_context(vault_id: str) -> str:
    return f"mail:{vault_id}"


def set_mail(
    session: Session,
    *,
    provider: str,
    host: str,
    port: int,
    security: str,
    username: str,
    from_name: str,
    password: str | None,
) -> dict[str, Any] | None:
    provider = provider if provider in (*mailer.PRESETS, "custom") else "custom"
    if provider in mailer.PRESETS:
        host, port, security = mailer.PRESETS[provider]
    host = (host or "").strip().lower()
    username = (username or "").strip()
    probe = mailer.MailConfig(
        host=host,
        port=int(port),
        security=security,
        username=username,
        password="",
        from_address=username,
        from_name=from_name,
    )
    try:
        probe.validate()
    except mailer.MailError as exc:
        raise ServiceError("mail-config", str(exc)) from exc
    with store.connect(_path(session)) as conn:
        current = store.read_mail(conn)
        if password is None:
            password_enc = current["password_enc"] if current else None
        elif password == "":
            password_enc = None
        else:
            password_enc = crypto.seal(session.data_key, password, _mail_context(session.vault_id))
        store.write_mail(
            conn,
            {
                "provider": provider,
                "host": host,
                "port": int(port),
                "security": security,
                "username": username,
                "from_name": registry.clean_text(from_name, 60),
                "password_enc": password_enc,
            },
        )
        return _mail_public(store.read_mail(conn))


def delete_mail(session: Session) -> None:
    with store.connect(_path(session)) as conn:
        store.delete_mail(conn)


def _mail_config(session: Session) -> tuple[mailer.MailConfig, str]:
    with store.connect(_path(session), readonly=True) as conn:
        mail = store.read_mail(conn)
        owner = store.read_owner(conn)
    if not mail:
        raise ServiceError("mail-not-configured", "Configure o e-mail de envio em Minha conta.")
    password = ""
    if mail["password_enc"]:
        try:
            password = crypto.open_sealed(
                session.data_key, mail["password_enc"], _mail_context(session.vault_id)
            )
        except crypto.CryptoError as exc:
            raise ServiceError(
                "mail-password-lost", "Digite de novo a senha do e-mail de envio."
            ) from exc
    from_address = mail["username"] if "@" in mail["username"] else owner.email
    config = mailer.MailConfig(
        host=mail["host"],
        port=mail["port"],
        security=mail["security"],
        username=mail["username"],
        password=password,
        from_address=from_address,
        from_name=mail["from_name"] or owner.first_name,
    )
    return config, owner.email


def send_mail(
    session: Session,
    *,
    subject: str,
    text: str,
    html: str | None,
    attachments: list[mailer.Attachment],
    sender: Any = None,
) -> str:
    """Manda para o e-mail cadastrado do dono do cofre. Retorna o endereço usado."""
    if not MAIL_LIMIT.allow(session.vault_id):
        raise ServiceError(
            "mail-limit", "Muitos e-mails em pouco tempo. Tente daqui a alguns minutos."
        )
    config, to = _mail_config(session)
    outgoing = mailer.Outgoing(
        to=to, subject=subject[:200], text=text, html=html, attachments=attachments
    )
    try:
        (sender or mailer.send)(config, outgoing)
    except mailer.MailError as exc:
        raise ServiceError(f"mail-{exc.code}", str(exc)) from exc
    return to


# ---------------------------------------------------------------- terminal (esqueci a senha)


def reset_password_offline(vault_id: str, new_password: str) -> None:
    """Nova senha sem a antiga (comando ``redefinir-senha``, com o app fechado).

    Gera uma chave de dados nova; por isso a senha do e-mail de envio precisa ser digitada de novo.
    """
    registry.validate_password(new_password)
    path = registry.path_for(vault_id)
    backup.create_backup(
        "before-reset",
        db_path=path,
        backups_dir=registry.vault_backups_dir(vault_id),
        extra_dir=_extra_dir(vault_id),
        apply_policy=False,
    )
    key = crypto.new_data_key()
    with store.connect(path) as conn:
        if store.schema_version(conn) < store.SCHEMA_VERSION:
            store.migrate(conn)
        # Chave nova: o código de recuperação antigo deixa de abrir o cofre (gere outro em
        # Minha conta).
        store.update_owner(
            conn,
            password_hash=crypto.hash_password(new_password),
            key_wrap=crypto.wrap_key(key, new_password, vault_id),
            password_changed_at=store.utcnow(),
            recovery_hash=None,
            recovery_wrap=None,
            recovery_created_at=None,
            recovery_confirmed_at=None,
        )
        mail = store.read_mail(conn)
        if mail and mail["password_enc"]:
            store.write_mail(
                conn,
                {
                    **{
                        k: mail[k]
                        for k in ("provider", "host", "port", "security", "username", "from_name")
                    },
                    "password_enc": None,
                },
            )
    SESSIONS.revoke_vault(vault_id)
    LOGIN_THROTTLE.success(vault_id)
