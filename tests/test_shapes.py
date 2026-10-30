"""The shapes compile with RINF Atlas's describe indexer and give the expected pages on
Atlas's Luxembourg sample. Needs a rinf-atlas checkout (ATLAS_DIR, default ../rinf-atlas)
with its worker installed (pip install -e ../rinf-atlas/worker)."""
import gzip
import os
from pathlib import Path

import pytest

D = pytest.importorskip("atlas.describe")
ox = pytest.importorskip("pyoxigraph")

ROOT = Path(__file__).resolve().parent.parent
ATLAS = Path(os.environ.get("ATLAS_DIR", ROOT.parent / "rinf-atlas"))
G = "http://data.europa.eu/949/graph/0082"
ERA = "http://data.europa.eu/949/"
SOL = ERA + "sectionOfLine/14fd15444d"


@pytest.fixture(scope="module")
def docs():
    sample = ATLAS / "tests" / "fixtures" / "lu-sample.nt.gz"
    if not sample.exists():
        pytest.skip(f"no Atlas sample at {sample}")
    st = ox.Store()
    st.load(gzip.decompress(sample.read_bytes()), format=ox.RdfFormat.N_TRIPLES, to_graph=ox.NamedNode(G))
    dset = D.load_describe_shapes(ROOT / "shapes")
    out, _ = D.build_docs(st, G, dset)
    return dset, {(iri, shape.rsplit("/", 1)[-1]): doc for iri, shape, doc in out}


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
