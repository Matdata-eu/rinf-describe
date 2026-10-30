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
    """{(resource, shape name): document} for every resource of a class with a shape, its
    shapes merged as on its page (the base page under its class page)."""
    from app import ontology
    onto = ontology.read(sparql)
    types: dict[str, list[str]] = {}
    for ds in dset.shapes:
        for b in sparql(f"SELECT ?s ?t WHERE {{ ?s a <{ds.class_iri}> ; a ?t }}"):
            types.setdefault(b["s"]["value"], []).append(b["t"]["value"])
    out = {}

    def one(iri):
        (ds,) = dset.for_resource(types[iri], onto.ancestors, onto.depth)
        parts = livepage.branches(iri, ds)
        rows = [b for n in range(0, len(parts), 7) for b in sparql(livepage.query(G, parts[n:n + 7]))]
        return ds, livepage.assemble(ds, rows)
    with ThreadPoolExecutor(4) as pool:
        for iri, (ds, doc) in zip(types, pool.map(one, types)):
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
    assert {ERA + "SectionOfLine", ERA + "RunningTrack", ERA + "InfrastructureElement"} <= {s.class_iri for s in dset.shapes}
    shapes = [k[1] for k in by]
    assert shapes.count("section-of-line") == 10 and shapes.count("running-track") == 82


def test_shapes_merge_over_the_base_page(sparql):
    """A section of line gets its own rows and those of the infrastructure element page, its
    own winning on the same key; the deactivated parts row is gone."""
    from app import ontology
    onto = ontology.read(sparql)
    dset = shapes.load(ROOT / "shapes")
    assert ERA + "InfrastructureElement" in onto.ancestors(ERA + "RunningTrack")
    (ds,) = dset.for_resource([ERA + "SectionOfLine"], onto.ancestors, onto.depth)
    keys = {r.key for r in ds.rows}
    assert ds.class_iri == ERA + "SectionOfLine" and ds.label == "Section of line"
    assert {"route", "track-table", "validity", "country", "rinf-parameters"} <= keys and "parts" not in keys
    assert next(r for r in ds.rows if r.key == "map").params  # the section's map (with context), not the base one
    # A class without a shape of its own gets the base page through the ontology.
    (base,) = dset.for_resource([ERA + "Switch"], onto.ancestors, onto.depth)
    assert base.class_iri == ERA + "InfrastructureElement"
    assert dset.for_resource([ERA + "NetRelation"], onto.ancestors, onto.depth) == []


def test_rinf_parameters(sparql):
    from app import ontology
    onto = ontology.read(sparql)
    p = livepage.page(sparql, SOL, shapes.load(ROOT / "shapes"), onto=onto)
    ((ds, doc),) = p["pages"]
    params = {x["p"].rsplit("/", 1)[-1] for x in doc["rows"]["rinf-parameters"]["parameters"]}
    assert {"lengthOfSectionOfLine", "opStart", "opEnd", "solNature"} <= params
    assert "canonicalURI" not in params  # no RINF index
    assert onto.chapters["1.1.0.0.0"] == "Section of line generic information"
    assert onto.terms[ERA + "maximumPermittedSpeed"]["unit"] == "km/h"


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
    assert "parts" not in rows


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


OP = ERA.replace("949/", "949/operationalPoint/1f2dd3bd6f")


def test_operational_point(docs):
    _, by = docs
    rows = by[(OP, "operational-point")]["rows"]
    # Its section of line is in another graph's reach only through ^opStart|^opEnd: rd:scope "all".
    assert len(rows["connections"]["items"]) == 1
    assert rows["track-count"]["aggregate"] == {"count": 3}
    assert rows["track-table"]["total"] == 3 and len(rows["track-table"]["items"]) == 3
    # rd:class: the tracks among the parts, not the platforms or sidings.
    assert all(it["cells"]["track"] for it in rows["track-table"]["items"])
    assert "parts" not in rows


def test_limit_pages_a_table(sparql):
    dset = shapes.load(ROOT / "shapes")
    (ds,) = [d for d in dset.shapes if d.class_iri == ERA + "OperationalPoint"]
    row = next(r for r in ds.rows if r.key == "track-table")
    row.settings["limit"] = "2"
    seen = []
    for offset in (0, 2):
        doc = livepage.assemble(ds, sparql(livepage.query(G, livepage.branches(OP, ds, [row], status=False, offset=offset))))
        e = doc["rows"]["track-table"]
        assert e["total"] == 3
        seen += [it["iri"] for it in e["items"]]
    assert len(seen) == 3 == len(set(seen))


def test_national_line(docs):
    """A line sums up its sections, and each section its tracks (a column with rd:over)."""
    dset, by = docs
    (nl,) = [d for d in dset.shapes if d.class_iri == ERA + "LinearPositioningSystem"]
    assert nl.cache_seconds == 86400
    rows = by[(ERA + "lrs/3d5c54deb2", "national-line")]["rows"]
    assert rows["section-count"]["aggregate"] == {"count": 3}
    assert rows["length"]["aggregate"]["sum"] == 11.292
    items = rows["section-table"]["items"]
    assert len(items) == 3
    assert all(it["aggregates"]["tracks"]["count"] >= 1 for it in items)
    assert any(it["aggregates"]["speed"].get("max") for it in items)


def test_shared_systems_and_primary_location(docs):
    """Contact line systems, ETCS and train detection systems list the tracks that use them;
    a primary location the operational points that carry it."""
    _, by = docs
    cls = by[(ERA + "contactLineSystem/2626f3a315", "contact-line-system")]["rows"]
    assert cls["use-count"]["aggregate"]["count"] >= 1 and cls["use-table"]["items"]
    assert by[(ERA + "etcs/40cdd32526", "etcs")]["rows"]["use-count"]["aggregate"]["count"] >= 1
    assert by[(ERA + "trainDetectionSystem/ec667c8d88", "train-detection-system")]["rows"]["use-table"]["items"]
    pl = [d for (i, s), d in by.items() if s == "primary-location" and d["rows"].get("linked")]
    assert pl and all(d["rows"]["code"]["values"] for d in pl)


def test_weighted_shares():
    """rd:weight: a distinct count also sums each value's weight (track-km), one weight per
    child however many ways the path reaches it."""
    per_child = {"t1": [{"iri": "e:DC"}], "t2": [{"iri": "e:DC"}], "t3": [{"iri": "e:AC"}], "t4": []}
    a = livepage.aggregate("distinct-count", per_child, {"t1": 1.0, "t2": 2.0, "t3": 10.0, "t4": 0.5})
    assert [(v["iri"], v["count"], v["weight"]) for v in a["values"]] == [("e:AC", 1, 10.0), ("e:DC", 2, 3.0)]
    assert a["weight"] == 13.5 and a["withoutValueWeight"] == 0.5 and a["withoutValue"] == 1
    # Without weights, as before: by count.
    assert [v["iri"] for v in livepage.aggregate("distinct-count", per_child)["values"]] == ["e:DC", "e:AC"]
