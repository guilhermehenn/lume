"""Banco do cofre (revisão de DBA): formato, criação atômica, migração, integridade,
concorrência, queda no meio da gravação, disco cheio, texto estranho, desempenho e o
código de recuperação."""

import os
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
from test_vaults import PASSWORD, bank, category, new_vault, new_vault_with_code, state, tx

from app.vaults import crypto, models, registry, service, store
from app.vaults.maintenance import prepare_vaults
from app.vaults.sessions import LOGIN_THROTTLE

BACKEND = Path(__file__).resolve().parents[1]


def _path(session) -> Path:
    return registry.path_for(session.vault_id)


def _changes(base, upserts=None, deletes=None):
    return {"baseRevision": base, "upserts": upserts or {}, "deletes": deletes or {}}


# ---------------------------------------------------------------- formato do arquivo


def test_arquivo_novo_tem_marca_formato_e_nada_pendente(isolated_settings):
    session = new_vault()
    path = _path(session)
    # Logo depois de criar: só o arquivo final, sem -wal pendente nem sobra temporária.
    folder = isolated_settings / "cofres"
    assert sorted(p.name for p in folder.iterdir()) == sorted([path.name, "lixeira"])
    with store.connect(path, readonly=True) as conn:
        assert conn.execute("PRAGMA application_id").fetchone()[0] == store.APPLICATION_ID
        assert store.schema_version(conn) == store.SCHEMA_VERSION
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_conexao_liga_chaves_estrangeiras_e_gravacao_duravel(isolated_settings):
    path = _path(new_vault())
    with store.connect(path) as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM banks WHERE id = 'b1'")  # há lançamento nele
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE transactions SET amount = 0")  # CHECK amount > 0


def test_um_so_banco_principal_garantido_pelo_banco(isolated_settings):
    path = _path(new_vault(data=state(banks=[bank(isPrimary=True), bank("b2")])))
    with store.connect(path) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE banks SET is_primary = 1 WHERE id = 'b2'")


def test_trocar_banco_principal_em_qualquer_ordem(isolated_settings):
    session = new_vault(data=state(banks=[bank(isPrimary=True), bank("b2")]))
    # O novo principal vem antes do antigo na lista: o índice único não pode reclamar.
    rev = service.apply_changes(
        session,
        _changes(1, {"banks": [bank("b2", isPrimary=True), bank("b1", isPrimary=False)]}),
    )
    assert rev == 2
    data = service.load_data(session)["data"]
    assert [b["id"] for b in data["banks"] if b.get("isPrimary")] == ["b2"]
    with pytest.raises(service.ServiceError) as err:
        service.apply_changes(session, _changes(2, {"banks": [bank("b1", isPrimary=True)]}))
    assert err.value.code == "invalid"
    assert service.load_data(session)["revision"] == 2  # nada foi gravado


# ---------------------------------------------------------------- criação atômica


def test_falha_no_meio_da_criacao_nao_deixa_nada(isolated_settings, monkeypatch):
    new_vault("Primeiro")

    def disk_full(*_args, **_kwargs):
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(store, "replace_state", disk_full)
    with pytest.raises(store.VaultError) as err:
        new_vault("Segundo")
    assert err.value.code == "storage"
    names = [v.name for v in registry.list_vaults()]
    assert names == ["Primeiro"]
    folder = isolated_settings / "cofres"
    assert not list(folder.glob("*.creating*"))
    assert len(list(folder.glob("*.db"))) == 1


def test_lista_nunca_mostra_cofre_pela_metade(isolated_settings, monkeypatch):
    seen: list[list[str]] = []
    original = store.replace_state

    def spy(conn, data):
        seen.append([v.name for v in registry.list_vaults()])  # no meio da criação
        return original(conn, data)

    monkeypatch.setattr(store, "replace_state", spy)
    new_vault("Pessoal")
    assert seen == [[]]
    assert [v.name for v in registry.list_vaults()] == ["Pessoal"]


