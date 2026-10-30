"""ERA's data for the tests: the Luxembourg sample (fixtures/lu-sample.nt.gz) in a
pyoxigraph store, answering SPARQL the way ERA's endpoint does (JSON result bindings)."""
from __future__ import annotations

import gzip
from collections.abc import Callable
from pathlib import Path

import pyoxigraph as ox

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "tests" / "fixtures" / "lu-sample.nt.gz"
ERA = "http://data.europa.eu/949/"
G = ERA + "graph/0082"
SOL = ERA + "sectionOfLine/14fd15444d"


def store() -> ox.Store:
    st = ox.Store()
    st.load(gzip.decompress(SAMPLE.read_bytes()), format=ox.RdfFormat.N_TRIPLES, to_graph=ox.NamedNode(G))
    return st


def binding(t) -> dict:
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


def sparql(st: ox.Store) -> Callable[[str], list[dict]]:
    """query -> SPARQL JSON result bindings, over the union of the store's graphs."""
    def run(q: str) -> list[dict]:
        res = st.query(q, use_default_graph_as_union=True)
        names = [v.value for v in res.variables]
        return [{n: binding(s[n]) for n in names if s[n] is not None} for s in res]
    return run
