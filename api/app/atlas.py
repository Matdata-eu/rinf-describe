"""RINF Atlas's public search API, for the search box: names of sections of line, tracks
and the other classes with a page layout, found in Atlas's full-text index."""
from __future__ import annotations

import time

import httpx

_client = httpx.Client(headers={"Accept": "application/json",
                                "User-Agent": "rinf-describe (+https://github.com/Matdata-eu/rinf-describe)"},
                       timeout=10.0)
_meta: dict[tuple[str, str], tuple[float, dict[str, str]]] = {}


def class_keys(base: str, env: str) -> dict[str, str]:
    """Atlas's class key of each class IRI it maps, kept for an hour."""
    hit = _meta.get((base, env))
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    r = _client.get(f"{base}/api/meta", params={"env": env})
    r.raise_for_status()
    keys = {c["class_iri"]: c["class"] for c in r.json().get("classes", []) if c.get("class_iri")}
    _meta[(base, env)] = (time.time(), keys)
    return keys


def search(base: str, env: str, q: str, classes: list[str], limit: int) -> list[dict]:
    """[{iri, label, class}] of the resources of `classes` whose name matches q, best first."""
    keys = class_keys(base, env)
    wanted = [keys[c] for c in classes if c in keys]
    if not wanted:
        return []
    iri_of = {k: c for c, k in keys.items()}
    r = _client.post(f"{base}/api/search", json={"env": env, "q": q, "classes": wanted, "limit": limit})
    r.raise_for_status()
    return [{"iri": i["iri"], "label": i.get("label"), "class": iri_of.get(i.get("class"))}
            for i in r.json().get("items", [])]
