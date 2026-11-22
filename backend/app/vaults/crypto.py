"""Senhas e segredos dos cofres.

- Senha: scrypt (biblioteca padrão), sal aleatório por cofre, comparação em tempo constante.
- Chave de dados (32 bytes aleatórios) de cada cofre, guardada "embrulhada" com AES-GCM
  por uma chave derivada da senha. Ela só existe em memória enquanto o cofre está aberto.
- Segredos do cofre (hoje, a senha do e-mail de envio) são cifrados com a chave de dados.
  Sem a senha do cofre, não dá para lê-los nem copiando o arquivo.
- Código de recuperação: 100 bits aleatórios em base32 (fácil de copiar à mão). A chave de
  dados também fica embrulhada por ele, então trocar a senha com o código não perde nada.
- Senhas são normalizadas (Unicode NFKC) antes de derivar: "é" digitado como um caractere
  ou como "e" + acento é a mesma senha em qualquer teclado ou sistema.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import unicodedata
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# scrypt N=2^15, r=8, p=1: ~32 MB e algumas dezenas de ms por tentativa.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
_MAXMEM = 64 * 1024 * 1024
MIN_PASSWORD = 8
MAX_PASSWORD = 200


class CryptoError(Exception):
    """Senha errada ou dado adulterado."""


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _scrypt(
    password: str, salt: bytes, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P
) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=_MAXMEM, dklen=32
    )


def normalize_secret(password: str) -> str:
    return unicodedata.normalize("NFKC", password)


def _variants(password: str) -> list[str]:
    """Forma normalizada primeiro; a original só para senhas gravadas antes da normalização."""
    normal = normalize_secret(password)
    return [normal] if normal == password else [normal, password]


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = _scrypt(normalize_secret(password), salt)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = _unb64(digest)
        params = (_unb64(salt), int(n), int(r), int(p))
    except (ValueError, TypeError):
        return False
    return any(hmac.compare_digest(_scrypt(v, *params), expected) for v in _variants(password))


def new_data_key() -> bytes:
    return os.urandom(32)


def wrap_key(data_key: bytes, password: str, vault_id: str) -> str:
    """Embrulha a chave de dados com uma chave derivada da senha (AES-GCM, AAD = id do cofre).

    Formato v2 guarda os parâmetros do scrypt, para poderem mudar no futuro sem quebrar nada.
    """
    salt = os.urandom(16)
    nonce = os.urandom(12)
    kek = _scrypt(normalize_secret(password), salt)
    sealed = AESGCM(kek).encrypt(nonce, data_key, vault_id.encode("utf-8"))
    return f"v2${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(nonce)}${_b64(sealed)}"


def unwrap_key(wrapped: str, password: str, vault_id: str) -> bytes:
    try:
        parts = wrapped.split("$")
        if parts[0] == "v2" and len(parts) == 7:
            n, r, p = (int(x) for x in parts[1:4])
            salt, nonce, sealed = parts[4:]
        elif parts[0] == "v1" and len(parts) == 4:
            n, r, p = SCRYPT_N, SCRYPT_R, SCRYPT_P
            salt, nonce, sealed = parts[1:]
        else:
            raise CryptoError("formato desconhecido")
        raw_salt, raw_nonce, raw_sealed = _unb64(salt), _unb64(nonce), _unb64(sealed)
    except (ValueError, TypeError) as exc:
        raise CryptoError("formato desconhecido") from exc
    for variant in _variants(password):
        kek = _scrypt(variant, raw_salt, n, r, p)
        try:
            return AESGCM(kek).decrypt(raw_nonce, raw_sealed, vault_id.encode("utf-8"))
        except InvalidTag:
            continue
    raise CryptoError("não foi possível abrir a chave do cofre")


# ---------------------------------------------------------------- código de recuperação

# Base32 de Crockford: sem I, L, O e U, para não confundir ao copiar à mão.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
RECOVERY_LENGTH = 20  # 20 x 5 bits = 100 bits


def new_recovery_code() -> str:
    """Ex.: 7K2QF-9XBRT-M4WDA-H8C3N (o formato com traços é só para leitura)."""
    raw = "".join(secrets.choice(_CROCKFORD) for _ in range(RECOVERY_LENGTH))
    return "-".join(raw[i : i + 5] for i in range(0, RECOVERY_LENGTH, 5))


def normalize_recovery_code(code: str) -> str:
    """Aceita minúsculas, espaços, traços e as letras parecidas com números (O→0, I/L→1)."""
    clean = "".join(ch for ch in (code or "").upper() if ch.isalnum())
    return clean.translate(str.maketrans({"O": "0", "I": "1", "L": "1"}))


def is_recovery_code(code: str) -> bool:
    clean = normalize_recovery_code(code)
    return len(clean) == RECOVERY_LENGTH and all(ch in _CROCKFORD for ch in clean)


# O código tem 100 bits aleatórios: ao contrário de uma senha escolhida por gente, não dá para
# adivinhar por tentativa, então não precisa do scrypt (lento de propósito). HKDF-SHA256 basta
# e deixa criar o cofre e trocar a senha bem mais rápidos.


def _code_key(code: str, salt: bytes, purpose: bytes) -> bytes:
    secret = normalize_recovery_code(code).encode("ascii")
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=purpose).derive(secret)


def hash_recovery_code(code: str) -> str:
    salt = os.urandom(16)
    return f"hkdf${_b64(salt)}${_b64(_code_key(code, salt, b'lume-recovery-check'))}"


def verify_recovery_code(code: str, stored: str) -> bool:
    try:
        algo, salt, digest = stored.split("$")
        if algo != "hkdf" or not is_recovery_code(code):
            return False
        candidate = _code_key(code, _unb64(salt), b"lume-recovery-check")
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, _unb64(digest))


def wrap_key_with_code(data_key: bytes, code: str, vault_id: str) -> str:
    salt, nonce = os.urandom(16), os.urandom(12)
    kek = _code_key(code, salt, b"lume-recovery-wrap")
    sealed = AESGCM(kek).encrypt(nonce, data_key, vault_id.encode("utf-8"))
    return f"r1${_b64(salt)}${_b64(nonce)}${_b64(sealed)}"


def unwrap_key_with_code(wrapped: str, code: str, vault_id: str) -> bytes:
    try:
        version, salt, nonce, sealed = wrapped.split("$")
        if version != "r1":
            raise CryptoError("formato desconhecido")
        kek = _code_key(code, _unb64(salt), b"lume-recovery-wrap")
        return AESGCM(kek).decrypt(_unb64(nonce), _unb64(sealed), vault_id.encode("utf-8"))
    except (ValueError, TypeError, InvalidTag) as exc:
        raise CryptoError("não foi possível abrir a chave do cofre") from exc


def seal(data_key: bytes, plaintext: str, context: str) -> str:
    nonce = os.urandom(12)
    sealed = AESGCM(data_key).encrypt(nonce, plaintext.encode("utf-8"), context.encode("utf-8"))
    return f"v1${_b64(nonce)}${_b64(sealed)}"


def open_sealed(data_key: bytes, token: str, context: str) -> str:
    try:
        version, nonce, sealed = token.split("$")
        if version != "v1":
            raise CryptoError("formato desconhecido")
        return (
            AESGCM(data_key)
            .decrypt(_unb64(nonce), _unb64(sealed), context.encode("utf-8"))
            .decode("utf-8")
        )
    except (ValueError, InvalidTag, UnicodeDecodeError) as exc:
        raise CryptoError("segredo ilegível") from exc


@dataclass(frozen=True)
class PasswordCheck:
    ok: bool
    reason: str | None = None


def check_password_rules(password: str) -> PasswordCheck:
    if len(password) < MIN_PASSWORD:
        return PasswordCheck(False, "short")
    if len(password) > MAX_PASSWORD:
        return PasswordCheck(False, "long")
    if password.strip() != password or not password.strip():
        return PasswordCheck(False, "spaces")
    return PasswordCheck(True)
