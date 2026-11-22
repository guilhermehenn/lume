"""Cofres: arquivo, senha, sessões, sincronização dos dados, conta e e-mail."""

import base64
import copy
import socket
import socketserver
import threading

import pytest

from app.services import mailer
from app.vaults import crypto, models, registry, service, store
from app.vaults.sessions import (
    LOGIN_THROTTLE,
    MAIL_LIMIT,
    SESSIONS,
    RateLimit,
    SessionStore,
    Throttle,
)

PASSWORD = "senha-forte-123"
NOW = "2026-01-01T00:00:00Z"


@pytest.fixture(autouse=True)
def _clean_memory():
    SESSIONS.clear()
    LOGIN_THROTTLE._failures.clear()
    MAIL_LIMIT._events.clear()
    yield
    SESSIONS.clear()


def bank(id_="b1", **extra):
    return {
        "id": id_,
        "name": "Nubank",
        "code": "260",
        "kind": "digital",
        "color": "#8A05BE",
        "initialBalance": 100000,
        "isPrimary": False,
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def category(id_="c1", kind="expense", **extra):
    return {
        "id": id_,
        "kind": kind,
        "nameKey": "groceries",
        "icon": "cart",
        "color": "#30D158",
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def tx(id_="t1", **extra):
    return {
        "id": id_,
        "kind": "expense",
        "amount": 4590,
        "date": "2026-01-10",
        "bankId": "b1",
        "categoryId": "c1",
        "counterparty": "Padaria",
        "paymentMethod": "pix",
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def inv(id_="i1", **extra):
    return {
        "id": id_,
        "operation": "contribution",
        "type": "stock",
        "amount": 305490,
        "date": "2026-01-12",
        "bankId": "b1",
        "asset": "PETR4",
        "quantity": 100,
        "unitPrice": 3050,
        "fees": 490,
        "createdAt": NOW,
        "updatedAt": NOW,
        **extra,
    }


def state(**overrides):
    base = {
        "version": 1,
        "banks": [bank()],
        "categories": [category(), category("c2", "income", nameKey="salary")],
        "transactions": [tx()],
        "investments": [inv()],
        "reports": [],
    }
    base.update(overrides)
    return base


def new_vault(name="Pessoal", email="gui@example.com", data=None):
    session, _code = new_vault_with_code(name, email, data)
    return session


def new_vault_with_code(name="Pessoal", email="gui@example.com", data=None):
    return service.create(
        name=name,
        first_name="Guilherme",
        last_name="Henn",
        email=email,
        password=PASSWORD,
        data=data if data is not None else state(),
        settings={"language": "pt"},
    )


# ---------------------------------------------------------------- senha e chave


def test_hash_e_chave_do_cofre():
    stored = crypto.hash_password(PASSWORD)
    assert stored.startswith("scrypt$")
    assert crypto.verify_password(PASSWORD, stored)
    assert not crypto.verify_password("outra-senha", stored)
    assert not crypto.verify_password(PASSWORD, "lixo")
    key = crypto.new_data_key()
    wrapped = crypto.wrap_key(key, PASSWORD, "cofre-a")
    assert crypto.unwrap_key(wrapped, PASSWORD, "cofre-a") == key
    with pytest.raises(crypto.CryptoError):
        crypto.unwrap_key(wrapped, "errada", "cofre-a")
    with pytest.raises(crypto.CryptoError):
        crypto.unwrap_key(wrapped, PASSWORD, "cofre-b")  # não serve em outro cofre
    secret = crypto.seal(key, "app-password", "mail:x")
    assert "app-password" not in secret
    assert crypto.open_sealed(key, secret, "mail:x") == "app-password"
    with pytest.raises(crypto.CryptoError):
        crypto.open_sealed(crypto.new_data_key(), secret, "mail:x")


@pytest.mark.parametrize(
    ("password", "reason"), [("curta", "short"), (" com espaço ", "spaces"), ("x" * 201, "long")]
)
def test_regras_de_senha(password, reason):
    assert crypto.check_password_rules(password).reason == reason
    with pytest.raises(registry.RegistryError) as err:
        registry.validate_password(password)
    assert err.value.code == f"weak-password-{reason}"


# ---------------------------------------------------------------- criar, listar, entrar


def test_criar_listar_e_entrar(isolated_settings):
    session = new_vault()
    files = registry.vault_files()
    assert len(files) == 1
    assert files[0].parent == isolated_settings / "cofres"
    info = service.session_info(session)
    assert info["vault"]["name"] == "Pessoal"
    assert info["vault"]["entries"] == 2
    assert info["vault"]["initials"] == "GH"
    assert info["vault"]["emailHint"] == "g•••@example.com"
    assert info["account"]["email"] == "gui@example.com"
    assert info["settings"]["language"] == "pt"
    assert info["revision"] == 1

    listed = registry.list_vaults()
    assert [v.name for v in listed] == ["Pessoal"]
    assert "gui@example.com" not in str(listed[0].public())  # a lista não mostra o e-mail inteiro

    service.logout(session.token)
    assert SESSIONS.get(session.token) is None
    again = service.login(session.vault_id, " GUI@Example.com ", PASSWORD)
    assert SESSIONS.get(again.token) is again
    assert again.data_key == session.data_key


def test_entrar_com_dados_errados_e_limite_de_tentativas():
    session = new_vault()
    vault_id = session.vault_id
    for _ in range(5):
        with pytest.raises(service.ServiceError) as err:
            service.login(vault_id, "gui@example.com", "senha-errada")
        assert err.value.code == "bad-credentials"
    with pytest.raises(service.ServiceError) as err:
        service.login(vault_id, "outro@example.com", PASSWORD)  # e-mail errado também conta
    assert err.value.code == "bad-credentials"
    with pytest.raises(service.ServiceError) as err:
        service.login(vault_id, "gui@example.com", PASSWORD)
    assert err.value.code == "throttled"
    assert err.value.retry_after and err.value.retry_after > 0


def test_cofre_inexistente_e_id_malicioso():
    for bad in ("../../etc/passwd", "x" * 32, "", "0" * 31):
        with pytest.raises(registry.RegistryError) as err:
            registry.path_for(bad)
        assert err.value.code == "not-found"


def test_validacoes_ao_criar():
    with pytest.raises(registry.RegistryError) as err:
        service.create(
            name=" ",
            first_name="A",
            last_name="",
            email="a@b.co",
            password=PASSWORD,
            data=None,
            settings=None,
        )
    assert err.value.code == "invalid-name"
    with pytest.raises(registry.RegistryError) as err:
        service.create(
            name="X",
            first_name="A",
            last_name="",
            email="sem-arroba",
            password=PASSWORD,
            data=None,
            settings=None,
        )
    assert err.value.code == "invalid-email"
    with pytest.raises(registry.RegistryError) as err:
        service.create(
            name="X",
            first_name="A",
            last_name="",
            email="a@b.co",
            password="123",
            data=None,
            settings=None,
        )
    assert err.value.code == "weak-password-short"
    assert registry.vault_files() == []  # nada fica pela metade


def test_dados_invalidos_nao_criam_o_cofre():
    broken = state(transactions=[tx(bankId="nao-existe")])
    with pytest.raises(store.InvalidData):
        new_vault(data=broken)
    assert registry.vault_files() == []


def test_varios_cofres_com_o_mesmo_email():
    a = new_vault("Pessoal")
    b = new_vault("Empresa")
    assert a.vault_id != b.vault_id
    assert {v.name for v in registry.list_vaults()} == {"Pessoal", "Empresa"}
    service.login(b.vault_id, "gui@example.com", PASSWORD)


def test_sessao_expira_por_inatividade():
    clock = [0.0]
    sessions = SessionStore(idle=60, maximum=600, clock=lambda: clock[0])
    s = sessions.create("v", "o", b"k")
    clock[0] = 59
    assert sessions.get(s.token) is s
    clock[0] = 119
    assert sessions.get(s.token) is s  # o uso renova
    clock[0] = 180
    assert sessions.get(s.token) is None
    s2 = sessions.create("v", "o", b"k")
    for t in range(1, 12):
        clock[0] = 180 + t * 55
        sessions.get(s2.token)
    clock[0] = 180 + 601
    assert sessions.get(s2.token) is None  # limite absoluto


def test_espera_dobra_depois_de_cinco_erros():
    clock = [0.0]
    throttle = Throttle(free=5, window=900, base=15, max_wait=300, clock=lambda: clock[0])
    for _ in range(5):
        throttle.fail("v")
    assert throttle.wait_seconds("v") == 0
    throttle.fail("v")
    assert throttle.wait_seconds("v") == 30
    clock[0] = 31
    assert throttle.wait_seconds("v") == 0
    throttle.fail("v")
    assert throttle.wait_seconds("v") == 60
    throttle.success("v")
    assert throttle.wait_seconds("v") == 0
    limit = RateLimit(2, 60, clock=lambda: clock[0])
    assert limit.allow("x") and limit.allow("x") and not limit.allow("x")


# ---------------------------------------------------------------- dados do app


def test_ida_e_volta_dos_dados():
    session = new_vault()
    loaded = service.load_data(session)
    assert loaded["revision"] == 1
    data = loaded["data"]
    assert data["banks"][0] == bank()
    assert data["transactions"][0] == tx()
    assert data["investments"][0] == inv()
    assert "issuer" not in data["investments"][0]  # campos vazios não voltam


def test_gravar_diferencas_e_conflito_de_revisao():
    session = new_vault()
    rev = service.apply_changes(
        session,
        {
            "baseRevision": 1,
            "upserts": {"transactions": [tx("t2", amount=1000, note="café"), tx(amount=4500)]},
            "deletes": {"investments": ["i1"]},
        },
    )
    assert rev == 2
    data = service.load_data(session)["data"]
    assert [t["amount"] for t in data["transactions"]] == [4500, 1000]
    assert data["investments"] == []

    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, {"baseRevision": 1, "deletes": {"transactions": ["t2"]}})
    assert err.value.code == "conflict"
    assert err.value.revision == 2
    assert len(service.load_data(session)["data"]["transactions"]) == 2  # nada mudou


def test_regras_do_conjunto():
    session = new_vault()
    cases = [
        ({"deletes": {"banks": ["b1"]}}, "ainda tem lançamentos"),  # banco em uso
        ({"upserts": {"transactions": [tx("t9", categoryId="c2")]}}, "categoria de outro tipo"),
        (
            {"upserts": {"banks": [bank(isPrimary=True), bank("b2", name="Itaú", isPrimary=True)]}},
            "mais de um banco principal",
        ),
        ({"upserts": {"transactions": [tx("t9", amount=0)]}}, "amount"),
        ({"upserts": {"transactions": [tx("t9", date="2026-02-30")]}}, "date"),
        ({"upserts": {"transactions": [tx("t9", extra="x")]}}, "extra"),
    ]
    for payload, expected in cases:
        with pytest.raises(service.ServiceError) as err:
            service.apply_changes(session, {"baseRevision": 1, **payload})
        assert err.value.code == "invalid", payload
        assert expected in str(err.value), (payload, str(err.value))
    assert service.load_data(session)["revision"] == 1


def test_mover_lancamentos_e_excluir_banco_numa_vez_so():
    session = new_vault()
    moved = [tx(bankId="b2")]
    moved_inv = [inv(bankId="b2")]
    rev = service.apply_changes(
        session,
        {
            "baseRevision": 1,
            "upserts": {
                "banks": [bank("b2", name="Itaú")],
                "transactions": moved,
                "investments": moved_inv,
            },
            "deletes": {"banks": ["b1"]},
        },
    )
    data = service.load_data(session)["data"]
    assert rev == 2
    assert [b["id"] for b in data["banks"]] == ["b2"]
    assert data["transactions"][0]["bankId"] == "b2"


def test_relatorio_salvo_e_configuracoes():
    session = new_vault()
    report = {
        "id": "r1",
        "name": "Carro",
        "groupBy": "month",
        "createdAt": NOW,
        "filters": {
            "from": "2026-01-01",
            "kinds": ["expense"],
            "categoryIds": ["c1"],
            "bankIds": [],
        },
    }
    service.apply_changes(session, {"baseRevision": 1, "upserts": {"reports": [report]}})
    assert service.load_data(session)["data"]["reports"] == [report]
    settings = service.update_settings(
        session, {"theme": "light", "hideValues": True, "emailCopies": True}
    )
    assert settings["theme"] == "light"
    assert settings["hideValues"] is True
    assert settings["emailCopies"] is True
    assert settings["language"] == "pt"
    with pytest.raises(Exception):  # noqa: B017 - pydantic recusa valor fora da lista
        service.update_settings(session, {"theme": "roxo"})


def test_dados_grandes():
    session = new_vault()
    many = [tx(f"t{i}", amount=100 + i) for i in range(5000)]
    rev = service.apply_changes(session, {"baseRevision": 1, "upserts": {"transactions": many}})
    assert rev == 2
    assert len(service.load_data(session)["data"]["transactions"]) == 5000


# ---------------------------------------------------------------- minha conta


def test_perfil_foto_e_troca_de_email():
    session = new_vault()
    photo = "data:image/jpeg;base64," + "A" * 400
    acc = service.update_account(
        session,
        first_name="  Gui  ",
        last_name="Henn",
        email="gui@example.com",
        photo=photo,
        current_password=None,
    )
    assert acc["firstName"] == "Gui"
    assert acc["photo"] == photo
    assert registry.list_vaults()[0].photo == photo
    with pytest.raises(service.ServiceError) as err:
        service.update_account(
            session,
            first_name="Gui",
            last_name="",
            email="novo@example.com",
            photo=photo,
            current_password="errada",
        )
    assert err.value.code == "bad-password"
    acc = service.update_account(
        session,
        first_name="Gui",
        last_name="",
        email="novo@example.com",
        photo=None,
        current_password=PASSWORD,
    )
    assert acc["email"] == "novo@example.com"
    assert acc["photo"] is None
    service.login(session.vault_id, "novo@example.com", PASSWORD)
    for bad_photo in ("http://x/y.png", "data:image/gif;base64,AAAA", "data:image/png;base64,***"):
        with pytest.raises(registry.RegistryError):
            service.update_account(
                session,
                first_name="G",
                last_name="",
                email="novo@example.com",
                photo=bad_photo,
                current_password=None,
            )
    big = "data:image/png;base64," + base64.b64encode(b"\0" * 400 * 1024).decode()
    with pytest.raises(registry.RegistryError) as err:
        service.update_account(
            session,
            first_name="G",
            last_name="",
            email="novo@example.com",
            photo=big,
            current_password=None,
        )
    assert err.value.code == "photo-too-big"


def test_trocar_senha_mantem_esta_sessao_e_encerra_as_outras():
    session = new_vault()
    other = service.login(session.vault_id, "gui@example.com", PASSWORD)
    service.set_mail(
        session,
        provider="gmail",
        host="",
        port=0,
        security="",
        username="gui@gmail.com",
        from_name="Gui",
        password="app-pass-1",
    )
    with pytest.raises(service.ServiceError) as err:
        service.change_password(session, "errada", "nova-senha-456")
    assert err.value.code == "bad-password"
    with pytest.raises(service.ServiceError) as err:
        service.change_password(session, PASSWORD, PASSWORD)
    assert err.value.code == "same-password"
    closed = service.change_password(session, PASSWORD, "nova-senha-456")
    assert closed == 1
    assert SESSIONS.get(other.token) is None
    assert SESSIONS.get(session.token) is session
    with pytest.raises(service.ServiceError):
        service.login(session.vault_id, "gui@example.com", PASSWORD)
    LOGIN_THROTTLE.success(session.vault_id)
    reopened = service.login(session.vault_id, "gui@example.com", "nova-senha-456")
    # a senha do e-mail continua legível com a nova senha (mesma chave de dados)
    config, _ = service._mail_config(reopened)
    assert config.password == "app-pass-1"


def test_renomear_e_excluir_cofre_vai_para_a_lixeira(isolated_settings):
    session = new_vault()
    assert service.rename(session, "  Casa   e família ")["name"] == "Casa e família"
    with pytest.raises(service.ServiceError):
        service.delete_vault(session, "errada")
    service.delete_vault(session, PASSWORD)
    assert registry.vault_files() == []
    trashed = list((isolated_settings / "cofres" / "lixeira").glob("*.db"))
    assert len(trashed) == 1
    assert SESSIONS.get(session.token) is None
    backups = list((isolated_settings / "backups" / "cofres" / session.vault_id).glob("*.db"))
    assert len(backups) == 1
    with store.connect(trashed[0], readonly=True) as conn:
        assert store.read_owner(conn).first_name == "Guilherme"  # nada se perdeu


def test_arquivo_ilegivel_aparece_marcado(isolated_settings):
    new_vault()
    broken = isolated_settings / "cofres" / ("f" * 32 + ".db")
    broken.write_bytes(b"isto nao e um sqlite")
    states = {v.id: v.status for v in registry.list_vaults()}
    assert states["f" * 32] == "error"
    with pytest.raises(service.ServiceError) as err:
        service.login("f" * 32, "gui@example.com", PASSWORD)
    assert err.value.code == "unreadable"


def test_migracao_de_cofre_antigo_faz_backup_antes(isolated_settings, monkeypatch):
    session = new_vault()
    path = registry.path_for(session.vault_id)
    current = store.SCHEMA_VERSION
    monkeypatch.setitem(store._MIGRATIONS, current + 1, "CREATE TABLE nova (id TEXT PRIMARY KEY)")
    monkeypatch.setattr(store, "SCHEMA_VERSION", current + 1)
    assert registry.summary(path).status == "needs-update"
    service.login(session.vault_id, "gui@example.com", PASSWORD)
    with store.connect(path, readonly=True) as conn:
        assert store.schema_version(conn) == current + 1
    backups = list(
        (isolated_settings / "backups" / "cofres" / session.vault_id).glob("*pre-migration*.db")
    )
    assert len(backups) == 1
    monkeypatch.setattr(store, "SCHEMA_VERSION", current)
    assert registry.summary(path).status == "too-new"


# ---------------------------------------------------------------- e-mail


class _FakeSMTP:
    sent: list = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        if password != "app-pass-1":
            import smtplib

            raise smtplib.SMTPAuthenticationError(535, b"bad")
        self.calls.append(("login", user))

    def send_message(self, message):
        _FakeSMTP.sent.append((self, message))


def test_configurar_e_enviar_email_com_anexo():
    session = new_vault()
    with pytest.raises(service.ServiceError) as err:
        service.send_mail(session, subject="x", text="y", html=None, attachments=[])
    assert err.value.code == "mail-not-configured"
    public = service.set_mail(
        session,
        provider="gmail",
        host="ignorado",
        port=1,
        security="none",
        username="gui@gmail.com",
        from_name="Guilherme",
        password="app-pass-1",
    )
    assert public == {
        "provider": "gmail",
        "host": "smtp.gmail.com",
        "port": 587,
        "security": "starttls",
        "username": "gui@gmail.com",
        "fromName": "Guilherme",
        "hasPassword": True,
        "updatedAt": public["updatedAt"],
    }
    with store.connect(registry.path_for(session.vault_id), readonly=True) as conn:
        raw = store.read_mail(conn)
    assert "app-pass-1" not in raw["password_enc"]  # guardada cifrada

    _FakeSMTP.sent.clear()
    sender = lambda config, mail: mailer.send(config, mail, smtp=_FakeSMTP, smtp_ssl=_FakeSMTP)  # noqa: E731
    to = service.send_mail(
        session,
        subject="Lume: planilha 2026",
        text="Segue.",
        html="<p>Segue.</p>",
        attachments=[
            mailer.Attachment("lume-ir-2026.xlsx", "application/vnd.ms-excel", b"PK\x03\x04")
        ],
        sender=sender,
    )
    assert to == "gui@example.com"
    client, message = _FakeSMTP.sent[0]
    assert client.calls[:3] == ["ehlo", "starttls", "ehlo"]
    assert ("login", "gui@gmail.com") in client.calls
    assert message["To"] == "gui@example.com"
    assert message["From"] == "Guilherme <gui@gmail.com>"
    names = [part.get_filename() for part in message.iter_attachments()]
    assert names == ["lume-ir-2026.xlsx"]

    # manter a senha (None) e trocá-la
    service.set_mail(
        session,
        provider="custom",
        host="smtp.exemplo.com.br",
        port=465,
        security="ssl",
        username="gui",
        from_name="",
        password=None,
    )
    config, _ = service._mail_config(session)
    assert config.password == "app-pass-1"
    assert config.from_address == "gui@example.com"  # usuário sem @: usa o e-mail do cofre
    service.set_mail(
        session,
        provider="custom",
        host="smtp.exemplo.com.br",
        port=465,
        security="ssl",
        username="gui",
        from_name="",
        password="trocada",
    )
    with pytest.raises(service.ServiceError) as err:
        service.send_mail(session, subject="x", text="y", html=None, attachments=[], sender=sender)
    assert err.value.code == "mail-auth"


def test_configuracao_de_email_insegura_e_recusada():
    session = new_vault()
    with pytest.raises(service.ServiceError) as err:
        service.set_mail(
            session,
            provider="custom",
            host="smtp.exemplo.com",
            port=25,
            security="none",
            username="u",
            from_name="",
            password="p",
        )
    assert err.value.code == "mail-config"
    with pytest.raises(service.ServiceError):
        service.set_mail(
            session,
            provider="custom",
            host="",
            port=25,
            security="starttls",
            username="u",
            from_name="",
            password="p",
        )


def test_limite_de_envios():
    session = new_vault()
    service.set_mail(
        session,
        provider="gmail",
        host="",
        port=0,
        security="",
        username="g@gmail.com",
        from_name="",
        password="app-pass-1",
    )
    sender = lambda config, mail: None  # noqa: E731
    for _ in range(20):
        service.send_mail(session, subject="x", text="y", html=None, attachments=[], sender=sender)
    with pytest.raises(service.ServiceError) as err:
        service.send_mail(session, subject="x", text="y", html=None, attachments=[], sender=sender)
    assert err.value.code == "mail-limit"


def test_anexos_grandes_demais():
    config = mailer.MailConfig("localhost", 25, "none", "", "", "a@b.co")
    big = mailer.Attachment(
        "a.bin", "application/octet-stream", b"0" * (mailer.MAX_ATTACHMENTS_BYTES + 1)
    )
    with pytest.raises(mailer.MailError) as err:
        mailer.build_message(config, mailer.Outgoing("x@y.co", "s", "t", attachments=[big]))
    assert err.value.code == "too-big"


class _SMTPHandler(socketserver.StreamRequestHandler):
    """Servidor SMTP mínimo (sem TLS) só para o teste de ponta a ponta do smtplib."""

    def handle(self):
        self.wfile.write(b"220 teste\r\n")
        data_mode = False
        lines = []
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if data_mode:
                if line == ".":
                    data_mode = False
                    self.server.messages.append("\n".join(lines))  # type: ignore[attr-defined]
                    lines = []
                    self.wfile.write(b"250 ok\r\n")
                else:
                    lines.append(line)
                continue
            verb = line.split(" ")[0].upper()
            if verb in ("EHLO", "HELO"):
                self.wfile.write(b"250-teste\r\n250 SIZE 50000000\r\n")
            elif verb == "DATA":
                data_mode = True
                self.wfile.write(b"354 manda\r\n")
            elif verb == "QUIT":
                self.wfile.write(b"221 tchau\r\n")
                return
            else:
                self.wfile.write(b"250 ok\r\n")


def test_envio_real_por_smtp_local():
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SMTPHandler)
    server.messages = []  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        config = mailer.MailConfig("127.0.0.1", port, "none", "", "", "lume@example.com", "Lume")
        mailer.send(
            config,
            mailer.Outgoing(
                "gui@example.com",
                "Relatório",
                "Olá",
                attachments=[mailer.Attachment("a.csv", "text/csv", b"a;b\n1;2")],
            ),
        )
        assert len(server.messages) == 1  # type: ignore[attr-defined]
        assert (
            "Subject: =?utf-8?q?Relat=C3=B3rio?=" in server.messages[0]
            or "Relat" in server.messages[0]
        )  # type: ignore[attr-defined]
        assert 'filename="a.csv"' in server.messages[0]  # type: ignore[attr-defined]
        # Porta fechada. No Linux e no macOS a recusa é imediata; no Windows leva uns 2 s
        # (o sistema insiste antes de desistir), por isso o tempo-limite é folgado.
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
        probe.close()
        with pytest.raises(mailer.MailError) as err:
            mailer.send(
                mailer.MailConfig("127.0.0.1", closed_port, "none", "", "", "a@b.co"),
                mailer.Outgoing("x@y.co", "s", "t"),
                timeout=15,
            )
        assert err.value.code in {"connect", "timeout"}
    finally:
        server.shutdown()
        server.server_close()


def test_modelos_validam_como_o_front():
    with pytest.raises(Exception):  # noqa: B017
        models.Bank.model_validate(bank(color="roxo"))
    with pytest.raises(Exception):  # noqa: B017
        models.Investment.model_validate(inv(type="tulipa"))
    report = models.Report.model_validate(
        {
            "id": "r",
            "name": "n",
            "groupBy": "bank",
            "createdAt": NOW,
            "filters": {"from": "2026-01-01", "kinds": [], "categoryIds": [], "bankIds": []},
        }
    )
    assert report.filters.model_dump(by_alias=True, exclude_none=True)["from"] == "2026-01-01"
    assert copy.deepcopy(state())["banks"][0]["code"] == "260"
