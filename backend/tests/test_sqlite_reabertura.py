"""Reabertura do cofre após erro transitório do SQLite no Windows."""

import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from app.vaults import store


def erro_sqlite(codigo):
    erro = sqlite3.OperationalError("erro simulado de SQLite")
    erro.sqlite_errorcode = codigo
    return erro


class ConexaoQueFalhaNaConfiguracao:
    def __init__(self, conexao, erro):
        self.conexao = conexao
        self.erro = erro
        self.row_factory = None
        self.fechada = False

    def execute(self, sql):
        if sql == "PRAGMA journal_mode=WAL":
            raise self.erro
        return self.conexao.execute(sql)

    def close(self):
        self.fechada = True
        self.conexao.close()


class TestReaberturaSqlite(unittest.TestCase):
    def setUp(self):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        self.path = Path(pasta.name) / "cofre.db"
        self.sqlite_connect = sqlite3.connect

    def test_reabre_no_windows_e_fecha_conexao_que_falhou(self):
        tentativas = []
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_TRUNCATE)

        def abrir(*args, **kwargs):
            conn = self.sqlite_connect(*args, **kwargs)
            if not tentativas:
                conn = ConexaoQueFalhaNaConfiguracao(conn, falha)
            tentativas.append(conn)
            return conn

        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(store.sqlite3, "connect", side_effect=abrir),
            mock.patch.object(store.time, "sleep") as espera,
            store.connect(self.path) as conn,
        ):
            conn.execute("CREATE TABLE dados (valor INTEGER)")
            conn.execute("INSERT INTO dados VALUES (42)")
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conn.execute("SELECT valor FROM dados").fetchone()[0], 42)
        self.assertEqual(len(tentativas), 2)
        self.assertTrue(tentativas[0].fechada)
        espera.assert_called_once()

    def test_erro_persistente_no_windows_nao_e_ignorado(self):
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_TRUNCATE)
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(store.sqlite3, "connect", side_effect=falha) as abrir,
            mock.patch.object(store.time, "monotonic", side_effect=[0, 0, 1, 2, 3]),
            mock.patch.object(store.time, "sleep") as espera,
            self.assertRaises(sqlite3.OperationalError) as erro,
            store.connect(self.path),
        ):
            self.fail("Uma conexão que falha não pode ser usada")
        self.assertIs(erro.exception, falha)
        self.assertEqual(abrir.call_count, 4)
        self.assertEqual(espera.call_count, 3)

    def test_reabre_em_modo_somente_leitura(self):
        with closing(self.sqlite_connect(self.path)) as conn:
            conn.execute("CREATE TABLE dados (valor INTEGER)")
            conn.execute("INSERT INTO dados VALUES (42)")
            conn.commit()
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_TRUNCATE)
        conn_ro = self.sqlite_connect(self.path.resolve().as_uri() + "?mode=ro", uri=True)
        self.addCleanup(conn_ro.close)
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(store.sqlite3, "connect", side_effect=[falha, conn_ro]) as abrir,
            mock.patch.object(store.time, "sleep"),
            store.connect(self.path, readonly=True) as conn,
        ):
            self.assertEqual(conn.execute("SELECT valor FROM dados").fetchone()[0], 42)
        self.assertEqual(abrir.call_count, 2)

    def test_outro_erro_no_windows_nao_e_repetido(self):
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_WRITE)
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(store.sqlite3, "connect", side_effect=falha) as abrir,
            mock.patch.object(store.time, "sleep") as espera,
            self.assertRaises(sqlite3.OperationalError) as erro,
            store.connect(self.path),
        ):
            self.fail("Uma conexão que falha não pode ser usada")
        self.assertIs(erro.exception, falha)
        abrir.assert_called_once()
        espera.assert_not_called()

    def test_erro_igual_fora_do_windows_nao_e_repetido(self):
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_TRUNCATE)
        with (
            mock.patch.object(sys, "platform", "linux"),
            mock.patch.object(store.sqlite3, "connect", side_effect=falha) as abrir,
            mock.patch.object(store.time, "sleep") as espera,
            self.assertRaises(sqlite3.OperationalError) as erro,
            store.connect(self.path),
        ):
            self.fail("Uma conexão que falha não pode ser usada")
        self.assertIs(erro.exception, falha)
        abrir.assert_called_once()
        espera.assert_not_called()

    def test_erro_de_operacao_nao_repete_o_codigo_do_usuario(self):
        falha = erro_sqlite(sqlite3.SQLITE_IOERR_TRUNCATE)
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(store.sqlite3, "connect", wraps=self.sqlite_connect) as abrir,
            mock.patch.object(store.time, "sleep") as espera,
            self.assertRaises(sqlite3.OperationalError) as erro,
            store.connect(self.path),
        ):
            raise falha
        self.assertIs(erro.exception, falha)
        abrir.assert_called_once()
        espera.assert_not_called()
