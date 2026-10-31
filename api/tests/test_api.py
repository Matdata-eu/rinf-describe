"""The API against ERA's endpoint stood in for by the Luxembourg sample (tests/sample.py),
with RINF Atlas's search and ERA's dataset explorer stood in for too."""
import json
import sys
import time
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
    main.ontologies.clear()
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
    # The ontology's word on the properties: help, units, the RINF parameters tab.
    assert r["terms"][ERA + "lengthOfSectionOfLine"]["index"] == ["1.1.0.0.0.5"]
    assert r["chapters"]["1.1.0.0.0"] == "Section of line generic information"
    assert any(x["p"] == ERA + "solNature" for x in rows["rinf-parameters"]["parameters"])
    assert "validity" in rows and "parts" not in rows


def test_triples_and_graph(client):
    out = client.get("/api/triples", params={"uri": SOL, "env": "prod"}).json()
    assert len(out["triples"]) == 14 and "source" not in out
    track = next(t["o"] for t in out["triples"] if t["p"].endswith("/hasPart"))
    inc = client.get("/api/triples", params={"uri": track, "env": "prod", "dir": "in"}).json()
    assert any(t["s"] == SOL for t in inc["triples"])
    g = client.get("/api/graph", params={"uri": SOL, "env": "prod"}).json()
    assert ERA + "SectionOfLine" in g["types"][SOL]
    assert g["types"][track] == [ERA + "RunningTrack"] or ERA + "RunningTrack" in g["types"][track]


def test_data_model(client):
    r = client.get("/api/model", params={"uri": SOL, "env": "prod"}).json()
    m = r["model"]
    assert m["focus"] == ERA + "SectionOfLine"
    assert [b["iri"] for b in m["boxes"]][:2] == [ERA + "SectionOfLine", ERA + "InfrastructureElement"]
    sol = m["boxes"][0]
    assert any(a["p"] == ERA + "solNature" for a in sol["attributes"])
    assert {a["class"] for a in sol["associations"]} >= {ERA + "OperationalPoint"}
    assert r["used"]["out"][ERA + "solNature"] == 1 and set(r["used"]) == {"out", "in", "via"}
    page = {n["iri"]: n for n in m["page"]["nodes"]}
    assert page[ERA + "SectionOfLine"]["hop"] == 0 and page[ERA + "OperationalPoint"]["hop"] == 1
    none = client.get("/api/model", params={"uri": ERA + "nothing/here", "env": "prod"}).json()
    assert none["model"] is None


def test_labels_beyond_page_values(client):
    """Operational points, the national line and the tracks get a label wherever they show up."""
    out = client.get("/api/triples", params={"uri": SOL, "env": "prod"}).json()
    linked = {t["p"].rsplit("/", 1)[-1]: t["o"] for t in out["triples"] if t["o_iri"]}
    for p in ("opStart", "opEnd", "nationalLine", "hasPart"):
        assert out["labels"].get(linked[p]), p
    r = client.get("/api/describe", params={"uri": SOL, "env": "prod"}).json()
    for i in r["pages"][0]["doc"]["rows"]["track-table"]["items"]:
        assert r["labels"].get(i["iri"])


def test_class_model(client):
    r = client.get("/api/model/class", params={"class": ERA + "SectionOfLine", "env": "prod"}).json()
    assert r["focus"] == ERA + "SectionOfLine"
    assert any(a["p"] == ERA + "opStart" for b in r["boxes"] for a in b["associations"])
    assert client.get("/api/model/class", params={"class": ERA + "Nothing", "env": "prod"}).status_code == 404


def test_exports(client):
    ttl = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "ttl"})
    assert ttl.status_code == 200 and "a era:InfrastructureElement, era:SectionOfLine" in ttl.text
    assert 'filename="14fd15444d.ttl"' in ttl.headers["content-disposition"]
    assert client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "csv"}).text.startswith("subject,")
    xml = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "rdf"})
    assert xml.headers["content-type"].startswith("application/rdf+xml") and "Michelau &lt;-&gt; Goebelsmuhle" in xml.text
    js = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "jsonld"})
    assert js.headers["content-type"].startswith("application/ld+json") and "era:SectionOfLine" in js.json()["@type"]


def test_unknown_resource(client):
    r = client.get("/api/describe", params={"uri": "http://example.org/nothing", "env": "prod"}).json()
    assert r["source"] == "missing" and r["pages"] == [] and r["title"] is None


def test_bad_input(client):
    assert client.get("/api/describe", params={"uri": "not an iri", "env": "prod"}).status_code == 400
    for uri in ("javascript:alert(1)", "data:text/html,hi", "urn:x:y", "JAVASCRIPT:alert(1)"):
        assert client.get("/api/describe", params={"uri": uri, "env": "prod"}).status_code == 400, uri
    assert client.get("/api/describe", params={"uri": "HTTP://data.europa.eu/949/x", "env": "prod"}).status_code == 200
    assert client.get("/api/describe", params={"uri": SOL, "env": "nope"}).status_code == 404
    assert client.get("/api/describe", params={"uri": SOL, "env": "prod", "source": "index"}).status_code == 200


