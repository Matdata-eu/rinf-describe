"""The API against ERA's endpoint stood in for by the Luxembourg sample (tests/sample.py),
with RINF Atlas's search and ERA's dataset explorer stood in for too."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
import sample as S  # noqa: E402

ERA, G, SOL = S.ERA, S.G, S.SOL


@pytest.fixture(scope="module")
def client():
    run = S.sparql(S.store())

    def sparql(endpoint, q, timeout=30.0):
        return run(q)

    def search(base, env, q, classes, limit):
        vals = " ".join(f"<{c}>" for c in classes)
        rows = run(f"""SELECT ?s ?l ?c WHERE {{ VALUES ?c {{ {vals} }} ?s a ?c ; <http://www.w3.org/2000/01/rdf-schema#label> ?l
                       FILTER(CONTAINS(LCASE(STR(?l)), LCASE({json.dumps(q)}))) }} LIMIT {limit}""")
        return [{"iri": b["s"]["value"], "label": b["l"]["value"], "class": b["c"]["value"]} for b in rows]

    def published(api, timeout=20.0):
        return {"0082": {"provider": "CFL", "title": "cfl.ttl", "country": "LU", "modified": "2026-10-01T00:00:00+00:00"}}

    from fastapi.testclient import TestClient

    from app import live, main
    saved = live.sparql, live.published, main.atlas
    live.sparql, live.published, main.atlas = sparql, published, SimpleNamespace(search=search)
    main._cache.clear()
    with TestClient(main.app) as c:
        yield c
    live.sparql, live.published, main.atlas = saved


def test_section_of_line_page(client):
    r = client.get("/api/describe", params={"uri": SOL, "env": "prod"}).json()
    assert r["source"] == "live" and r["title"] == "Michelau <-> Goebelsmuhle" and r["graph"] == G
    assert r["dataset"] == {"graph": G, "provider": "CFL", "title": "cfl.ttl", "country": "LU",
                            "modified": "2026-10-01T00:00:00+00:00"}
    (page,) = r["pages"]
    assert page["label"] == "Section of line"
    rows = page["doc"]["rows"]
    assert rows["track-count"]["aggregate"]["count"] == 2
    assert rows["maximum-permitted-speed"]["aggregate"]["min"] == 95
    assert rows["route"]["params"]["start"][0]["iri"].endswith("/operationalPoint/0a98ad94be")
    assert {i["iri"] for i in rows["track-table"]["items"]} <= set(r["labels"])
    assert r["counts"]["out"] == 14


def test_triples_and_graph(client):
    out = client.get("/api/triples", params={"uri": SOL, "env": "prod"}).json()
    assert len(out["triples"]) == 14 and "source" not in out
    track = next(t["o"] for t in out["triples"] if t["p"].endswith("/hasPart"))
    inc = client.get("/api/triples", params={"uri": track, "env": "prod", "dir": "in"}).json()
    assert any(t["s"] == SOL for t in inc["triples"])
    g = client.get("/api/graph", params={"uri": SOL, "env": "prod"}).json()
    assert ERA + "SectionOfLine" in g["types"][SOL]
    assert g["types"][track] == [ERA + "RunningTrack"] or ERA + "RunningTrack" in g["types"][track]


def test_labels_beyond_page_values(client):
    """Operational points, the national line and the tracks get a label wherever they show up."""
    out = client.get("/api/triples", params={"uri": SOL, "env": "prod"}).json()
    linked = {t["p"].rsplit("/", 1)[-1]: t["o"] for t in out["triples"] if t["o_iri"]}
    for p in ("opStart", "opEnd", "nationalLine", "hasPart"):
        assert out["labels"].get(linked[p]), p
    r = client.get("/api/describe", params={"uri": SOL, "env": "prod"}).json()
    for i in r["pages"][0]["doc"]["rows"]["track-table"]["items"]:
        assert r["labels"].get(i["iri"])


def test_exports(client):
    ttl = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "ttl"})
    assert ttl.status_code == 200 and "a era:InfrastructureElement, era:SectionOfLine" in ttl.text
    assert 'filename="14fd15444d.ttl"' in ttl.headers["content-disposition"]
    assert client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "csv"}).text.startswith("subject,")


def test_unknown_resource(client):
    r = client.get("/api/describe", params={"uri": "http://example.org/nothing", "env": "prod"}).json()
    assert r["source"] == "missing" and r["pages"] == [] and r["title"] is None


def test_bad_input(client):
    assert client.get("/api/describe", params={"uri": "not an iri", "env": "prod"}).status_code == 400
    assert client.get("/api/describe", params={"uri": SOL, "env": "nope"}).status_code == 404
    assert client.get("/api/describe", params={"uri": SOL, "env": "prod", "source": "index"}).status_code == 200


def test_config(client):
    assert client.get("/api/config").json() == {"envs": [{"key": "prod", "label": "PROD"}, {"key": "uat", "label": "UAT"}],
                                                "atlasUrl": "https://rinf-atlas.matdata.eu"}


def test_search_and_examples(client):
    hits = client.get("/api/search", params={"q": "Michelau", "env": "prod"}).json()["results"]
    assert hits[0]["iri"] == SOL and hits[0]["class"] == ERA + "SectionOfLine"
    assert client.get("/api/search", params={"q": SOL, "env": "prod"}).json()["results"] == [
        {"iri": SOL, "label": None, "class": None}]
    ex = client.get("/api/examples", params={"env": "prod"}).json()["results"]
    assert [e["classLabel"] for e in ex] == ["Running track", "Section of line"]
    assert all(e["label"] for e in ex)


def test_search_without_atlas(client, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "ATLAS_URL", "")
    assert client.get("/api/search", params={"q": "Michelau", "env": "prod"}).json()["results"] == []


def test_atlas_search_maps_classes(monkeypatch):
    from app import atlas
    seen = {}

    def handle(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/meta":
            return httpx.Response(200, json={"classes": [{"class": "sol", "class_iri": ERA + "SectionOfLine"},
                                                         {"class": "op", "class_iri": ERA + "OperationalPoint"}]})
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"total": 1, "items": [{"iri": SOL, "class": "sol", "label": "Michelau"}]})
    monkeypatch.setattr(atlas, "_client", httpx.Client(transport=httpx.MockTransport(handle)))
    atlas._meta.clear()
    got = atlas.search("https://atlas.test", "prod", "Mich", [ERA + "SectionOfLine", ERA + "RunningTrack"], 5)
    assert got == [{"iri": SOL, "label": "Michelau", "class": ERA + "SectionOfLine"}]
    assert seen == {"env": "prod", "q": "Mich", "classes": ["sol"], "limit": 5}


def test_sitemaps(client, monkeypatch):
    from app import main
    assert client.get("/api/sitemap.xml").status_code == 404  # no public address, no sitemap
    monkeypatch.setattr(main, "PUBLIC_URL", "https://describe.example.org")
    idx = client.get("/api/sitemap.xml")
    assert idx.status_code == 200 and idx.headers["content-type"].startswith("application/xml")
    assert "<loc>https://describe.example.org/sitemap-site.xml</loc>" in idx.text
    assert "<loc>https://describe.example.org/sitemap-1.xml</loc>" in idx.text
    page = client.get("/api/sitemap-1.xml").text
    loc = "https://describe.example.org/describe?uri=http%3A%2F%2Fdata.europa.eu%2F949%2FsectionOfLine%2F14fd15444d&amp;env=prod"
    assert f"<loc>{loc}</loc><lastmod>2026-10-01</lastmod>" in page
    assert page.count("<url>") == 92  # 10 sections of line and 82 running tracks in the sample
    assert client.get("/api/sitemap-2.xml").status_code == 404
