"""Envio de e-mail pela conta do próprio usuário (SMTP), com anexos.

O Lume não tem servidor de e-mail: usa a conta que a pessoa configurar (Gmail,
Outlook, Yahoo, iCloud ou outra), normalmente com uma "senha de app". A conexão
é sempre cifrada (STARTTLS ou SSL); sem cifra só para servidores no próprio computador.
"""

from __future__ import annotations

import logging
import smtplib
import socket
import ssl
from collections.abc import Callable
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

log = logging.getLogger(__name__)

Security = str  # "starttls" | "ssl" | "none"

PRESETS: dict[str, tuple[str, int, Security]] = {
    "gmail": ("smtp.gmail.com", 587, "starttls"),
    "outlook": ("smtp-mail.outlook.com", 587, "starttls"),
    "office365": ("smtp.office365.com", 587, "starttls"),
    "yahoo": ("smtp.mail.yahoo.com", 465, "ssl"),
    "icloud": ("smtp.mail.me.com", 587, "starttls"),
}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
#: Soma dos anexos de um e-mail. Codificados (base64) eles crescem cerca de 37%: 15 MB viram uns
#: 20 MB, abaixo dos 25 MB por mensagem do Gmail e do Yahoo. O navegador usa o mesmo número
#: (MAIL_MAX_BYTES em frontend/src/app/mail.ts) para nem enviar um arquivo maior.
MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024


class MailError(Exception):
    """Falha no envio. ``code``: auth, connect, tls, timeout, rejected, config, too-big, other."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class MailConfig:
    host: str
    port: int
    security: Security
    username: str
    password: str
    from_address: str
    from_name: str = ""

    def validate(self) -> None:
        if not self.host or not (0 < self.port < 65536):
            raise MailError("config", "Servidor ou porta inválidos.")
        if self.security not in ("starttls", "ssl", "none"):
            raise MailError("config", "Tipo de segurança inválido.")
        if self.security == "none" and self.host.lower() not in LOCAL_HOSTS:
            raise MailError(
                "config", "Envio sem criptografia só é permitido para um servidor neste computador."
            )


@dataclass(frozen=True)
class Attachment:
    filename: str
    content_type: str
    data: bytes


@dataclass
class Outgoing:
    to: str
    subject: str
    text: str
    html: str | None = None
    attachments: list[Attachment] = field(default_factory=list)


def build_message(config: MailConfig, mail: Outgoing) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((config.from_name or "Lume", config.from_address))
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain="lume.local")
    message["X-Mailer"] = "Lume"
    message.set_content(mail.text)
    if mail.html:
        message.add_alternative(mail.html, subtype="html")
    total = 0
    for item in mail.attachments:
        total += len(item.data)
        if total > MAX_ATTACHMENTS_BYTES:
            raise MailError("too-big", "Os anexos passam de 15 MB.")
        maintype, _, subtype = item.content_type.partition("/")
        message.add_attachment(
            item.data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=item.filename,
        )
    return message


SmtpFactory = Callable[..., smtplib.SMTP]


def send(
    config: MailConfig,
    mail: Outgoing,
    *,
    timeout: float = 20,
    smtp: SmtpFactory | None = None,
    smtp_ssl: SmtpFactory | None = None,
) -> None:
    """Envia ou lança ``MailError`` com um código que a interface traduz."""
    config.validate()
    message = build_message(config, mail)
    context = ssl.create_default_context()
    smtp = smtp or smtplib.SMTP
    smtp_ssl = smtp_ssl or smtplib.SMTP_SSL
    try:
        if config.security == "ssl":
            client = smtp_ssl(config.host, config.port, timeout=timeout, context=context)
        else:
            client = smtp(config.host, config.port, timeout=timeout)
        with client:
            client.ehlo()
            if config.security == "starttls":
                client.starttls(context=context)
                client.ehlo()
            if config.username and config.password:
                client.login(config.username, config.password)
            client.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise MailError("auth", "O servidor recusou o usuário ou a senha.") from exc
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as exc:
        raise MailError("rejected", "O servidor recusou a mensagem.") from exc
    except (ssl.SSLError, smtplib.SMTPNotSupportedError) as exc:
        raise MailError("tls", "Não foi possível abrir uma conexão segura.") from exc
    except TimeoutError as exc:
        raise MailError("timeout", "O servidor demorou demais para responder.") from exc
    except (
        smtplib.SMTPConnectError,
        smtplib.SMTPServerDisconnected,
        ConnectionError,
        socket.gaierror,
        OSError,
    ) as exc:
        raise MailError("connect", "Não foi possível conectar ao servidor de e-mail.") from exc
    except smtplib.SMTPException as exc:
        raise MailError("other", str(exc)) from exc
    log.info("E-mail enviado (%d anexo(s))", len(mail.attachments))