def test_sobras_de_criacao_interrompida_sao_apagadas_ao_abrir(isolated_settings):
    new_vault()
    folder = isolated_settings / "cofres"
    (folder / ("a" * 32 + ".creating")).write_bytes(b"pela metade")
    (folder / ("a" * 32 + ".creating-wal")).write_bytes(b"")
    prepare_vaults(run_backup=False)
    assert not list(folder.glob("*.creating*"))
    assert len(registry.list_vaults()) == 1


# ---------------------------------------------------------------- migração v1 → v2


def _make_v1_vault(folder: Path, monkeypatch) -> tuple[str, Path]:
    """Cofre como a v0.3.0 criava (formato 1), com dois bancos principais (dado ruim)."""
    vault_id = "b" * 32
    path = folder / f"{vault_id}.db"
    folder.mkdir(parents=True, exist_ok=True)
    key = crypto.new_data_key()
    with monkeypatch.context() as m:
        m.setattr(store, "SCHEMA_VERSION", 1)
        with store.connect(path) as conn:
            store.migrate(conn)
            with store.transaction(conn):
                for k, v in (("vault_id", vault_id), ("name", "Antigo"), ("revision", "1")):
                    store.set_meta(conn, k, v)
                conn.execute(
                    "INSERT INTO owner (id, first_name, last_name, email, photo, password_hash,"
                    " key_wrap, created_at, updated_at, password_changed_at)"
                    " VALUES ('o1', 'Ana', 'Lima', 'ana@example.com', NULL, ?, ?, ?, ?, ?)",
                    (
                        crypto.hash_password(PASSWORD),
                        crypto.wrap_key(key, PASSWORD, vault_id),
                        "2026-11-20T10:00:00+00:00",
                        "2026-11-20T10:00:00+00:00",
                        "2026-11-20T10:00:00+00:00",
                    ),
                )
                conn.execute(
                    "INSERT INTO banks (id, name, kind, color, initial_balance, is_primary,"
                    " created_at, updated_at) VALUES"
                    " ('b1', 'A', 'digital', '#000000', 0, 1, 'x', 'x'),"
                    " ('b2', 'B', 'digital', '#000000', 0, 1, 'x', 'x')"
                )
    return vault_id, path


def test_migracao_do_formato_1_preserva_dados_e_corrige(isolated_settings, monkeypatch):
    vault_id, path = _make_v1_vault(isolated_settings / "cofres", monkeypatch)
    assert registry.status(path) == "needs-update"
    # Senha errada não migra nada (a atualização só acontece depois de entrar)
    with pytest.raises(service.ServiceError):
        service.login(vault_id, "ana@example.com", "errada errada")
    with store.connect(path, readonly=True) as conn:
        assert store.schema_version(conn) == 1
    LOGIN_THROTTLE.success(vault_id)

    session = service.login(vault_id, "ana@example.com", PASSWORD)
    with store.connect(path, readonly=True) as conn:
        assert store.schema_version(conn) == store.SCHEMA_VERSION
        assert conn.execute("PRAGMA application_id").fetchone()[0] == store.APPLICATION_ID
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        primaries = conn.execute("SELECT id FROM banks WHERE is_primary = 1").fetchall()
        assert [r[0] for r in primaries] == ["b1"]  # o primeiro continua principal
    account = service.account(session)
    assert account["firstName"] == "Ana"
    assert account["recovery"] == {"createdAt": None, "confirmed": False}
    backups = list((isolated_settings / "backups" / "cofres" / vault_id).glob("*pre-migration*"))
    assert len(backups) == 1
    # Formato 1 de embrulho da chave continua abrindo
    assert service.new_recovery_code(session, PASSWORD)


# ---------------------------------------------------------------- integridade


def test_corrupcao_no_meio_do_arquivo_e_detectada(isolated_settings):
    session = new_vault(data=state(transactions=[tx(f"t{i}") for i in range(400)]))
    path = _path(session)
    service.logout(session.token)
    raw = bytearray(path.read_bytes())
    middle = len(raw) // 2
    raw[middle : middle + 4096] = b"\xff" * 4096
    path.write_bytes(bytes(raw))
    reports = prepare_vaults(run_backup=False)
    assert reports[0].status == "damaged"


