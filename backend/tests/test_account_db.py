"""Minha conta, sair, trocar de cofre e ocultar valores, do lado do servidor: sessões vencidas
saem da memória (com a chave do cofre), a troca de senha conta só sessões valendo, a troca de
e-mail com senha errada não grava nada, sair encerra a sessão e apaga o cookie, e a lista de
cofres continua rápida com cofres grandes."""

import shutil
import sqlite3
import time

import pytest
from test_vaults import NOW, PASSWORD, new_vault, state, tx

from app.vaults import registry, service, store
from app.vaults.sessions import LOGIN_THROTTLE, SESSIONS, SessionStore

# ---------------------------------------------------------------- sessões


def test_sessoes_vencidas_saem_da_memoria_com_a_chave():
    clock = [0.0]
    sessions = SessionStore(idle=60, maximum=600, clock=lambda: clock[0])
    old = [sessions.create("v", "o", b"k" * 32) for _ in range(5)]
    assert len(sessions) == 5
    clock[0] = 61  # todas passaram de 1 minuto sem uso
    fresh = sessions.create("v", "o", b"n" * 32)
    # Antes: as 5 continuavam na memória até o mesmo cookie voltar (abas fechadas, nunca).
    assert len(sessions) == 1
    assert all(sessions.get(s.token) is None for s in old)
    assert sessions.get(fresh.token) is fresh


def test_troca_de_senha_conta_so_as_sessoes_que_valiam():
    clock = [0.0]
    sessions = SessionStore(idle=60, maximum=600, clock=lambda: clock[0])
    sessions.create("v", "o", b"k")  # vai vencer
    clock[0] = 50
    alive = sessions.create("v", "o", b"k")
    other_vault = sessions.create("w", "o", b"k")
    mine = sessions.create("v", "o", b"k")
    clock[0] = 100
    # Antes: 2 ("1 outra sessão" vencida também contava).
    assert sessions.revoke_vault("v", keep=mine.token) == 1
    assert sessions.get(alive.token) is None
    assert sessions.get(mine.token) is mine
    assert sessions.get(other_vault.token) is other_vault


# ---------------------------------------------------------------- minha conta


def test_troca_de_email_com_senha_errada_nao_grava_nada():
    session = new_vault()
    with pytest.raises(service.ServiceError) as err:
        service.update_account(
            session,
            first_name="Outro",
            last_name="Nome",
            email="novo@example.com",
            current_password="senha errada",
        )
    assert err.value.code == "bad-password"
    acc = service.account(session)
    assert (acc["firstName"], acc["lastName"], acc["email"]) == (
        "Guilherme",
        "Henn",
        "gui@example.com",
    )
    LOGIN_THROTTLE.success(session.vault_id)


def test_mesmo_email_com_maiusculas_e_espacos_nao_pede_senha():
    session = new_vault()
    acc = service.update_account(
        session, first_name="Gui", last_name="H", email="  GUI@Example.com "
    )
    assert acc["firstName"] == "Gui"
    assert service.login(session.vault_id, "gui@example.com", PASSWORD).vault_id == session.vault_id


def test_troca_de_email_entra_no_limite_de_tentativas():
    session = new_vault()
    LOGIN_THROTTLE.success(session.vault_id)
    for _ in range(6):  # 5 erros sem espera; do 6º em diante, espera
        with pytest.raises(service.ServiceError):
            service.update_account(
                session,
                first_name="G",
                last_name="",
                email="x@example.com",
                current_password="errada",
            )
    with pytest.raises(service.ServiceError) as err:
        service.update_account(
            session, first_name="G", last_name="", email="x@example.com", current_password=PASSWORD
        )
    assert err.value.code == "throttled"  # nem com a senha certa, até passar a espera
    LOGIN_THROTTLE.success(session.vault_id)


