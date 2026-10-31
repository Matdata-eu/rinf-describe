"""Talking to ERA: its SPARQL endpoint and its dataset explorer.

The plain triples of a resource (outgoing and incoming) and their labels; the class
pages are built in livepage.py, through sparql() below.

ERA's endpoint is a shared public service, so every query goes through two guards: at most
MAX_QUERIES of them in flight from this process, and a circuit breaker that stops asking an
endpoint for a while after it failed several times in a row (instead of every request
holding threads for the full timeout while it is down).
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

import httpx

from .cache import TTLCache
from .rdf import RDFS_LABEL, SKOS_PREF, XSD

_cache = TTLCache(2000)
CACHE_SECONDS = 600

MAX_QUERIES = int(os.environ.get("DESCRIBE_MAX_QUERIES", "16"))
QUEUE_SECONDS = float(os.environ.get("DESCRIBE_QUEUE_SECONDS", "20"))
BREAKER_FAILURES = 5    # failures in a row that open the breaker
BREAKER_SECONDS = 30.0  # how long it then stays open


class Overloaded(Exception):
    """The query was not sent: too many in flight, or the endpoint is failing. The API answers
    503 with Retry-After."""
    retry_after = 10


class Busy(Overloaded):
    pass


class Unavailable(Overloaded):
    retry_after = int(BREAKER_SECONDS)


_slots = threading.BoundedSemaphore(MAX_QUERIES)
_breaker_lock = threading.Lock()
_failures: dict[str, int] = {}
_open_until: dict[str, float] = {}


def _check_breaker(endpoint: str) -> None:
    with _breaker_lock:
        if time.monotonic() < _open_until.get(endpoint, 0.0):
            raise Unavailable(f"{endpoint} failed {BREAKER_FAILURES} times in a row; not asking it for a while")


def _record(endpoint: str, ok: bool) -> None:
    with _breaker_lock:
        if ok:
            _failures.pop(endpoint, None)
            return
        n = _failures[endpoint] = _failures.get(endpoint, 0) + 1
        if n >= BREAKER_FAILURES:
            _open_until[endpoint] = time.monotonic() + BREAKER_SECONDS
            _failures[endpoint] = 0


def reset_guards() -> None:
    """Forget the breaker state (tests)."""
    with _breaker_lock:
        _failures.clear()
        _open_until.clear()


# One client for every query: keeps the connections to the endpoint open between them.
_client = httpx.Client(headers={"Accept": "application/sparql-results+json",
                                "User-Agent": "rinf-describe (+https://github.com/Matdata-eu/rinf-describe)"},
                       limits=httpx.Limits(max_connections=32, max_keepalive_connections=16))


def sparql(endpoint: str, query: str, timeout: float = 30.0) -> list[dict]:
    _check_breaker(endpoint)
    if not _slots.acquire(timeout=QUEUE_SECONDS):
        raise Busy(f"more than {MAX_QUERIES} queries to ERA in flight for {QUEUE_SECONDS:.0f} s")
    try:
        r = _client.post(endpoint, data={"query": query}, timeout=timeout)
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        # A bad query (4xx) says nothing about the endpoint's health; 5xx does.
        _record(endpoint, e.response.status_code < 500)
        raise
    except httpx.HTTPError:
        _record(endpoint, False)
        raise
    finally:
        _slots.release()
    _record(endpoint, True)
    return r.json()["results"]["bindings"]


def _row(s: str, p: str, o: dict) -> dict:
    if o["type"] == "uri":
        return {"s": s, "p": p, "o": o["value"], "o_iri": True, "datatype": None, "lang": None}
    dt = o.get("datatype")
    return {"s": s, "p": p, "o": o["value"], "o_iri": False, "lang": o.get("xml:lang"),
            "datatype": None if o.get("xml:lang") or dt == XSD + "string" else dt}


def triples(endpoint: str, iri: str, direction: str, limit: int, timeout: float = 20.0) -> tuple[list[dict], dict[str, str]]:
    """(triples, labels) of one resource, cached for a few minutes."""
    return _cache.get((endpoint, iri, direction, limit), CACHE_SECONDS,
                      lambda: _triples(endpoint, iri, direction, limit, timeout))


def _triples(endpoint: str, iri: str, direction: str, limit: int, timeout: float) -> tuple[list[dict], dict[str, str]]:
    if direction == "out":
        rows = [_row(iri, b["p"]["value"], b["o"])
                for b in sparql(endpoint, f"SELECT ?p ?o WHERE {{ <{iri}> ?p ?o }} ORDER BY ?p ?o LIMIT {limit}", timeout)
                if b["o"]["type"] in ("uri", "literal", "typed-literal")]
    else:
        rows = [_row(b["s"]["value"], b["p"]["value"], {"type": "uri", "value": iri})
                for b in sparql(endpoint, f"SELECT ?s ?p WHERE {{ ?s ?p <{iri}> }} ORDER BY ?p ?s LIMIT {limit}", timeout)
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
        except (httpx.HTTPError, Overloaded):
            pass  # labels are a nicety; the triples are what was asked for
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
