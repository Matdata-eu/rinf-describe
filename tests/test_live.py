"""Pages built live from a SPARQL endpoint equal the indexed ones: the API's shape compiler
and live evaluator (api/app/shapes.py, livepage.py) against RINF Atlas's describe indexer,
on Atlas's Luxembourg sample served as a SPARQL endpoint by pyoxigraph."""
import gzip
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

import pytest

D = pytest.importorskip("atlas.describe")
ox = pytest.importorskip("pyoxigraph")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
from app import livepage, shapes  # noqa: E402

ATLAS = Path(os.environ.get("ATLAS_DIR", ROOT.parent / "rinf-atlas"))
G = "http://data.europa.eu/949/graph/0082"
SOL = "http://data.europa.eu/949/sectionOfLine/14fd15444d"


def _binding(t) -> dict:
    if isinstance(t, ox.NamedNode):
        return {"type": "uri", "value": t.value}
    if isinstance(t, ox.Literal):
        b = {"type": "literal", "value": t.value}
        if t.language:
            b["xml:lang"] = t.language
        else:
            b["datatype"] = t.datatype.value
        return b
    return {"type": "bnode", "value": str(t)}


@pytest.fixture(scope="module")
def store():
    sample = ATLAS / "tests" / "fixtures" / "lu-sample.nt.gz"
    if not sample.exists():
        pytest.skip(f"no Atlas sample at {sample}")
    st = ox.Store()
    st.load(gzip.decompress(sample.read_bytes()), format=ox.RdfFormat.N_TRIPLES, to_graph=ox.NamedNode(G))
    return st


@pytest.fixture(scope="module")
def sparql(store):
    def run(q: str) -> list[dict]:
        res = store.query(q, use_default_graph_as_union=True)
        names = [v.value for v in res.variables]
        return [{n: _binding(sol[n]) for n in names if sol[n] is not None} for sol in res]
    return run


def _norm(doc: dict) -> dict:
    """Value lists are sets: the order of a SPARQL result is not defined."""
    if isinstance(doc, dict):
        return {k: _norm(v) for k, v in doc.items()}
    if isinstance(doc, list):
        return sorted((_norm(x) for x in doc), key=repr)
    return doc


def test_layout_equals_the_indexer():
    mine, theirs = shapes.load(ROOT / "shapes"), D.load_describe_shapes(ROOT / "shapes")
    assert [asdict(s) for s in mine.shapes] == [asdict(s) for s in theirs.shapes]
    assert {k: asdict(g) for k, g in mine.groups.items()} == {k: asdict(g) for k, g in theirs.groups.items()}


def test_every_document_equals_the_indexed_one(store, sparql):
    dset = shapes.load(ROOT / "shapes")
    indexed, _ = D.build_docs(store, G, D.load_describe_shapes(ROOT / "shapes"))
    assert len(indexed) == 92
    by_shape = {s.iri: s for s in dset.shapes}
    with ThreadPoolExecutor(4) as pool:
        def live(item):
            iri, shape, _ = item
            parts = livepage.branches(iri, by_shape[shape])
            rows = [b for n in range(0, len(parts), 7)
                    for b in sparql(livepage.query(G, parts[n:n + 7]))]
            return livepage.assemble(by_shape[shape], rows)
        for (iri, shape, doc), got in zip(indexed, pool.map(live, indexed)):
            assert _norm(got) == _norm(doc), iri


def test_page(sparql):
    p = livepage.page(sparql, SOL, shapes.load(ROOT / "shapes"))
    assert p["graph"] == G and "http://data.europa.eu/949/SectionOfLine" in p["classes"]
    ((ds, doc),) = p["pages"]
    assert doc["rows"]["track-count"]["aggregate"] == {"count": 2}
    assert p["labels"][SOL] == "Michelau <-> Goebelsmuhle"
    assert all(p["labels"].get(i["iri"]) for i in doc["rows"]["track-table"]["items"])
    assert p["counts"]["out"] == 14


def test_unknown_resource(sparql):
    p = livepage.page(sparql, "http://example.org/nothing", shapes.load(ROOT / "shapes"))
    assert p["graph"] is None and p["pages"] == [] and p["counts"] == {"out": 0, "in": 0}