def test_sqlite_que_nao_e_cofre_aparece_como_ilegivel(isolated_settings):
    folder = isolated_settings / "cofres"
    folder.mkdir(parents=True)
    other = folder / ("c" * 32 + ".db")
    with sqlite3.connect(other) as conn:
        conn.execute("CREATE TABLE qualquer (x)")
    assert registry.status(other) == "error"
    with pytest.raises(service.ServiceError) as err:
        service.login("c" * 32, "a@b.co", PASSWORD)
    assert err.value.code == "unreadable"


# ---------------------------------------------------------------- concorrência e quedas


def test_duas_gravacoes_ao_mesmo_tempo_uma_vence_a_outra_recarrega(isolated_settings):
    session = new_vault()
    results: list[str] = []
    barrier = threading.Barrier(2)

    def write(i: int) -> None:
        barrier.wait()
        try:
            service.apply_changes(session, _changes(1, {"transactions": [tx(f"n{i}")]}))
            results.append("ok")
        except service.ServiceError as exc:
            results.append(exc.code)

    threads = [threading.Thread(target=write, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    assert sorted(results) == ["conflict", "ok"]
    assert service.load_data(session)["revision"] == 2


def test_leitura_nao_espera_gravacao_em_andamento(isolated_settings):
    session = new_vault()
    path = _path(session)
    with store.connect(path) as writer:
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("UPDATE meta SET value = '99' WHERE key = 'revision'")
        started = time.perf_counter()
        assert service.load_data(session)["revision"] == 1  # vê o que já estava gravado
        assert time.perf_counter() - started < 2
        writer.execute("ROLLBACK")


_CRASH_SCRIPT = r"""
import sys
from app.vaults import service, store, registry
from app.vaults.sessions import SESSIONS
vault_id = sys.argv[1]
path = registry.path_for(vault_id)
session = SESSIONS.create(vault_id, "x", b"0" * 32)
i = 0
while True:
    with store.connect(path, readonly=True) as conn:
        rev = store.revision(conn)
    service.apply_changes(session, {"baseRevision": rev, "upserts": {"transactions": [{
        "id": f"crash{i}", "kind": "expense", "amount": 100, "date": "2026-01-01",
        "bankId": "b1", "categoryId": "c1", "counterparty": "x",
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"}]}})
    i += 1
"""


def test_processo_morto_no_meio_das_gravacoes_nao_corrompe(isolated_settings):
    session = new_vault()
    path = _path(session)
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(BACKEND), *sys.path])}
    proc = subprocess.Popen(  # noqa: S603 - script fixo deste teste
        [sys.executable, "-c", _CRASH_SCRIPT, session.vault_id], cwd=BACKEND, env=env
    )
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            with store.connect(path, readonly=True) as conn:
                if store.revision(conn) >= 15:
                    break
            assert proc.poll() is None, "o processo de gravação terminou sozinho"
            time.sleep(0.05)
    finally:
        proc.kill()  # sem aviso, como queda de energia do processo
        proc.wait(10)
    with store.connect(path) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        rev = store.revision(conn)
        crashed = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE id LIKE 'crash%'"
        ).fetchone()[0]
    # Cada gravação confirmada aumentou a revisão em 1 e trouxe exatamente 1 lançamento.
    assert crashed == rev - 1
    assert rev >= 15


def test_disco_cheio_desfaz_a_gravacao_inteira(isolated_settings, monkeypatch):
    session = new_vault()
    path = _path(session)
    original = store.connect

    from contextlib import contextmanager

    @contextmanager
    def tiny(p, *, readonly=False):
        with original(p, readonly=readonly) as conn:
            if not readonly:
                pages = conn.execute("PRAGMA page_count").fetchone()[0]
                conn.execute(f"PRAGMA max_page_count = {pages + 1}")
            yield conn

    monkeypatch.setattr(store, "connect", tiny)
    many = [tx(f"big{i}", note="x" * 400) for i in range(600)]
    with pytest.raises(sqlite3.OperationalError):
        service.apply_changes(session, _changes(1, {"transactions": many}))
    monkeypatch.setattr(store, "connect", original)
    data = service.load_data(session)
    assert data["revision"] == 1
    assert len(data["data"]["transactions"]) == 1
    with store.connect(path) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


