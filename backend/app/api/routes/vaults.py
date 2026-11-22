"""Rotas dos cofres: escolher/criar/entrar, dados do app, Minha conta e envio de e-mail.

A sessão fica num cookie HttpOnly (``lume_session``) com SameSite=Strict; o resto da
proteção contra outros sites vem do middleware (Host, Origin e X-App-Request).
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

from app.services import mailer
from app.vaults import registry, service, store
from app.vaults.sessions import SESSIONS, Session

COOKIE = "lume_session"

router = APIRouter(tags=["cofres"])

_STATUS = {
    "not-found": 404,
    "unauthenticated": 401,
    "bad-credentials": 401,
    "bad-recovery": 401,
    "storage": 503,
    "bad-password": 403,
    "throttled": 429,
    "mail-limit": 429,
    "mail-too-big": 413,
    "conflict": 409,
    "unreadable": 409,
    "too-new": 409,
    "corrupted": 409,
    "mail-not-configured": 409,
    "mail-password-lost": 409,
}


def _fail(exc: Exception) -> NoReturn:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise HTTPException(
            422, {"code": "invalid", "message": f"{where}: {first.get('msg')}"}
        ) from exc
    assert isinstance(exc, store.VaultError)  # noqa: S101 - só chamado com esses tipos
    code = exc.code
    if code.startswith("mail-") and code not in _STATUS and code != "mail-config":
        status = 502  # o servidor de e-mail recusou ou não respondeu
    else:
        status = _STATUS.get(code, 422)
    detail: dict[str, Any] = {"code": code, "message": str(exc)}
    headers = None
    retry_after = getattr(exc, "retry_after", None)
    if retry_after:
        detail["retryAfter"] = retry_after
        headers = {"Retry-After": str(retry_after)}
    revision = getattr(exc, "revision", None)
    if revision is not None:
        detail["revision"] = revision
    raise HTTPException(status, detail, headers=headers) from exc


_ERRORS = (store.VaultError, ValidationError)


def current_session(request: Request) -> Session:
    session = SESSIONS.get(request.cookies.get(COOKIE))
    if session is None:
        raise HTTPException(
            401, {"code": "unauthenticated", "message": "Entre no cofre para continuar."}
        )
    # Outra aba entrou em outro cofre (o cookie é um só): esta aba não pode gravar no cofre errado.
    expected = request.headers.get("x-vault-id")
    if expected and expected != session.vault_id:
        raise HTTPException(
            409, {"code": "vault-changed", "message": "Outra janela abriu um cofre diferente."}
        )
    return session


SessionDep = Annotated[Session, Depends(current_session)]


def _set_cookie(response: Response, session: Session) -> None:
    response.set_cookie(COOKIE, session.token, httponly=True, samesite="strict", path="/")


class _Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


# ---------------------------------------------------------------- escolher, criar e entrar


class CreateVaultBody(_Body):
    name: str = Field(max_length=200)
    first_name: str = Field(max_length=200)
    last_name: str = Field(default="", max_length=200)
    email: str = Field(max_length=320)
    password: str = Field(max_length=500)
    data: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None


class LoginBody(_Body):
    email: str = Field(max_length=320)
    password: str = Field(max_length=500)


@router.get("/vaults")
def list_vaults():
    return [v.public() for v in registry.list_vaults()]


class RecoverBody(_Body):
    email: str = Field(max_length=320)
    recovery_code: str = Field(max_length=100)
    new_password: str = Field(max_length=500)


class CurrentPasswordBody(_Body):
    current_password: str = Field(max_length=500)


@router.post("/vaults", status_code=201)
def create_vault(body: CreateVaultBody, request: Request, response: Response):
    """Cria o cofre e entra nele. ``recoveryCode`` só aparece nesta resposta."""
    try:
        session, recovery_code = service.create(
            name=body.name,
            first_name=body.first_name,
            last_name=body.last_name,
            email=body.email,
            password=body.password,
            data=body.data,
            settings=body.settings,
        )
        info = service.session_info(session)
    except _ERRORS as exc:
        _fail(exc)
    service.logout(request.cookies.get(COOKIE))  # quem estava em outro cofre sai dele
    _set_cookie(response, session)
    return {**info, "recoveryCode": recovery_code}


@router.post("/vaults/{vault_id}/recover")
def recover(vault_id: str, body: RecoverBody, request: Request, response: Response):
    """Esqueci a senha: e-mail + código de recuperação + senha nova. Entra no cofre e devolve
    um código novo (o usado deixa de valer)."""
    try:
        session, recovery_code = service.recover(
            vault_id, body.email, body.recovery_code, body.new_password
        )
        info = service.session_info(session)
    except _ERRORS as exc:
        _fail(exc)
    service.logout(request.cookies.get(COOKIE))
    _set_cookie(response, session)
    return {**info, "recoveryCode": recovery_code}


@router.post("/vaults/{vault_id}/session")
def login(vault_id: str, body: LoginBody, request: Request, response: Response):
    try:
        session = service.login(vault_id, body.email, body.password)
        info = service.session_info(session)
    except _ERRORS as exc:
        _fail(exc)
    service.logout(request.cookies.get(COOKIE))  # troca de cofre: encerra a sessão anterior
    _set_cookie(response, session)
    return info


@router.get("/session")
def get_session(session: SessionDep):
    try:
        return service.session_info(session)
    except _ERRORS as exc:
        _fail(exc)


@router.delete("/session", status_code=204)
def logout(request: Request, response: Response):
    service.logout(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")


# ---------------------------------------------------------------- dados do cofre


class RenameBody(_Body):
    name: str = Field(max_length=200)


class PasswordConfirmBody(_Body):
    password: str = Field(max_length=500)


@router.get("/vault/data")
def get_data(session: SessionDep):
    try:
        return service.load_data(session)
    except _ERRORS as exc:
        _fail(exc)


@router.post("/vault/changes")
def post_changes(session: SessionDep, payload: Annotated[dict[str, Any], Body()]):
    try:
        return {"revision": service.apply_changes(session, payload)}
    except _ERRORS as exc:
        _fail(exc)


@router.get("/vault/backups")
def vault_backups(session: SessionDep):
    try:
        return service.vault_backups(session)
    except _ERRORS as exc:
        _fail(exc)


@router.put("/vault/settings")
def put_settings(session: SessionDep, payload: Annotated[dict[str, Any], Body()]):
    try:
        return service.update_settings(session, payload)
    except _ERRORS as exc:
        _fail(exc)


@router.patch("/vault")
def rename_vault(session: SessionDep, body: RenameBody):
    try:
        return service.rename(session, body.name)
    except _ERRORS as exc:
        _fail(exc)


@router.post("/vault/delete", status_code=204)
def delete_vault(session: SessionDep, body: PasswordConfirmBody, response: Response):
    try:
        service.delete_vault(session, body.password)
    except _ERRORS as exc:
        _fail(exc)
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")


# ---------------------------------------------------------------- Minha conta


class AccountBody(_Body):
    first_name: str = Field(max_length=200)
    last_name: str = Field(default="", max_length=200)
    email: str = Field(max_length=320)
    photo: str | None = Field(default=None, max_length=600_000)
    current_password: str | None = Field(default=None, max_length=500)


class PasswordBody(_Body):
    current_password: str = Field(max_length=500)
    new_password: str = Field(max_length=500)


class MailBody(_Body):
    provider: str = Field(max_length=20)
    host: str = Field(default="", max_length=255)
    port: int = Field(default=0, ge=0, le=65535)
    security: str = Field(default="starttls", max_length=10)
    username: str = Field(max_length=320)
    from_name: str = Field(default="", max_length=200)
    #: None mantém a senha guardada; "" apaga.
    password: str | None = Field(default=None, max_length=500)


@router.get("/account")
def get_account(session: SessionDep):
    try:
        return service.account(session)
    except _ERRORS as exc:
        _fail(exc)


@router.put("/account")
def put_account(session: SessionDep, body: AccountBody):
    try:
        return service.update_account(
            session,
            first_name=body.first_name,
            last_name=body.last_name,
            email=body.email,
            # Sem "photo" no corpo, a foto atual fica; "photo": null remove.
            photo=body.photo if "photo" in body.model_fields_set else service.KEEP_PHOTO,
            current_password=body.current_password,
        )
    except _ERRORS as exc:
        _fail(exc)


@router.post("/account/password")
def post_password(session: SessionDep, body: PasswordBody):
    try:
        closed = service.change_password(session, body.current_password, body.new_password)
    except _ERRORS as exc:
        _fail(exc)
    return {"closedSessions": closed}


@router.post("/account/recovery-code")
def new_recovery_code(body: CurrentPasswordBody, session: SessionDep):
    """Gera um código de recuperação novo (o anterior deixa de valer)."""
    try:
        return {"recoveryCode": service.new_recovery_code(session, body.current_password)}
    except _ERRORS as exc:
        _fail(exc)


@router.post("/account/recovery-code/confirm")
def confirm_recovery_code(session: SessionDep):
    try:
        return service.confirm_recovery_code(session)
    except _ERRORS as exc:
        _fail(exc)


@router.put("/account/mail")
def put_mail(session: SessionDep, body: MailBody):
    try:
        return service.set_mail(
            session,
            provider=body.provider,
            host=body.host,
            port=body.port,
            security=body.security,
            username=body.username,
            from_name=body.from_name,
            password=body.password,
        )
    except _ERRORS as exc:
        _fail(exc)


@router.delete("/account/mail", status_code=204)
def delete_mail(session: SessionDep):
    try:
        service.delete_mail(session)
    except _ERRORS as exc:
        _fail(exc)


# ---------------------------------------------------------------- envio


_FILENAME_RE = re.compile(r"[^\w.\- ()]+", re.UNICODE)


#: Tamanho em base64 que cabe no limite de anexos (4 caracteres para cada 3 bytes).
_B64_MAX = (mailer.MAX_ATTACHMENTS_BYTES + 2) // 3 * 4


class AttachmentBody(_Body):
    filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(
        default="application/octet-stream", max_length=100, pattern=r"^[\w.+-]+/[\w.+-]+$"
    )
    # Folga sobre o limite para que um anexo grande demais receba "mail-too-big" (com o limite na
    # mensagem) em vez de "invalid"; acima disso o corpo nem é aceito.
    data: str = Field(max_length=2 * _B64_MAX)


class SendBody(_Body):
    subject: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=200_000)
    html: str | None = Field(default=None, max_length=2_000_000)
    attachments: list[AttachmentBody] = Field(default_factory=list, max_length=10)


def _too_big() -> NoReturn:
    limit = mailer.MAX_ATTACHMENTS_BYTES // (1024 * 1024)
    raise HTTPException(
        413, {"code": "mail-too-big", "message": f"Os anexos passam de {limit} MB."}
    )


def _attachments(items: list[AttachmentBody]) -> list[mailer.Attachment]:
    # Confere o tamanho antes de decodificar: um anexo grande demais é recusado sem ocupar memória
    # com a cópia decodificada e sem gastar uma das tentativas do limite de envios.
    if sum(len(item.data) for item in items) > _B64_MAX:
        _too_big()
    out = []
    for item in items:
        name = (
            _FILENAME_RE.sub("_", item.filename.replace("/", "_").replace("\\", "_")).strip(" .")
            or "arquivo"
        )
        try:
            data = base64.b64decode(item.data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(422, {"code": "invalid", "message": "Anexo inválido."}) from exc
        out.append(mailer.Attachment(name[:120], item.content_type, data))
    return out


@router.post("/account/mail/test")
def test_mail(session: SessionDep):
    try:
        to = service.send_mail(
            session,
            subject="Lume: e-mail de teste",
            text="Tudo certo! O Lume consegue enviar relatórios para você por este e-mail.",
            html=None,
            attachments=[],
        )
    except _ERRORS as exc:
        _fail(exc)
    return {"to": to}


@router.post("/mail/send")
def send_mail(session: SessionDep, body: SendBody):
    attachments = _attachments(body.attachments)
    try:
        to = service.send_mail(
            session, subject=body.subject, text=body.text, html=body.html, attachments=attachments
        )
    except _ERRORS as exc:
        _fail(exc)
    return {"to": to}
