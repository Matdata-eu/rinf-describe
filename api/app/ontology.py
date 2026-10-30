"""The ERA ontology, read once from the endpoint's ontology graph and kept for a day.

It gives the pages what the shapes should not repeat: the label, definition, unit and
RINF index of every property (row help and the RINF parameters tab), the names of the
RINF index chapters (the labels of the grouping super-properties, such as
era:energySubsystemDataParameter at 1.1.1.2), and the class hierarchy, so a shape on
era:InfrastructureElement applies to every infrastructure class.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field

log = logging.getLogger("describe")

GRAPH = "http://data.europa.eu/949/graph/rinf/ontology"
ERA = "http://data.europa.eu/949/"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
SKOS = "http://www.w3.org/2004/02/skos/core#"
QUDT_UNIT = "http://qudt.org/vocab/unit/"
DAY = 86400

# QUDT unit -> the symbol written after a value.
UNIT_SYMBOLS = {
    "M": "m", "KiloM": "km", "MilliM": "mm", "M2": "m²", "KiloM-PER-HR": "km/h", "MilliM-PER-M": "‰",
    "M-PER-SEC2": "m/s²", "V": "V", "A": "A", "A-PER-M": "A/m", "N": "N", "KiloN": "kN", "OHM": "Ω",
    "KiloGM": "kg", "TONNE": "t", "KiloJ": "kJ", "KiloW": "kW", "SEC": "s", "MIN": "min", "HZ": "Hz",
    "NanoFARAD": "nF", "MilliH": "mH", "DeciB": "dB", "DeciB_A": "dB(A)", "GM-PER-SEC": "g/s",
}

Sparql = Callable[[str], list[dict]]


@dataclass
class Ontology:
    terms: dict[str, dict] = field(default_factory=dict)          # property -> {label, comment, index, unit}
    chapters: dict[str, str] = field(default_factory=dict)        # RINF index -> chapter name
    parents: dict[str, set[str]] = field(default_factory=dict)    # class -> direct superclasses

    def ancestors(self, cls: str) -> list[str]:
        """Superclasses of a class, nearest first."""
        out: list[str] = []
        todo = [cls]
        while todo:
            nxt = []
            for c in todo:
                for p in sorted(self.parents.get(c, ())):
                    if p not in out and p != cls:
                        out.append(p)
                        nxt.append(p)
            todo = nxt
        return out

    def descendants(self, cls: str) -> set[str]:
        """Subclasses of a class, at any depth."""
        return {c for c in self.parents if cls in self.ancestors(c)}

    def depth(self, cls: str) -> int:
        return len(self.ancestors(cls))

    def subset(self, iris) -> dict[str, dict]:
        return {i: self.terms[i] for i in iris if i in self.terms}


def _index_key(ix: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in ix.split("."))


def read(sparql: Sparql) -> Ontology:
    o = Ontology()
    rows = sparql(f"""SELECT ?p ?k ?v WHERE {{ GRAPH <{GRAPH}> {{
        VALUES ?k {{ <{RDFS}label> <{RDFS}comment> <{ERA}rinfIndex> <{ERA}unitOfMeasure> }}
        ?p ?k ?v FILTER(isIRI(?p)) FILTER(!isLiteral(?v) || lang(?v) = '' || langMatches(lang(?v), 'en')) }} }}""")
    acc: dict[str, dict] = defaultdict(lambda: {"index": []})
    for b in rows:
        p, k, v = b["p"]["value"], b["k"]["value"].rsplit("#", 1)[-1].rsplit("/", 1)[-1], b["v"]["value"]
        t = acc[p]
        if k == "rinfIndex":
            if v not in t["index"]:
                t["index"].append(v.strip())
        elif k == "unitOfMeasure":
            t["unit"] = UNIT_SYMBOLS.get(v[len(QUDT_UNIT):], v.rsplit("/", 1)[-1]) if v.startswith(QUDT_UNIT) else None
        elif k not in t:
            t[k] = v.strip()
    for p, t in acc.items():
        if t["index"]:
            t["index"].sort(key=_index_key)
        else:
            del t["index"]
        if not any(k in t for k in ("label", "comment", "index", "unit")):
            continue
        o.terms[p] = t
    # A chapter is the index of a grouping super-property: one shorter than its parameters'.
    for t in o.terms.values():
        for ix in t.get("index", []):
            ix = ix.rstrip(".")
            if t.get("label") and (ix.count(".") <= 4 or ix.endswith(".0")) and ix not in o.chapters:
                o.chapters[ix] = t["label"]
    for b in sparql(f"""SELECT ?c ?s WHERE {{ GRAPH <{GRAPH}> {{ ?c <{RDFS}subClassOf> ?s
                        FILTER(isIRI(?c) && isIRI(?s)) }} }}"""):
        o.parents.setdefault(b["c"]["value"], set()).add(b["s"]["value"])
    return o


class Cache:
    """One ontology per environment, read on first use and again after a day. A failed read
    leaves an empty ontology (pages then lack help and the parameters tab) and is retried
    after a minute."""

    def __init__(self):
        self._by: dict[str, tuple[float, Ontology]] = {}
        self._lock = threading.Lock()

    def get(self, env: str, sparql: Sparql) -> Ontology:
        hit = self._by.get(env)
        if hit and time.time() < hit[0]:
            return hit[1]
        with self._lock:
            hit = self._by.get(env)
            if hit and time.time() < hit[0]:
                return hit[1]
            try:
                o, ttl = read(sparql), DAY
                log.info("%s: ontology with %d terms, %d chapters", env, len(o.terms), len(o.chapters))
            except Exception as e:  # noqa: BLE001 - help is a nicety; the page must still render
                log.warning("%s: no ontology: %s", env, e)
                o, ttl = (hit[1] if hit else Ontology()), 60
            self._by[env] = (time.time() + ttl, o)
            return o

    def clear(self):
        self._by.clear()