def test_troca_de_email_vale_para_entrar_e_o_antigo_nao():
    session = new_vault()
    service.update_account(
        session, first_name="G", last_name="", email="novo@example.com", current_password=PASSWORD
    )
    assert service.login(session.vault_id, "novo@example.com", PASSWORD)
    with pytest.raises(service.ServiceError) as err:
        service.login(session.vault_id, "gui@example.com", PASSWORD)
    assert err.value.code == "bad-credentials"
    LOGIN_THROTTLE.success(session.vault_id)


@pytest.mark.parametrize("name", ["casa", "  CASA ", "Cása"])
def test_renomear_para_nome_de_outro_cofre_e_recusado(name):
    new_vault(name="Casa", email="a@example.com")
    other = new_vault(name="Pessoal", email="b@example.com")
    with pytest.raises(registry.RegistryError) as err:
        service.rename(other, name)
    assert err.value.code == "name-taken"
    assert service.rename(other, "  Viagens  ")["name"] == "Viagens"
    with pytest.raises(registry.RegistryError) as err:
        service.rename(other, "   ")
    assert err.value.code == "invalid-name"


def test_ocultar_valores_e_de_cada_cofre():
    a = new_vault(name="A", email="a@example.com")
    b = new_vault(name="B", email="b@example.com")
    service.update_settings(a, {"hideValues": True})
    assert service.session_info(a)["settings"]["hideValues"] is True
    assert service.session_info(b)["settings"]["hideValues"] is False


def test_excluir_encerra_as_sessoes_e_o_nome_fica_livre():
    session = new_vault(name="Casa")
    other_tab = service.login(session.vault_id, "gui@example.com", PASSWORD)
    service.delete_vault(session, PASSWORD)
    assert SESSIONS.get(session.token) is None and SESSIONS.get(other_tab.token) is None
    assert [v.name for v in registry.list_vaults()] == []
    backups = list(registry.vault_backups_dir(session.vault_id).glob("*before-delete*.db"))
    assert len(backups) == 1
    again = new_vault(name="Casa")
    assert again.vault_id != session.vault_id


# ---------------------------------------------------------------- lista de cofres


def test_lista_de_20_cofres_grandes_e_rapida():
    """A tela de escolha (ao sair e ao trocar de cofre) abre cada cofre e conta os lançamentos."""
    many = [
        tx(
            f"t{i:06d}",
            amount=100 + i,
            date=f"{2000 + i % 27}-{1 + i % 12:02d}-{1 + i % 28:02d}",
            createdAt=NOW,
        )
        for i in range(100_000)
    ]
    session = new_vault(data=state(transactions=many, investments=[]))
    source = registry.path_for(session.vault_id)
    with store.connect(source) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    for i in range(19):
        copy = source.with_name(f"{i:032x}.db")
        shutil.copy(source, copy)
        conn = sqlite3.connect(copy)
        conn.execute("UPDATE meta SET value = ? WHERE key = 'name'", (f"Cofre {i}",))
        conn.commit()
        conn.close()
    registry.list_vaults()
    started = time.perf_counter()
    found = registry.list_vaults()
    elapsed = time.perf_counter() - started
    print(f"\n  lista de 20 cofres com 100 mil lançamentos cada: {elapsed * 1000:.0f} ms")
    assert len(found) == 20 and all(v.entries == 100_000 for v in found)
    assert elapsed < 1.5


# ---------------------------------------------------------------- pela API

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402
from test_vault_api import LOCAL, H, create  # noqa: E402

from app.main import create_app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=LOCAL) as c:
        yield c


def test_sair_encerra_a_sessao_e_apaga_o_cookie(client):
    create(client)
    assert client.get("/api/session").status_code == 200
    assert client.delete("/api/session").status_code == 403  # sem o cabeçalho do app, nada feito
    assert client.get("/api/session").status_code == 200
    resp = client.delete("/api/session", headers=H)
    assert resp.status_code == 204
    cookie = resp.headers.get("set-cookie", "")
    assert cookie.startswith("lume_session=") and "Max-Age=0" in cookie
    assert client.get("/api/session").status_code == 401
    assert client.get("/api/vault/data").status_code == 401
    # Sair de novo (outra aba, clique duplo) não dá erro.
    assert client.delete("/api/session", headers=H).status_code == 204
