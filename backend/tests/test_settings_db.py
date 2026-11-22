"""Configurações: cada valor conferido sozinho (um estragado não leva os outros), gravação por
chave (duas janelas não se atropelam) e a cópia do cofre antes de trocar tudo de uma vez
(restaurar backup, carregar o exemplo, apagar tudo)."""

import sqlite3
import time

import pytest
from pydantic import ValidationError
from test_vaults import NOW, PASSWORD, bank, category, new_vault, state, tx

from app.services import backup
from app.vaults import registry, service, store


def _changes(base, upserts=None, deletes=None, **extra):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}, **extra}


def _settings(session) -> dict:
    return service.session_info(session)["settings"]


def _raw(session, sql, *params):
    with store.connect(registry.path_for(session.vault_id)) as conn, store.transaction(conn):
        conn.execute(sql, params)


# ---------------------------------------------------------------- configurações


def test_valor_estragado_volta_ao_padrao_sem_levar_os_outros():
    session = new_vault()
    service.update_settings(session, {"language": "en", "theme": "light", "currency": "USD"})
    _raw(session, "UPDATE settings SET value = ? WHERE key = 'theme'", '"roxo"')
    _raw(session, "INSERT INTO settings (key, value) VALUES ('hide_values', 'não é json')")
    got = _settings(session)
    assert got["language"] == "en"  # antes: tudo voltava ao padrão por causa de um valor
    assert got["currency"] == "USD"
    assert got["theme"] == "dark"
    assert got["hideValues"] is False


def test_chave_desconhecida_fica_no_arquivo_e_nao_aparece():
    session = new_vault()
    _raw(session, "INSERT INTO settings (key, value) VALUES ('coisa_do_futuro', '42')")
    service.update_settings(session, {"theme": "system"})
    assert "coisaDoFuturo" not in _settings(session)
    with store.connect(registry.path_for(session.vault_id), readonly=True) as conn:
        kept = conn.execute("SELECT value FROM settings WHERE key = 'coisa_do_futuro'").fetchone()
    assert kept["value"] == "42"


def test_gravar_uma_chave_nao_mexe_nas_outras():
    session = new_vault()
    service.update_settings(session, {"language": "es", "hideValues": True})
    service.update_settings(session, {"theme": "light", "language": None})
    got = _settings(session)
    assert (got["language"], got["theme"], got["hideValues"]) == ("es", "light", True)
    assert service.update_settings(session, {}) == got


@pytest.mark.parametrize(
    "patch",
    [
        {"theme": "roxo"},
        {"currency": "BTC"},
        {"language": "fr"},
        {"hideValues": "talvez"},
        {"x": 1},
    ],
)
def test_valor_invalido_ou_chave_desconhecida_e_recusado(patch):
    session = new_vault()
    with pytest.raises(ValidationError):
        service.update_settings(session, patch)


def test_duas_janelas_gravam_chaves_diferentes_sem_perder_nada():
    session = new_vault()
    other = service.login(session.vault_id, "gui@example.com", PASSWORD)
    service.update_settings(session, {"theme": "light"})
    service.update_settings(other, {"currency": "EUR"})
    service.update_settings(session, {"hideValues": True})
    got = _settings(other)
    assert (got["theme"], got["currency"], got["hideValues"]) == ("light", "EUR", True)


# ---------------------------------------------------------------- cópia antes de trocar tudo


def _count(path, table: str) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]  # noqa: S608 - nome fixo
    finally:
        conn.close()


@pytest.mark.parametrize("reason", ["before-restore", "before-sample", "before-reset"])
def test_copia_do_cofre_antes_de_trocar_tudo(reason):
    session = new_vault(data=state(transactions=[tx(f"t{i}") for i in range(30)], investments=[]))
    before = service.vault_backups(session)["count"]
    payload = _changes(1, deletes={"transactions": [f"t{i}" for i in range(30)]}, checkpoint=reason)
    assert service.apply_changes(session, payload) == 2
    assert service.load_data(session)["data"]["transactions"] == []
    info = service.vault_backups(session)
    assert info["count"] == before + 1
    assert info["latest"]["reason"] == reason
    copy = backup.list_backups(registry.vault_backups_dir(session.vault_id))[0]
    assert copy.reason == reason
    assert _count(copy.path, "transactions") == 30  # a cópia tem os dados de antes
    assert backup.check_integrity(copy.path) == "ok"


def test_sem_a_copia_nada_e_gravado(monkeypatch):
    session = new_vault()
    rev = service.load_data(session)["revision"]

    def fail(*args, **kwargs):
        raise backup.BackupError("disco cheio")

    monkeypatch.setattr(backup, "create_backup", fail)
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(
            session, _changes(rev, deletes={"transactions": ["t1"]}, checkpoint="before-reset")
        )
    assert err.value.code == "storage"
    loaded = service.load_data(session)
    assert loaded["revision"] == rev
    assert [t["id"] for t in loaded["data"]["transactions"]] == ["t1"]


def test_lote_comum_nao_faz_copia_e_motivo_desconhecido_e_recusado():
    session = new_vault()
    before = service.vault_backups(session)["count"]
    service.apply_changes(session, _changes(1, {"transactions": [tx("t2")]}))
    assert service.vault_backups(session)["count"] == before
    with pytest.raises(ValidationError):
        service.apply_changes(
            session, _changes(2, {"transactions": [tx("t3")]}, checkpoint="whatever")
        )


def test_apagar_tudo_com_100_mil_lancamentos_com_a_copia():
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
    seed = {
        "banks": [bank("nb", name="Itaú", isPrimary=True)],
        "categories": [category("nc", nameKey="housing")],
    }
    deletes = {"transactions": [x["id"] for x in many], "banks": ["b1"], "categories": ["c1", "c2"]}
    started = time.perf_counter()
    service.apply_changes(session, _changes(1, seed, deletes, checkpoint="before-reset"))
    elapsed = time.perf_counter() - started
    print(f"\n  apagar tudo (100 mil lançamentos, com a cópia): {elapsed * 1000:.0f} ms")
    data = service.load_data(session)["data"]
    assert data["transactions"] == [] and [b["id"] for b in data["banks"]] == ["nb"]
    copy = backup.list_backups(registry.vault_backups_dir(session.vault_id))[0]
    assert _count(copy.path, "transactions") == 100_000
    assert elapsed < 10


def test_lista_de_copias_de_um_cofre_sem_nenhuma():
    session = new_vault()
    for item in backup.list_backups(registry.vault_backups_dir(session.vault_id)):
        item.path.unlink()
    assert service.vault_backups(session) == {"count": 0, "latest": None}


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


def test_api_copias_e_configuracoes(client):
    assert client.get("/api/vault/backups").status_code == 401
    create(client)
    info = client.get("/api/vault/backups", headers=H).json()
    assert set(info) == {"count", "latest"}
    bad = client.put("/api/vault/settings", headers=H, json={"theme": "roxo"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid"
    ok = client.put("/api/vault/settings", headers=H, json={"theme": "light"})
    assert ok.status_code == 200 and ok.json()["theme"] == "light"
    rev = client.get("/api/vault/data", headers=H).json()["revision"]
    body = {
        "baseRevision": rev,
        "upserts": {},
        "deletes": {"transactions": ["t1"]},
        "checkpoint": "before-reset",
    }
    assert client.post("/api/vault/changes", headers=H, json=body).status_code == 200
    after = client.get("/api/vault/backups", headers=H).json()
    assert after["latest"]["reason"] == "before-reset"
