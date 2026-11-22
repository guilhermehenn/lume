"""Cofres no disco: onde ficam, como listar, criar, abrir e mandar para a lixeira.

Pasta: <dados>/cofres/<id>.db  (o id é um UUID em hexadecimal; o nome fica dentro do arquivo).
Excluir nunca apaga: o arquivo vai para <dados>/cofres/lixeira/.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import logging
import os
import re
import shutil
import sqlite3
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core import paths
from app.vaults import crypto, models, store

log = logging.getLogger(__name__)

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
_PHOTO_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
MAX_PHOTO_BYTES = 300 * 1024


class RegistryError(store.VaultError):
    pass


#: Criar e renomear conferem o nome e gravam sob a mesma trava: dois pedidos ao mesmo
#: tempo (clique duplo, duas abas) não criam dois cofres com o mesmo nome.
_NAMES_LOCK = threading.Lock()


def vaults_dir() -> Path:
    return paths.data_dir() / "cofres"


def trash_dir() -> Path:
    return vaults_dir() / "lixeira"


def vault_backups_dir(vault_id: str) -> Path:
    return paths.backups_dir() / "cofres" / vault_id


def ensure_dirs() -> None:
    """Cria as pastas dos cofres. No macOS, só o próprio usuário pode lê-las (700)."""
    for folder in (vaults_dir(), trash_dir()):
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "posix":
            folder.chmod(0o700)


def path_for(vault_id: str) -> Path:
    if not _ID_RE.match(vault_id or ""):
        raise RegistryError("not-found", "Cofre não encontrado.")
    path = vaults_dir() / f"{vault_id}.db"
    if not path.is_file():
        raise RegistryError("not-found", "Cofre não encontrado.")
    return path


def vault_files() -> list[Path]:
    folder = vaults_dir()
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.glob("*.db") if _ID_RE.match(p.stem))


def remove_stale_temp_files(max_age_seconds: float = 0) -> int:
    """Apaga sobras de criações interrompidas (``<id>.creating*``). Retorna quantas apagou."""
    folder = vaults_dir()
    if not folder.is_dir():
        return 0
    removed = 0
    limit = time.time() - max_age_seconds
    for candidate in folder.glob("*.creating*"):
        with contextlib.suppress(OSError):
            if candidate.stat().st_mtime <= limit:
                candidate.unlink()
                removed += 1
    return removed


# ---------------------------------------------------------------- validações comuns


_ZWJ = "\u200d"  # junta emojis (👨‍👩‍👧): é um caractere de formato, mas legítimo


def clean_text(value: str, max_len: int) -> str:
    """Texto de nome: Unicode normalizado, sem caracteres de controle ou invisíveis (que
    poderiam inverter o texto na tela), espaços repetidos viram um."""
    text = unicodedata.normalize("NFC", value or "")
    text = "".join(
        ch
        for ch in text
        if ch == _ZWJ or ch.isspace() or unicodedata.category(ch) not in {"Cc", "Cf", "Co", "Cs"}
    )
    return re.sub(r"\s+", " ", text).strip()[:max_len].strip()


def normalize_email(value: str) -> str:
    return unicodedata.normalize("NFC", (value or "").strip()).lower()


def validate_email(value: str) -> str:
    email = unicodedata.normalize("NFC", (value or "").strip())
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise RegistryError("invalid-email", "E-mail inválido.")
    return email


def validate_photo(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    match = _PHOTO_RE.match(value)
    if not match:
        raise RegistryError("invalid-photo", "Foto inválida.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RegistryError("invalid-photo", "Foto inválida.") from exc
    if len(raw) > MAX_PHOTO_BYTES:
        raise RegistryError("photo-too-big", "A foto passou de 300 KB.")
    return value


def validate_password(value: str) -> str:
    check = crypto.check_password_rules(value)
    if not check.ok:
        raise RegistryError(f"weak-password-{check.reason}", "Senha fraca.")
    return value


def email_hint(email: str) -> str:
    """Dica do e-mail para a tela de entrada: g••••@gmail.com."""
    local, _, domain = email.partition("@")
    if not local:
        return ""
    return f"{local[0]}{'•' * min(max(len(local) - 1, 3), 6)}@{domain}"


def initials(first: str, last: str) -> str:
    letters = [w[0] for w in (first.split()[:1] + last.split()[-1:]) if w]
    return "".join(letters).upper()[:2] or "?"


# ---------------------------------------------------------------- resumo (tela de escolher cofre)


@dataclass(frozen=True)
class VaultSummary:
    id: str
    name: str
    owner_first_name: str
    owner_last_name: str
    email_hint: str
    photo: str | None
    created_at: str
    last_opened_at: str | None
    entries: int
    status: str  # ok | needs-update | too-new | error

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "ownerFirstName": self.owner_first_name,
            "ownerLastName": self.owner_last_name,
            "initials": initials(self.owner_first_name, self.owner_last_name),
            "emailHint": self.email_hint,
            "photo": self.photo,
            "createdAt": self.created_at,
            "lastOpenedAt": self.last_opened_at,
            "entries": self.entries,
            "status": self.status,
        }


def status(path: Path) -> str:
    """Só o estado do arquivo (ok, needs-update, too-new, error), sem ler os dados."""
    try:
        with store.connect(path, readonly=True) as conn:
            version = store.schema_version(conn)
            if version == 0:
                return "error"
            store.read_owner(conn)
    except (sqlite3.Error, store.VaultError, OSError):
        return "error"
    if version > store.SCHEMA_VERSION:
        return "too-new"
    return "needs-update" if version < store.SCHEMA_VERSION else "ok"


def name_taken(name: str, *, exclude: str | None = None) -> bool:
    """Já existe outro cofre com este nome (sem diferenciar maiúsculas e acentos)?"""
    wanted = _fold(name)
    for path in vault_files():
        if path.stem == exclude:
            continue
        with (
            contextlib.suppress(sqlite3.Error, OSError),
            store.connect(path, readonly=True) as conn,
        ):
            if _fold(store.get_meta(conn, "name", "") or "") == wanted:
                return True
    return False


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", clean_text(text, 60).casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def summary(path: Path) -> VaultSummary:
    vault_id = path.stem
    try:
        with store.connect(path, readonly=True) as conn:
            version = store.schema_version(conn)
            if version == 0:
                raise sqlite3.DatabaseError("arquivo vazio")
            owner = store.read_owner(conn)
            counts = store.counts(conn)
            status = (
                "ok"
                if version == store.SCHEMA_VERSION
                else "needs-update"
                if version < store.SCHEMA_VERSION
                else "too-new"
            )
            return VaultSummary(
                id=vault_id,
                name=store.get_meta(conn, "name", "Cofre") or "Cofre",
                owner_first_name=owner.first_name,
                owner_last_name=owner.last_name,
                email_hint=email_hint(owner.email),
                photo=owner.photo,
                created_at=store.get_meta(conn, "created_at", "") or "",
                last_opened_at=store.get_meta(conn, "last_opened_at"),
                entries=counts["transactions"] + counts["investments"],
                status=status,
            )
    except (sqlite3.Error, store.VaultError, OSError) as exc:
        log.warning("Cofre %s ilegível: %s", vault_id, exc)
        return VaultSummary(vault_id, "Cofre ilegível", "", "", "", None, "", None, 0, "error")


def list_vaults() -> list[VaultSummary]:
    found = [summary(p) for p in vault_files()]
    return sorted(found, key=lambda s: (s.last_opened_at or "", s.created_at), reverse=True)


# ---------------------------------------------------------------- criar e excluir


@dataclass(frozen=True)
class Created:
    vault_id: str
    path: Path
    data_key: bytes
    owner: store.Owner
    revision: int
    recovery_code: str


def recovery_fields(data_key: bytes, vault_id: str, now: str) -> tuple[str, dict[str, Any]]:
    """Novo código de recuperação e as colunas do dono que o guardam (o código em si não fica)."""
    code = crypto.new_recovery_code()
    return code, {
        "recovery_hash": crypto.hash_recovery_code(code),
        "recovery_wrap": crypto.wrap_key_with_code(data_key, code, vault_id),
        "recovery_created_at": now,
        "recovery_confirmed_at": None,
    }


def create_vault(
    *,
    name: str,
    first_name: str,
    last_name: str,
    email: str,
    password: str,
    data: models.DataState | None = None,
    settings: models.SettingsPatch | None = None,
) -> Created:
    """Cria o arquivo do cofre de forma atômica.

    Tudo é gravado num arquivo temporário (``<id>.creating``), que só vira ``<id>.db`` depois
    de fechado. Assim a lista de cofres nunca mostra um cofre pela metade, e uma falha no
    meio (disco cheio, energia) não deixa lixo com cara de cofre.
    """
    name = clean_text(name, 60)
    first_name = clean_text(first_name, 40)
    last_name = clean_text(last_name, 60)
    if not name:
        raise RegistryError("invalid-name", "Dê um nome ao cofre.")
    if not first_name:
        raise RegistryError("invalid-first-name", "Informe seu nome.")
    email = validate_email(email)
    validate_password(password)
    ensure_dirs()
    with _NAMES_LOCK:
        if name_taken(name):
            raise RegistryError("name-taken", "Já existe um cofre com esse nome.")
        return _create_file(name, first_name, last_name, email, password, data, settings)


def _create_file(
    name: str,
    first_name: str,
    last_name: str,
    email: str,
    password: str,
    data: models.DataState | None,
    settings: models.SettingsPatch | None,
) -> Created:

    vault_id = uuid.uuid4().hex
    final = vaults_dir() / f"{vault_id}.db"
    temp = vaults_dir() / f"{vault_id}.creating"
    data_key = crypto.new_data_key()
    now = store.utcnow()
    recovery_code, recovery = recovery_fields(data_key, vault_id, now)
    owner = store.Owner(
        id=uuid.uuid4().hex,
        first_name=first_name,
        last_name=last_name,
        email=email,
        photo=None,
        password_hash=crypto.hash_password(password),
        key_wrap=crypto.wrap_key(data_key, password, vault_id),
        created_at=now,
        updated_at=now,
        password_changed_at=now,
        **recovery,
    )
    try:
        with store.connect(temp) as conn:
            store.migrate(conn)
            with store.transaction(conn):
                for key, value in (
                    ("vault_id", vault_id),
                    ("name", name),
                    ("created_at", now),
                    ("last_opened_at", now),
                    ("revision", "0"),
                ):
                    store.set_meta(conn, key, value)
                store.insert_owner(conn, owner)
                if settings is not None:
                    store.write_settings(conn, settings, in_transaction=True)
            revision = store.replace_state(conn, data) if data is not None else 0
            # Arquivo único e completo antes de entrar na lista (sem -wal pendente).
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        os.replace(temp, final)
    except sqlite3.Error as exc:
        _remove_files(temp)
        log.error("Falha ao criar cofre: %s", exc)
        raise RegistryError(
            "storage", "Não foi possível gravar o cofre no disco. Confira o espaço livre."
        ) from exc
    except BaseException:
        _remove_files(temp)
        raise
    finally:
        _remove_files(temp, keep_main=True)
    paths.secure_file(final)
    log.info("Cofre criado: %s", vault_id)
    return Created(vault_id, final, data_key, owner, revision, recovery_code)


def rename_vault(vault_id: str, name: str) -> VaultSummary:
    name = clean_text(name, 60)
    if not name:
        raise RegistryError("invalid-name", "Dê um nome ao cofre.")
    path = path_for(vault_id)
    with _NAMES_LOCK:
        if name_taken(name, exclude=vault_id):
            raise RegistryError("name-taken", "Já existe um cofre com esse nome.")
        with store.connect(path) as conn, store.transaction(conn):
            store.set_meta(conn, "name", name)
    return summary(path)


def touch_opened(vault_id: str) -> None:
    with store.connect(path_for(vault_id)) as conn, store.transaction(conn):
        store.set_meta(conn, "last_opened_at", store.utcnow())


def move_to_trash(vault_id: str, now: datetime | None = None) -> Path:
    """Tira o cofre da lista sem apagar: o arquivo vai para a lixeira."""
    path = path_for(vault_id)
    with store.connect(path) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode=DELETE")
    ensure_dirs()
    stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H-%M-%S")
    target = trash_dir() / f"{vault_id}_{stamp}.db"
    shutil.move(str(path), str(target))
    _remove_files(path, keep_main=True)
    log.info("Cofre %s movido para a lixeira", vault_id)
    return target


def _remove_files(path: Path, keep_main: bool = False) -> None:
    candidates = [Path(f"{path}{suffix}") for suffix in ("-wal", "-shm", "-journal")]
    if not keep_main:
        candidates.insert(0, path)
    for candidate in candidates:
        with contextlib.suppress(FileNotFoundError, PermissionError):
            candidate.unlink()
