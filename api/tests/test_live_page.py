"""Class pages built live, against a SPARQL endpoint stood in for by pyoxigraph on Atlas's
Luxembourg sample, and the seeded index (skipped without DATABASE_URL or the sample)."""
import gzip
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL with a seeded index")
ox = pytest.importorskip("pyoxigraph")
km_posts = pytest.importorskip("dev_seed").km_posts

ROOT = Path(__file__).resolve().parents[2]
ATLAS = Path(os.environ.get("ATLAS_DIR", ROOT.parent / "rinf-atlas"))
ERA = "http://data.europa.eu/949/"
G = ERA + "graph/0082"
SOL = ERA + "sectionOfLine/14fd15444d"
NEW = ERA + "sectionOfLine/not-indexed-yet"


def _binding(t) -> dict:
    if isinstance(t, ox.NamedNode):
        return {"type": "uri", "value": t.value}
    if isinstance(t, ox.Literal):
        return {"type": "literal", "value": t.value,
                **({"xml:lang": t.language} if t.language else {"datatype": t.datatype.value})}
    return {"type": "bnode", "value": str(t)}


@pytest.fixture(scope="module")
def client():
    sample = ATLAS / "tests" / "fixtures" / "lu-sample.nt.gz"
    if not sample.exists():
        pytest.skip(f"no Atlas sample at {sample}")
    st = ox.Store()
    st.load(gzip.decompress(sample.read_bytes()), format=ox.RdfFormat.N_TRIPLES, to_graph=ox.NamedNode(G))
    km_posts(st, G)  # as scripts/dev_seed.py does for the index
    # A section of line published after the index was built: a copy of SOL in a new graph.
    new_g = ox.NamedNode(ERA + "graph/new")
    for q in list(st.quads_for_pattern(ox.NamedNode(SOL), None, None)):
        st.add(ox.Quad(ox.NamedNode(NEW), q.predicate, q.object, new_g))
    for q in list(st.quads_for_pattern(None, ox.NamedNode(ERA + "isPartOf"), ox.NamedNode(SOL))):
        st.add(ox.Quad(q.subject, q.predicate, ox.NamedNode(NEW), new_g))

    def sparql(endpoint, q, timeout=30.0):
        res = st.query(q, use_default_graph_as_union=True)
        names = [v.value for v in res.variables]
        return [{n: _binding(s[n]) for n in names if s[n] is not None} for s in res]

    from fastapi.testclient import TestClient

    from app import live, main
    main.LIVE = True
    live_sparql, live.sparql = live.sparql, sparql
    with TestClient(main.app) as c:
        yield c
    live.sparql = live_sparql


def _norm(x):
    if isinstance(x, dict):
        return {k: _norm(v) for k, v in x.items()}
    if isinstance(x, list):
        return sorted((_norm(v) for v in x), key=repr)
    return x


def test_live_page_equals_indexed_page(client):
    idx = client.get("/api/describe", params={"uri": SOL, "env": "prod"}).json()
    lv = client.get("/api/describe", params={"uri": SOL, "env": "prod", "source": "live"}).json()
    assert idx["source"] == "index" and lv["source"] == "live"
    assert lv["title"] == idx["title"] and lv["graph"] == idx["graph"] == G
    assert set(lv["classes"]) == set(idx["classes"]) and lv["counts"] == idx["counts"]
    ((pi,), (pl,)) = idx["pages"], lv["pages"]
    assert pl["rows"] == pi["rows"] and pl["groups"] == pi["groups"] and pl["label"] == pi["label"]
    assert _norm(pl["doc"]) == _norm(pi["doc"])
    for i in pl["doc"]["rows"]["track-table"]["items"]:
        assert lv["labels"].get(i["iri"]) == idx["labels"].get(i["iri"])


def test_resource_outside_the_index_gets_its_class_page(client):
    r = client.get("/api/describe", params={"uri": NEW, "env": "prod"}).json()
    assert r["source"] == "live" and r["graph"] == ERA + "graph/new"
    (page,) = r["pages"]
    assert page["label"] == "Section of line"
    assert page["doc"]["rows"]["track-count"]["aggregate"] == {"count": 2}
    assert r["title"] == "Michelau <-> Goebelsmuhle"


def test_source_index_never_reads_live(client):
    r = client.get("/api/describe", params={"uri": NEW, "env": "prod", "source": "index"}).json()
    assert r["source"] == "missing" and r["pages"] == []
