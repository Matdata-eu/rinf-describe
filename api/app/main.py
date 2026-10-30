"""RINF Describe HTTP API.

Every page is built live from ERA's SPARQL endpoint with the describe shapes
(livepage.py): the class pages, the plain triples and their labels (live.py). The
search box asks RINF Atlas's public search API (atlas.py); the start-page examples
and the sitemaps are SPARQL queries too, kept for a day. Nothing is stored.
"""
from __future__ import annotations

import logging
import math
import os
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote_plus
from xml.sax.saxutils import escape

import httpx
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.gzip import GZipMiddleware

from . import atlas, datamodel, live, livepage, ontology, shapes
from . import rdf as R

log = logging.getLogger("describe")

# Environments, in menu order: key=label pairs; the first is the default.
ENVS = [tuple((part.split("=", 1) + [part.upper()])[:2]) for part in
        (p.strip() for p in os.environ.get("DESCRIBE_ENVS", "prod=PROD,uat=UAT").split(",")) if part]
ENDPOINTS = {
    "prod": "https://graph.data.era.europa.eu/repositories/rinf-plus",
    "uat": "https://graph.uat.data.test-era.europa.eu/repositories/rinf-plus",
}
# ERA's dataset explorer: who published a graph, and when.
DATASET_APIS = {
    "prod": "https://rinf.data.era.europa.eu/api/v1",
    "uat": "https://rinf.uat.data.test-era.europa.eu/api/v1",
}
for _k, _v in os.environ.items():  # DESCRIBE_SPARQL_PROD=https://... overrides or adds one, DESCRIBE_DATASETS_PROD too
    for _prefix, _map in (("DESCRIBE_SPARQL_", ENDPOINTS), ("DESCRIBE_DATASETS_", DATASET_APIS)):
        if _k.startswith(_prefix) and _v.strip():
            _map[_k[len(_prefix):].lower()] = _v.strip()
# Rows per SPARQL query and queries in flight for a page.
LIVE_BATCH = int(os.environ.get("DESCRIBE_LIVE_BATCH", "12"))
LIVE_WORKERS = int(os.environ.get("DESCRIBE_LIVE_WORKERS", "8"))
PAGE_CACHE_SECONDS = 600
DAY = 86400
# RINF Atlas: the "Open in RINF Atlas" button and the search box. Empty: IRIs only.
ATLAS_URL = os.environ.get("DESCRIBE_ATLAS_URL", "https://rinf-atlas.matdata.eu").rstrip("/")
# Public address of the instance; with it the API serves the sitemaps of the describe pages
# (docs/seo.md). Without it there are none.
PUBLIC_URL = os.environ.get("DESCRIBE_PUBLIC_URL", "").strip().rstrip("/")
SITEMAP_SIZE = 40000  # URLs per sitemap file (the protocol allows 50,000)
TRIPLES_MAX = 5000
GRAPH_MAX = 200

dset: shapes.DescribeSet = shapes.DescribeSet([], {})
_cache: dict[tuple, tuple[float, Any]] = {}
ontologies = ontology.Cache()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global dset
    try:
        dset = shapes.load()
    except shapes.ShapeError as e:  # pages then show the generic tabs only
        log.error("describe shapes are invalid, no class pages: %s", e)
    yield


app = FastAPI(title="RINF Describe API", version="1.2.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _cached(key: tuple, seconds: float | Callable[[Any], float], fn: Callable[[], Any]) -> Any:
    """fn(), kept for `seconds` under key (or for as long as `seconds(value)` says)."""
    hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return hit[1]
    value = fn()
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.time() + (seconds(value) if callable(seconds) else seconds), value)
    return value


def _env(env: str | None) -> str:
    keys = [k for k, _ in ENVS]
    if not env:
        env = keys[0]
    if env not in keys or env not in ENDPOINTS:
        raise HTTPException(404, f"unknown environment {env!r}")
    return env


def _iri(uri: str) -> str:
    if not R.valid_iri(uri):
        raise HTTPException(400, "not a valid IRI")
    return uri


def _sparql(env: str, query: str, timeout: float = 30.0) -> list[dict]:
    try:
        return live.sparql(ENDPOINTS[env], query, timeout)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ERA's SPARQL endpoint did not answer: {e}") from e


def _labels(env: str, iris: set[str]) -> dict[str, str]:
    """skos:prefLabel or rdfs:label of each IRI, read from the endpoint (labels are a nicety:
    an endpoint that fails here leaves them out)."""
    if not iris:
        return {}
    try:
        with ThreadPoolExecutor(4) as pool:
            return livepage.labels(lambda q: live.sparql(ENDPOINTS[env], q), iris, pool)
    except httpx.HTTPError as e:
        log.warning("%s: no labels: %s", env, e)
        return {}