# ---------------------------------------------------------------- texto estranho


def test_nomes_com_unicode_invisiveis_e_sql(isolated_settings):
    session = new_vault("Robert'); DROP TABLE banks;--")
    assert registry.summary(_path(session)).name == "Robert'); DROP TABLE banks;--"
    created, _ = service.create(
        name="Família \U0001f468‍\U0001f469‍\U0001f467",
        first_name="José‮",  # "é" decomposto + caractere que inverte o texto
        last_name="  da   Silva\u0000 ",
        email="  JOSE@Example.COM ",
        password=PASSWORD,
        data=state(),
        settings=None,
    )
    info = registry.summary(_path(created))
    assert info.name == "Família \U0001f468‍\U0001f469‍\U0001f467"
    assert info.owner_first_name == "José"
    assert info.owner_last_name == "da Silva"
    service.logout(created.token)
    service.login(created.vault_id, "jose@example.com", PASSWORD)


def test_nome_de_cofre_repetido_e_recusado(isolated_settings):
    first = new_vault("Pessoal")
    with pytest.raises(store.VaultError) as err:
        new_vault("  pÉSSOAL ")
    assert err.value.code == "name-taken"
    other = new_vault("Casa")
    with pytest.raises(store.VaultError) as err:
        service.rename(other, "pessoal")
    assert err.value.code == "name-taken"
    assert service.rename(first, "PESSOAL")["name"] == "PESSOAL"  # o próprio pode mudar caixa


def test_senha_com_acentos_em_qualquer_forma(isolated_settings):
    composed = "café com pão"
    decomposed = "café com pão"
    session, _ = service.create(
        name="X",
        first_name="A",
        last_name="",
        email="a@b.co",
        password=composed,
        data=None,
        settings=None,
    )
    service.logout(session.token)
    service.login(session.vault_id, "a@b.co", decomposed)  # mesmo texto, outra forma


def test_senha_gravada_antes_da_normalizacao_continua_valendo():
    raw = "ﬁnanças 2026"  # ligadura "ﬁ": NFKC vira "fi"
    legacy = crypto._scrypt(raw, b"s" * 16)  # como a v0.3.0 gravava (sem normalizar)
    stored = f"scrypt${crypto.SCRYPT_N}$8$1${crypto._b64(b's' * 16)}${crypto._b64(legacy)}"
    assert crypto.verify_password(raw, stored)
    key = crypto.new_data_key()
    salt, nonce = os.urandom(16), os.urandom(12)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    sealed = AESGCM(crypto._scrypt(raw, salt)).encrypt(nonce, key, b"v")
    v1 = f"v1${crypto._b64(salt)}${crypto._b64(nonce)}${crypto._b64(sealed)}"
    assert crypto.unwrap_key(v1, raw, "v") == key


# ---------------------------------------------------------------- código de recuperação


def test_codigo_de_recuperacao_troca_a_senha_sem_perder_nada(isolated_settings):
    session, code = new_vault_with_code()
    assert crypto.is_recovery_code(code)
    assert service.account(session)["recovery"]["confirmed"] is False
    assert service.confirm_recovery_code(session)["confirmed"] is True
    service.set_mail(
        session,
        provider="gmail",
        host="",
        port=0,
        security="starttls",
        username="g@gmail.com",
        from_name="",
        password="app-pass",
    )
    vault_id = session.vault_id

    for email, attempt in (("gui@example.com", "AAAAA-AAAAA-AAAAA-AAAAA"), ("x@y.co", code)):
        with pytest.raises(service.ServiceError) as err:
            service.recover(vault_id, email, attempt, "nova senha 123")
        assert err.value.code == "bad-recovery"
    LOGIN_THROTTLE.success(vault_id)

    typed = code.lower().replace("-", " ").replace("0", "o")  # do jeito que alguém digita
    new_session, new_code = service.recover(vault_id, "gui@example.com", typed, "nova senha 123")
    assert new_code != code
    assert service.account(new_session)["recovery"]["confirmed"] is False
    assert SESSIONS_count(vault_id) == 1  # as outras sessões foram encerradas
    with pytest.raises(service.ServiceError):
        service.login(vault_id, "gui@example.com", PASSWORD)
    LOGIN_THROTTLE.success(vault_id)
    service.login(vault_id, "gui@example.com", "nova senha 123")
    config, _to = service._mail_config(new_session)
    assert config.password == "app-pass"  # mesma chave de dados
    with pytest.raises(service.ServiceError):
        service.recover(vault_id, "gui@example.com", code, "outra senha 456")  # código usado
    folder = isolated_settings / "backups" / "cofres" / vault_id
    assert list(folder.glob("*before-recovery*"))


