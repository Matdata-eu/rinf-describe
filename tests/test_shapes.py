"""The shapes compile and give the expected pages on the Luxembourg sample, evaluated by
the API's shape compiler and live evaluator (api/app/shapes.py, livepage.py) against
the sample served as a SPARQL endpoint (tests/sample.py)."""
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyoxigraph as ox
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sample as S  # noqa: E402

sys.path.insert(0, str(S.ROOT / "api"))
from app import livepage, shapes  # noqa: E402

ROOT, G, ERA, SOL = S.ROOT, S.G, S.ERA, S.SOL


def build_docs(sparql, dset) -> dict:
    """{(resource, shape name): document} for every resource of a class with a shape."""
    out = {}
    with ThreadPoolExecutor(4) as pool:
        for ds in dset.shapes:
            iris = [b["s"]["value"] for b in sparql(f"SELECT ?s WHERE {{ ?s a <{ds.class_iri}> }}")]

            def one(iri, ds=ds):
                parts = livepage.branches(iri, ds)
                rows = [b for n in range(0, len(parts), 7) for b in sparql(livepage.query(G, parts[n:n + 7]))]
                return livepage.assemble(ds, rows)
            for iri, doc in zip(iris, pool.map(one, iris)):
                out[(iri, ds.iri.rsplit("/", 1)[-1])] = doc
    return out


@pytest.fixture(scope="module")
def sparql():
    return S.sparql(S.store())


@pytest.fixture(scope="module")
def docs(sparql):
    dset = shapes.load(ROOT / "shapes")
    return dset, build_docs(sparql, dset)


def test_one_page_per_class(docs):
    dset, by = docs
    assert {s.class_iri for s in dset.shapes} == {ERA + "SectionOfLine", ERA + "RunningTrack"}
    shapes = [k[1] for k in by]
    assert shapes.count("section-of-line") == 10 and shapes.count("running-track") == 82


def test_section_of_line(docs):
    rows = docs[1][(SOL, "section-of-line")]["rows"]
    assert rows["title"]["values"][0]["value"] == "Michelau <-> Goebelsmuhle"
    assert rows["route"]["params"]["length"][0]["value"] == "4.506"
    assert rows["track-count"]["aggregate"] == {"count": 2}
    assert rows["contact-line-system"]["aggregate"]["children"] == 2
    assert len(rows["track-table"]["items"]) == 2
    assert rows["map"]["values"][0]["value"].startswith("LINESTRING")
    assert len(rows["map"]["params"]["context"]) == 2   # the two operational points
    assert rows["validity"]["params"]["begin"][0]["value"] == "2025-12-31"


def test_running_track(docs):
    by = docs[1]
    track = next(doc for (iri, shape), doc in by.items() if shape == "running-track" and "gradient-profile" in doc["rows"])
    rows = track["rows"]
    assert rows["part-of"]["values"][0]["iri"].startswith(ERA + "sectionOfLine/")
    assert rows["contact-line-system"]["items"][0]["cells"]["type"]
    assert rows["etcs"]["items"][0]["cells"]["level"]
    assert track["dataStatus"]["notApplicable"]


def test_parameters_from_common_characteristics_subsets():
    """ETCS and the legacy train protection stated on a subset a track belongs to, or on a
    subset of that subset, count for the track and its section of line."""
    st = ox.Store()
    g = ox.NamedNode(G)
    n = ox.NamedNode
    sol, track, ccs, parent = n(SOL), n(ERA + "runningTrack/t1"), n(ERA + "ccs/1"), n(ERA + "ccs/2")
    etcs, pls = n(ERA + "etcs/1"), n(ERA + "concepts/train-protection-legacy-systems/rinf/30")
    a = n("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
    for q in [(sol, a, n(ERA + "SectionOfLine")), (sol, n(ERA + "hasPart"), track),
              (track, a, n(ERA + "RunningTrack")), (ccs, n(ERA + "contains"), track),
              (ccs, n(ERA + "subsetOf"), parent), (parent, n(ERA + "protectionLegacySystem"), pls),
              (ccs, n(ERA + "etcs"), etcs), (etcs, n(ERA + "etcsBaseline"), ox.Literal("3"))]:
        st.add(ox.Quad(*q, g))
    by = build_docs(S.sparql(st), shapes.load(ROOT / "shapes"))
    rows = by[(SOL, "section-of-line")]["rows"]
    assert rows["train-protection-legacy-system"]["aggregate"]["values"] == [{"iri": pls.value, "count": 1}]
    assert rows["etcs-baseline"]["aggregate"]["values"] == [{"value": "3", "count": 1}]
    t = by[(track.value, "running-track")]["rows"]
    assert t["train-protection-legacy-system"]["values"][0]["iri"] == pls.value
    assert t["etcs"]["items"][0]["cells"]["baseline"]


def test_page(sparql):
    p = livepage.page(sparql, SOL, shapes.load(ROOT / "shapes"))
    assert p["graph"] == G and ERA + "SectionOfLine" in p["classes"]
    ((ds, doc),) = p["pages"]
    assert doc["rows"]["track-count"]["aggregate"] == {"count": 2}
    assert p["labels"][SOL] == "Michelau <-> Goebelsmuhle"
    assert all(p["labels"].get(i["iri"]) for i in doc["rows"]["track-table"]["items"])
    assert p["counts"]["out"] == 14


def test_unknown_resource(sparql):
    p = livepage.page(sparql, "http://example.org/nothing", shapes.load(ROOT / "shapes"))
    assert p["graph"] is None and p["pages"] == [] and p["counts"] == {"out": 0, "in": 0}