def _triples(env: str, iri: str, direction: str, limit: int) -> tuple[list[dict], dict[str, str]]:
    try:
        return live.triples(ENDPOINTS[env], iri, direction, limit)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ERA's SPARQL endpoint did not answer: {e}") from e


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    return {"envs": [{"key": k, "label": label} for k, label in ENVS if k in ENDPOINTS],
            "atlasUrl": ATLAS_URL or None}


def _ontology(env: str) -> ontology.Ontology:
    return ontologies.get(env, lambda q: live.sparql(ENDPOINTS[env], q, 60.0))


_PATH_IRI = re.compile(r"<([^>]+)>")


def _terms(ds: shapes.DocShape, doc: dict, onto: ontology.Ontology) -> dict[str, dict]:
    """Label, definition, unit and RINF index of the properties on a page: in its rows' paths
    and among its RINF parameters."""
    iris: set[str] = set()
    for row in ds.rows:
        for p in [row.path, *row.params.values(), *(c.path for c in row.columns)]:
            iris.update(_PATH_IRI.findall(p or ""))
    for e in doc["rows"].values():
        for x in e.get("parameters", []):
            iris.add(x["p"])
            if x.get("via"):
                iris.add(x["via"])
    for lst in doc.get("dataStatus", {}).values():
        iris.update(lst)
    return onto.subset(iris)


def _page(env: str, iri: str) -> dict:
    """The class pages of a resource built from ERA's endpoint, kept for a few minutes."""
    def build():
        try:
            return livepage.page(lambda q: live.sparql(ENDPOINTS[env], q), iri, dset,
                                 batch=LIVE_BATCH, workers=LIVE_WORKERS, onto=_ontology(env))
        except httpx.HTTPError as e:
            raise HTTPException(502, f"ERA's SPARQL endpoint did not answer: {e}") from e
    # A shape can keep its pages longer (rd:cacheSeconds: a national line sums up thousands of tracks).
    return _cached(("page", env, iri), lambda p: p.get("cacheSeconds") or PAGE_CACHE_SECONDS, build)


def _dataset(env: str, graph: str | None) -> dict | None:
    """Publisher, title, country and publication date of a provider graph (ERA's dataset explorer)."""
    if not graph:
        return None
    pub = _cached(("datasets", env), 3600, lambda: live.published(DATASET_APIS.get(env)))
    d = pub.get(graph.rstrip("/").rsplit("/", 1)[-1])
    return {"graph": graph, **d} if d else {"graph": graph}


@app.get("/api/describe")
def describe(uri: str, env: str | None = None):
    """The page of one resource: its class pages (layout + evaluated values), classes, labels."""
    env, iri = _env(env), _iri(uri)
    p = _page(env, iri)
    onto = _ontology(env)
    labels = dict(p["labels"])
    pages, terms = [], {}
    for ds, doc in p["pages"]:
        d = ds.definition(dset.groups)
        pages.append({"shape": ds.iri, "class": ds.class_iri, "label": d["label"], "rows": d["rows"],
                      "groups": d["groups"], "doc": doc})
        terms.update(_terms(ds, doc, onto))
    return {"iri": iri, "env": env, "source": "live" if p["classes"] or p["counts"]["out"] else "missing",
            "title": labels.get(iri), "classes": p["classes"], "graph": p["graph"],
            "dataset": _dataset(env, p["graph"]), "pages": pages, "counts": p["counts"], "labels": labels,
            "terms": terms, "chapters": onto.chapters if pages else {}, "timing": p["timing"]}


@app.get("/api/model")
def model(uri: str, env: str | None = None):
    """The data model of the resource's class from ERA's SHACL shapes (the "Data model" tab), with
    how often the resource uses each property, out and in."""
    env, iri = _env(env), _iri(uri)
    p = _page(env, iri)
    onto = _ontology(env)
    m = datamodel.model(onto, p["classes"])
    if m and p["pages"]:
        # What the page shows: its rows' paths walked from the class over ERA's model.
        m["page"] = datamodel.page_model(onto, m["focus"], p["pages"][0][0].rows, dset.groups)
    if not m:
        return {"iri": iri, "env": env, "model": None, "used": {"out": {}, "in": {}, "via": {}}}

    def used():
        # "via": given on a common characteristics subset the resource belongs to.
        q = (f"SELECT ?d ?p (COUNT(*) AS ?n) WHERE {{ {{ <{iri}> ?p ?o BIND('out' AS ?d) }} UNION "
             f"{{ ?s ?p <{iri}> BIND('in' AS ?d) }} UNION {{ <{iri}> <http://data.europa.eu/949/belongsTo> ?c . "
             f"?c a <http://data.europa.eu/949/CommonCharacteristicsSubset> ; ?p ?o BIND('via' AS ?d) }} }} GROUP BY ?d ?p")
        out: dict[str, dict[str, int]] = {"out": {}, "in": {}, "via": {}}
        for b in _sparql(env, q):
            out[b["d"]["value"]][b["p"]["value"]] = int(b["n"]["value"])
        return out
    return {"iri": iri, "env": env, "model": m, "used": _cached(("used", env, iri), PAGE_CACHE_SECONDS, used)}


