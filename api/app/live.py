"""Talking to ERA: its SPARQL endpoint and its dataset explorer.

The plain triples of a resource (outgoing and incoming) and their labels; the class
pages are built in livepage.py, through sparql() below.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx

from .rdf import RDFS_LABEL, SKOS_PREF, XSD

_cache: dict[tuple, tuple[float, list[dict], dict[str, str]]] = {}
CACHE_SECONDS = 600


# One client for every query: keeps the connections to the endpoint open between them.
_client = httpx.Client(headers={"Accept": "application/sparql-results+json",
                                "User-Agent": "rinf-describe (+https://github.com/Matdata-eu/rinf-describe)"},
                       limits=httpx.Limits(max_connections=32, max_keepalive_connections=16))


def sparql(endpoint: str, query: str, timeout: float = 30.0) -> list[dict]:
    r = _client.post(endpoint, data={"query": query}, timeout=timeout)
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
                for b in sparql(endpoint, f"SELECT ?p ?o WHERE {{ <{iri}> ?p ?o }} LIMIT {limit}", timeout)
                if b["o"]["type"] in ("uri", "literal", "typed-literal")]
    else:
        rows = [_row(b["s"]["value"], b["p"]["value"], {"type": "uri", "value": iri})
                for b in sparql(endpoint, f"SELECT ?s ?p WHERE {{ ?s ?p <{iri}> }} LIMIT {limit}", timeout)
                if b["s"]["type"] == "uri"]
    rows.sort(key=lambda t: (t["p"], t["o"] if direction == "out" else t["s"]))
    iris = {iri} | {t["p"] for t in rows} | {t["s"] for t in rows} | {t["o"] for t in rows if t["o_iri"]}
    labels: dict[str, str] = {}
    todo = [i for i in iris if i.startswith("http") and ">" not in i][:300]
    if todo:
        vals = " ".join(f"<{i}>" for i in todo)
        q = f"""SELECT ?x ?l WHERE {{ VALUES ?x {{ {vals} }} ?x <{RDFS_LABEL}>|<{SKOS_PREF}> ?l
                FILTER(lang(?l) = 'en' || lang(?l) = '') }}"""
        try:
            for b in sparql(endpoint, q, timeout):
                labels.setdefault(b["x"]["value"], b["l"]["value"])
        except httpx.HTTPError:
            pass  # labels are a nicety; the triples are what was asked for
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.time(), rows, labels)
    return rows, labels


def published(api: str | None, timeout: float = 20.0) -> dict[str, dict]:
    """The latest dataset of each infrastructure manager in ERA's dataset explorer, by the
    organisation code that ends the IRI of its graph. {} when there is no explorer or it fails."""
    if not api:
        return {}
    try:
        r = _client.get(f"{api}/dataset/published", params={"latest": "true", "groupBy": "im"},
                        headers={"Accept": "application/json"}, timeout=timeout)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return {}
    out: dict[str, dict] = {}
    for d in data:
        acc = d.get("account") or {}
        if not acc.get("code"):
            continue
        ts = d.get("datePublished") or d.get("dateCreated")
        out[acc["code"]] = {
            "provider": (acc.get("name") or "").strip() or None,
            "title": d.get("fileName") or acc["code"],
            "country": (acc.get("country") or {}).get("code"),
            "modified": datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat() if ts else None,
        }
    return out
