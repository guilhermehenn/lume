import pytest

from app.services import news, remote

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Mercados</title>
<item>
  <title><![CDATA[Ibovespa sobe &amp; d\xc3\xb3lar cai com <b>IPCA</b>]]></title>
  <link>https://www.infomoney.com.br/mercados/noticia-1/</link>
  <pubDate>Fri, 20 Nov 2026 13:05:00 -0300</pubDate>
</item>
<item>
  <title>Link perigoso</title>
  <link>javascript:alert(1)</link>
  <pubDate>Fri, 20 Nov 2026 12:00:00 -0300</pubDate>
</item>
<item>
  <title>Sem data</title>
  <link>https://www.infomoney.com.br/mercados/noticia-2/</link>
</item>
</channel></rss>"""

RSS_2 = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Selic: o que esperar do Copom</title>
<link>https://www.moneytimes.com.br/selic/?utm=x</link>
<pubDate>Fri, 20 Nov 2026 15:00:00 -0300</pubDate></item>
<item><title>Ibovespa sobe &amp; d\xc3\xb3lar cai com IPCA</title>
<link>https://www.infomoney.com.br/mercados/noticia-1/</link>
<pubDate>Fri, 20 Nov 2026 13:05:00 -0300</pubDate></item>
</channel></rss>"""


@pytest.fixture(autouse=True)
def _fresh_cache():
    news.reset_cache()
    yield
    news.reset_cache()


def test_parse_rss_limpa_html_e_recusa_links_perigosos():
    items = news.parse_rss(RSS, "InfoMoney")
    assert [i["title"] for i in items] == ["Ibovespa sobe & dólar cai com IPCA", "Sem data"]
    assert items[0]["published_at"] == "2026-11-20T16:05:00+00:00"
    assert items[1]["published_at"] is None
    assert all(i["link"].startswith("https://") for i in items)


def test_recusa_xml_com_entidades():
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel></channel></rss>'
    with pytest.raises(ValueError):
        news.parse_rss(evil, "X")


def test_titulo_longo_e_cortado():
    assert len(news.clean_text("a" * 500)) == news.MAX_TITLE
    assert news.clean_text("<p>Olá&nbsp; mundo</p>") == "Olá mundo"


def test_merge_remove_duplicadas_e_ordena():
    a = news.parse_rss(RSS, "InfoMoney")
    b = news.parse_rss(RSS_2, "Money Times")
    merged = news.merge_items([a, b])
    titles = [i["title"] for i in merged]
    assert titles[0] == "Selic: o que esperar do Copom"
    assert titles.count("Ibovespa sobe & dólar cai com IPCA") == 1


def test_get_news_com_falha_parcial(monkeypatch):
    def fake_fetch(url, **_kwargs):
        if "moneytimes" in url:
            return RSS_2
        if "mercados" in url:
            return RSS
        raise remote.RemoteError("fora do ar")

    monkeypatch.setattr(remote, "fetch_bytes", fake_fetch)
    result = news.get_news()
    assert result["stale"] is False
    assert len(result["items"]) == 3
    assert any("InfoMoney" in e for e in result["errors"])


def test_get_news_sem_internet_devolve_cache(monkeypatch):
    monkeypatch.setattr(remote, "fetch_bytes", lambda url, **_: RSS)
    first = news.get_news()
    assert first["items"]

    def offline(url, **_kwargs):
        raise remote.RemoteError("offline")

    monkeypatch.setattr(remote, "fetch_bytes", offline)
    news._cache._stored_at -= 3600
    news._cache.last_attempt -= 3600
    result = news.get_news()
    assert result["stale"] is True
    assert result["items"] == first["items"]