@app.get("/api/rows")
def rows(uri: str, key: str, env: str | None = None, offset: int = Query(0, ge=0, le=1_000_000)):
    """More of a table with rd:limit: its linked resources from `offset`, with their labels."""
    env, iri = _env(env), _iri(uri)
    p = _page(env, iri)
    for ds, _doc in p["pages"]:
        row = next((r for r in ds.rows if r.key == key and r.columns and r.limit), None)
        if row:
            break
    else:
        raise HTTPException(404, f"no paged table {key!r} on this page")
    parts = livepage.branches(iri, ds, [row], status=False, offset=offset)

    def read():
        q = livepage.query(None if row.scope_all else p["graph"], parts)
        doc = livepage.assemble(shapes.DocShape(ds.iri, ds.class_iri, ds.label, [row]), _sparql(env, q))
        return doc["rows"].get(key, {})
    entry = _cached(("rows", env, iri, key, offset), PAGE_CACHE_SECONDS, read)
    found: set[str] = set()
    livepage._collect(entry.get("items", []), found)
    return {"key": key, "offset": offset, "items": entry.get("items", []), "total": entry.get("total"),
            "labels": _labels(env, found)}


@app.get("/api/triples")
def triples(uri: str, env: str | None = None, dir: str = Query("out", pattern="^(out|in)$"),
            limit: int = Query(1000, ge=1, le=TRIPLES_MAX)):
    """All properties (dir=out) or incoming links (dir=in) of a resource, with labels."""
    env, iri = _env(env), _iri(uri)
    rows, labels = _triples(env, iri, dir, limit)
    return {"iri": iri, "env": env, "dir": dir, "triples": rows, "labels": labels,
            "truncated": len(rows) >= limit}


@app.get("/api/graph")
def graph(uri: str, env: str | None = None):
    """Neighbourhood of a resource for the graph view: its links out and in, one hop."""
    env, iri = _env(env), _iri(uri)
    out, lab_out = _triples(env, iri, "out", GRAPH_MAX)
    inc, lab_in = _triples(env, iri, "in", GRAPH_MAX)
    nodes = sorted({iri} | {t["o"] for t in out if t["o_iri"]} | {t["s"] for t in inc})
    types: dict[str, list[str]] = {}
    ok = [n for n in nodes if not any(c in n for c in '<> "{}|^`\\')]
    for i in range(0, len(ok), 200):
        vals = " ".join(f"<{n}>" for n in ok[i:i + 200])
        for b in _sparql(env, f"SELECT ?s ?t WHERE {{ VALUES ?s {{ {vals} }} ?s a ?t }}"):
            if b["t"]["type"] == "uri":
                types.setdefault(b["s"]["value"], []).append(b["t"]["value"])
    labels = {**lab_out, **lab_in, **_labels(env, {c for cs in types.values() for c in cs})}
    return {"iri": iri, "env": env, "out": out, "in": inc, "types": types, "labels": labels}


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


@app.get("/api/export")
def export(uri: str, env: str | None = None, format: str = Query("ttl", pattern="^(ttl|nt|csv)$")):
    """The resource's outgoing triples as Turtle, N-Triples or CSV."""
    env, iri = _env(env), _iri(uri)
    rows, labels = _triples(env, iri, "out", TRIPLES_MAX)
    if not rows:
        raise HTTPException(404, "no triples for this resource")
    name = _SAFE.sub("-", iri.rstrip("/").rsplit("/", 1)[-1]).strip("-") or "resource"
    if format == "nt":
        body, media = R.ntriples(rows), "application/n-triples"
    elif format == "csv":
        body, media = R.table(rows, labels), "text/csv"
    else:
        body, media = R.turtle(rows, f"{iri}\nenvironment {env}, from ERA's SPARQL endpoint"), "text/turtle"
    return Response(body, media_type=f"{media}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'})


def _classes(env: str | None = None) -> list[str]:
    """The classes that have a class page: those of the shapes and their subclasses (every
    infrastructure class has the base page)."""
    own = {s.class_iri for s in dset.shapes}
    onto = _ontology(env or ENVS[0][0])
    return sorted(own.union(*(onto.descendants(c) for c in own)))


def _example_shapes() -> list[shapes.DocShape]:
    """The shapes of a class of its own: not a base page under other class pages."""
    onto = _ontology(ENVS[0][0])
    own = {s.class_iri for s in dset.shapes}
    return [s for s in dset.shapes if not (onto.descendants(s.class_iri) & own)]


@app.get("/api/search")
def search(q: str = Query(..., min_length=2, max_length=200), env: str | None = None,
           limit: int = Query(20, ge=1, le=50)):
    """Resources of a class with a page layout whose name matches, from RINF Atlas's search."""
    env = _env(env)
    if R.valid_iri(q) and q.startswith("http"):
        return {"results": [{"iri": q, "label": None, "class": None}]}
    if not ATLAS_URL:
        return {"results": []}
    try:
        return {"results": atlas.search(ATLAS_URL, env, q, _classes(env), limit)}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"RINF Atlas's search did not answer: {e}") from e


