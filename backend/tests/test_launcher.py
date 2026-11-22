import socket

from app import launcher


def test_porta_ocupada_e_detectada_e_proxima_livre_e_usada():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        port = busy.getsockname()[1]
        assert not launcher.is_port_free(port)
        chosen = launcher.find_free_port(port, attempts=10)
        assert chosen != port
        assert launcher.is_port_free(chosen)


def test_nada_rodando_na_porta():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert launcher.is_app_running(port, timeout=0.3) is False