def SESSIONS_count(vault_id: str) -> int:  # noqa: N802
    from app.vaults.sessions import SESSIONS

    return sum(1 for s in SESSIONS._sessions.values() if s.vault_id == vault_id)


def test_gerar_codigo_novo_pede_senha_e_invalida_o_antigo(isolated_settings):
    session, old = new_vault_with_code()
    with pytest.raises(service.ServiceError) as err:
        service.new_recovery_code(session, "errada errada")
    assert err.value.code == "bad-password"
    new = service.new_recovery_code(session, PASSWORD)
    assert new != old
    with pytest.raises(service.ServiceError):
        service.recover(session.vault_id, "gui@example.com", old, "nova senha 123")
    service.recover(session.vault_id, "gui@example.com", new, "nova senha 123")


def test_redefinir_pelo_terminal_apaga_o_codigo_antigo(isolated_settings):
    session, code = new_vault_with_code()
    service.reset_password_offline(session.vault_id, "terminal 12345")
    with pytest.raises(service.ServiceError) as err:
        service.recover(session.vault_id, "gui@example.com", code, "nova senha 123")
    assert err.value.code == "bad-recovery"
    fresh = service.login(session.vault_id, "gui@example.com", "terminal 12345")
    assert service.account(fresh)["recovery"]["createdAt"] is None


# ---------------------------------------------------------------- desempenho


def test_desempenho_com_muitos_dados_e_muitos_cofres(isolated_settings):
    many = state(transactions=[tx(f"t{i}", note=f"nota {i}") for i in range(20_000)])
    models.DataState.model_validate(many)  # pré-aquecimento do pydantic
    started = time.perf_counter()
    session = new_vault(data=many)
    created_in = time.perf_counter() - started

    started = time.perf_counter()
    loaded = service.load_data(session)
    loaded_in = time.perf_counter() - started
    assert len(loaded["data"]["transactions"]) == 20_000

    started = time.perf_counter()
    service.apply_changes(session, _changes(1, {"transactions": [tx("novo")]}))
    saved_in = time.perf_counter() - started

    for i in range(25):
        new_vault(f"Cofre {i}", data=state(banks=[bank()], categories=[category()]))
    started = time.perf_counter()
    assert len(registry.list_vaults()) == 26
    listed_in = time.perf_counter() - started
    print(
        f"\n  criar 20k: {created_in:.2f}s · carregar 20k: {loaded_in:.2f}s"
        f" · gravar 1: {saved_in * 1000:.0f}ms · listar 26 cofres: {listed_in * 1000:.0f}ms"
    )
    # Limites folgados (máquinas lentas, antivírus); o normal é bem menos.
    assert created_in < 15
    assert loaded_in < 5
    assert saved_in < 2
    assert listed_in < 5


def test_dois_pedidos_iguais_ao_mesmo_tempo_criam_um_cofre_so(isolated_settings):
    results: list[str] = []
    barrier = threading.Barrier(4)

    def create() -> None:
        barrier.wait()
        try:
            new_vault("Pessoal")
            results.append("ok")
        except store.VaultError as exc:
            results.append(exc.code)

    threads = [threading.Thread(target=create) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(results) == ["name-taken", "name-taken", "name-taken", "ok"]
    assert [v.name for v in registry.list_vaults()] == ["Pessoal"]