def test_config(client):
    assert client.get("/api/config").json() == {"envs": [{"key": "prod", "label": "PROD"}, {"key": "uat", "label": "UAT"}],
                                                "atlasUrl": "https://rinf-atlas.matdata.eu"}


def test_search_and_examples(client):
    hits = client.get("/api/search", params={"q": "Michelau", "env": "prod"}).json()["results"]
    assert any(h["iri"] == SOL and h["class"] == ERA + "SectionOfLine" for h in hits)
    assert client.get("/api/search", params={"q": SOL, "env": "prod"}).json()["results"] == [
        {"iri": SOL, "label": None, "class": None}]
    ex = client.get("/api/examples", params={"env": "prod"}).json()["results"]
    labels = [e["classLabel"] for e in ex]
    assert labels == sorted(labels) and {"Document", "National line", "Operational point", "Running track",
                                         "Section of line", "Tunnel", "Primary location"} <= set(labels)
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


def test_sitemaps(client, monkeypatch, tmp_path):
    from app import main
    assert client.get("/api/sitemap.xml").status_code == 404  # no public address, no sitemap
    monkeypatch.setattr(main, "PUBLIC_URL", "https://describe.example.org")
    monkeypatch.setattr(main, "SITEMAP_DIR", tmp_path)
    monkeypatch.setattr(main, "_sitemaps", {"files": None, "built": None})
    not_yet = client.get("/api/sitemap.xml")  # until the background build has run
    assert not_yet.status_code == 503 and not_yet.headers["retry-after"] == "900"
    assert client.get("/api/sitemap-1.xml").status_code == 503
    (tmp_path / "sitemap-7.xml").write_text("stale")
    assert main.build_sitemaps() == 1
    assert not (tmp_path / "sitemap-7.xml").exists()
    idx = client.get("/api/sitemap.xml")
    assert idx.status_code == 200 and idx.headers["content-type"].startswith("application/xml")
    assert "<loc>https://describe.example.org/sitemap-site.xml</loc>" in idx.text
    assert "<loc>https://describe.example.org/sitemap-1.xml</loc>" in idx.text
    page = client.get("/api/sitemap-1.xml").text
    loc = "https://describe.example.org/describe?uri=http%3A%2F%2Fdata.europa.eu%2F949%2FsectionOfLine%2F14fd15444d&amp;env=prod"
    assert f"<loc>{loc}</loc><lastmod>2026-10-01</lastmod>" in page
    # Every infrastructure element of the sample has a page: 10 sections of line, 82 running
    # tracks and the operational points, platforms, sidings... (the base page).
    assert page.count("<url>") == 237
    assert client.get("/api/sitemap-2.xml").status_code == 404


def test_more_rows(client):
    op = ERA + "operationalPoint/1f2dd3bd6f"
    r = client.get("/api/rows", params={"uri": op, "key": "track-table", "offset": 1}).json()
    assert r["total"] == 3 and len(r["items"]) == 2 and r["offset"] == 1
    assert client.get("/api/rows", params={"uri": op, "key": "nothing"}).status_code == 404
    past = client.get("/api/rows", params={"uri": op, "key": "track-table", "offset": 999}).json()
    assert past["items"] == [] and past["total"] == 3


def test_health_reports_the_shapes(client, monkeypatch):
    from app import main
    ok = client.get("/api/health")
    assert ok.status_code == 200 and ok.json()["ok"] and ok.json()["shapes"] > 10
    monkeypatch.setattr(main, "shape_error", "operational-point.ttl: bad turtle")
    bad = client.get("/api/health")
    assert bad.status_code == 503 and bad.json()["error"] == "operational-point.ttl: bad turtle"


def test_big_exports_say_they_are_cut(client, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "TRIPLES_MAX", 5)
    main.live._cache.clear()
    r = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "ttl"})
    assert r.headers["x-describe-truncated"] == "5" and "the first 5 triples only" in r.text


def test_national_line_pages_are_kept_a_day(client):
    from app import main
    line = ERA + "lrs/3d5c54deb2"
    r = client.get("/api/describe", params={"uri": line}).json()
    assert r["pages"][0]["class"] == ERA + "LinearPositioningSystem"
    expires = main._cache[("page", "prod", line)][0]
    assert expires - time.time() > 3600


def test_cache_headers(client):
    r = client.get("/api/describe", params={"uri": SOL, "env": "prod"})
    assert r.headers["cache-control"] == "public, max-age=300"
    assert client.get("/api/examples").headers["cache-control"] == "public, max-age=3600"
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    assert client.get("/api/describe", params={"uri": "not an iri"}).headers["cache-control"] == "no-store"


def test_busy_endpoint_answers_503(client, monkeypatch):
    from app import live, main

    def busy(*a, **k):
        raise live.Busy("too many")
    monkeypatch.setattr(main.livepage, "page", busy)
    r = client.get("/api/describe", params={"uri": ERA + "nothing/busy", "env": "prod"})
    assert r.status_code == 503 and r.headers["retry-after"] == "10" and r.headers["cache-control"] == "no-store"
