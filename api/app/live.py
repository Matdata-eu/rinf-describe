"""Fallback for resources the describe index does not hold: ask ERA's SPARQL endpoint.

Only the plain triples (outgoing and incoming) and their labels come back this way;
class pages built from shapes exist for indexed resources only.
"""
from __future__ import annotations

import time

import httpx

from .rdf import RDFS_LABEL, SKOS_PREF, XSD

_cache: dict[tuple, tuple[float, list[dict], dict[str, str]]] = {}
CACHE_SECONDS = 600


def _sparql(endpoint: str, query: str, timeout: float) -> list[dict]:
    r = httpx.post(endpoint, data={"query": query}, timeout=timeout,
                   headers={"Accept": "application/sparql-results+json",
                            "User-Agent": "rinf-describe (+https://github.com/Matdata-eu/rinf-describe)"})
    r.raise_for_status()
    return r.json()["results"]["bindings"]


def _row(s: str, p: str, o: dict) -> dict:
    if o["type"] == "uri":
        return {"s": s, "p": p, "o": o["value"], "o_iri": True, "datatype": None, "lang": None}
    dt = o.get("datatype")
    return {"s": s, "p": p, "o": o["value"], "o_iri": False, "lang": o.get("xml:lang"),
            "datatype": None if o.get("xml:lang") or dt == XSD + "string" else dt}


def triples(endpoint: str, iri: str, direction: str, limit: int, timeout: float = 20.0) -> tuple[list[dict], dict[str, str]]:
    """(triples, labels) of one resource, cached for a few minutes."""
    key = (endpoint, iri, direction, limit)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1], hit[2]
    if direction == "out":
        rows = [_row(iri, b["p"]["value"], b["o"])
                for b in _sparql(endpoint, f"SELECT ?p ?o WHERE {{ <{iri}> ?p ?o }} LIMIT {limit}", timeout)
                if b["o"]["type"] in ("uri", "literal", "typed-literal")]
    else:
        rows = [_row(b["s"]["value"], b["p"]["value"], {"type": "uri", "value": iri})
                for b in _sparql(endpoint, f"SELECT ?s ?p WHERE {{ ?s ?p <{iri}> }} LIMIT {limit}", timeout)
                if b["s"]["type"] == "uri"]
    iris = {iri} | {t["p"] for t in rows} | {t["s"] for t in rows} | {t["o"] for t in rows if t["o_iri"]}
    labels: dict[str, str] = {}
    todo = [i for i in iris if i.startswith("http") and ">" not in i][:300]
    if todo:
        vals = " ".join(f"<{i}>" for i in todo)
        q = f"""SELECT ?x ?l WHERE {{ VALUES ?x {{ {vals} }} ?x <{RDFS_LABEL}>|<{SKOS_PREF}> ?l
                FILTER(lang(?l) = 'en' || lang(?l) = '') }}"""
        try:
            for b in _sparql(endpoint, q, timeout):
                labels.setdefault(b["x"]["value"], b["l"]["value"])
        except httpx.HTTPError:
            pass  # labels are a nicety; the triples are what was asked for
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.time(), rows, labels)
    return rows, labels