@app.get("/api/examples")
def examples(env: str | None = None):
    """One resource per class page, for the start page."""
    env = _env(env)

    def find():
        out = []
        for ds in sorted(_example_shapes(), key=lambda s: s.label):
            hit = _sparql(env, f"SELECT ?s WHERE {{ ?s a <{ds.class_iri}> FILTER(isIRI(?s)) }} LIMIT 1")
            if hit:
                out.append({"class": ds.class_iri, "classLabel": ds.label, "iri": hit[0]["s"]["value"]})
        labels = _labels(env, {r["iri"] for r in out})
        return [{**r, "label": labels.get(r["iri"])} for r in out]
    return {"results": _cached(("examples", env), DAY, find)}


# ---------- sitemaps: one URL per resource with a class page, default environment only ----------
_XML = "application/xml; charset=utf-8"
_SITEMAP_HEADERS = {"Cache-Control": "public, max-age=3600"}


def _form(v: str) -> str:
    """Form encoding as the browser's URLSearchParams writes it (which also escapes ~)."""
    return quote_plus(v, safe="*").replace("~", "%7E")


def _sitemap_env() -> str:
    if not PUBLIC_URL:
        raise HTTPException(404, "no sitemap: DESCRIBE_PUBLIC_URL is not set")
    return ENVS[0][0]


def _sitemap_values() -> str:
    return " ".join(f"<{c}>" for c in _classes())


@app.get("/api/sitemap.xml")
def sitemap_index():
    """Sitemap index: the static pages (sitemap-site.xml, written by the web container) and
    one file per SITEMAP_SIZE describe pages. nginx serves it at /sitemap.xml."""
    env = _sitemap_env()

    def count():
        if not _classes():
            return 0
        res = _sparql(env, f"SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE {{ VALUES ?c {{ {_sitemap_values()} }} "
                           "?s a ?c FILTER(isIRI(?s)) }", timeout=120)
        return int(res[0]["n"]["value"]) if res else 0
    files = math.ceil(_cached(("sitemap-count", env), DAY, count) / SITEMAP_SIZE)
    locs = [f"{PUBLIC_URL}/sitemap-site.xml"] + [f"{PUBLIC_URL}/sitemap-{i}.xml" for i in range(1, files + 1)]
    body = "".join(f"  <sitemap><loc>{escape(u)}</loc></sitemap>\n" for u in locs)
    return Response('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    f"{body}</sitemapindex>\n", media_type=_XML, headers=_SITEMAP_HEADERS)


@app.get("/api/sitemap-{n:int}.xml")
def sitemap_page(n: int):
    """The n-th file of describe pages (from 1), with the publication date of their dataset."""
    env = _sitemap_env()
    if n < 1 or not _classes():
        raise HTTPException(404, "no such sitemap")

    def read():
        return _sparql(env, f"""SELECT ?s (SAMPLE(?g) AS ?graph) WHERE {{ VALUES ?c {{ {_sitemap_values()} }}
                                GRAPH ?g {{ ?s a ?c }} FILTER(isIRI(?s)) }}
                                GROUP BY ?s ORDER BY ?s OFFSET {(n - 1) * SITEMAP_SIZE} LIMIT {SITEMAP_SIZE}""",
                       timeout=120)
    rows = _cached(("sitemap", env, n), DAY, read)
    if not rows:
        raise HTTPException(404, "no such sitemap")
    out = []
    for r in rows:
        iri = r["s"]["value"]
        # The same address the pages give as canonical (web/src/seo.ts): uri, then env.
        loc = f"{PUBLIC_URL}/describe?uri={_form(iri)}&env={_form(env)}"
        modified = (_dataset(env, r["graph"]["value"]) or {}).get("modified") if "graph" in r else None
        mod = f"<lastmod>{modified[:10]}</lastmod>" if modified else ""
        out.append(f"  <url><loc>{escape(loc)}</loc>{mod}</url>\n")
    return Response('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    f"{''.join(out)}</urlset>\n", media_type=_XML, headers=_SITEMAP_HEADERS)
