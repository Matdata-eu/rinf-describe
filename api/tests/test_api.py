"""API against a database filled by scripts/dev_seed.py (skipped without DATABASE_URL)."""
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL with a seeded index")

SOL = "http://data.europa.eu/949/sectionOfLine/14fd15444d"


@pytest.fixture(scope="module")
def client():
    os.environ["DESCRIBE_LIVE"] = "0"
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c


def test_section_of_line_page(client):
    r = client.get("/api/describe", params={"uri": SOL, "env": "prod"}).json()
    assert r["source"] == "index" and r["title"] == "Michelau <-> Goebelsmuhle"
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
    assert out["source"] == "index" and len(out["triples"]) == 14
    track = next(t["o"] for t in out["triples"] if t["p"].endswith("/hasPart"))
    inc = client.get("/api/triples", params={"uri": track, "env": "prod", "dir": "in"}).json()
    assert any(t["s"] == SOL for t in inc["triples"])
    g = client.get("/api/graph", params={"uri": SOL, "env": "prod"}).json()
    assert g["types"][SOL]


def test_exports(client):
    ttl = client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "ttl"})
    assert ttl.status_code == 200 and "a era:InfrastructureElement, era:SectionOfLine" in ttl.text
    assert 'filename="14fd15444d.ttl"' in ttl.headers["content-disposition"]
    assert client.get("/api/export", params={"uri": SOL, "env": "prod", "format": "csv"}).text.startswith("subject,")


def test_unknown_resource_without_live(client):
    r = client.get("/api/describe", params={"uri": "http://example.org/nothing", "env": "prod"}).json()
    assert r["source"] == "missing" and r["pages"] == []


def test_bad_input(client):
    assert client.get("/api/describe", params={"uri": "not an iri", "env": "prod"}).status_code == 400
    assert client.get("/api/describe", params={"uri": SOL, "env": "nope"}).status_code == 404


def test_search_and_examples(client):
    hits = client.get("/api/search", params={"q": "Michelau", "env": "prod"}).json()["results"]
    assert hits[0]["iri"] == SOL
    ex = client.get("/api/examples", params={"env": "prod"}).json()["results"]
    assert {e["classLabel"] for e in ex} == {"Section of line", "Running track"}
