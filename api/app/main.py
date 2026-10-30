"""RINF Describe HTTP API.

Pages come from the describe index that RINF Atlas's worker builds when
ATLAS_DESCRIBE is on (tables describe_doc, describe_def, describe_triple; labels
in term). The API only reads that database. A resource the index does not hold
gets its class pages built live from ERA's SPARQL endpoint with the same shapes
(livepage.py), and its plain triples read live (live.py).
"""
from __future__ import annotations

import logging
import math
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote_plus
from xml.sax.saxutils import escape

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.gzip import GZipMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import live, livepage, shapes
from . import rdf as R

log = logging.getLogger("describe")

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://describe_ro:describe@db:5432/atlas")
# Environments, in menu order: key=label pairs; the first is the default.
ENVS = [tuple((part.split("=", 1) + [part.upper()])[:2]) for part in
        (p.strip() for p in os.environ.get("DESCRIBE_ENVS", "prod=PROD,uat=UAT").split(",")) if part]
ENDPOINTS = {
    "prod": "https://graph.data.era.europa.eu/repositories/rinf-plus",
    "uat": "https://graph.uat.data.test-era.europa.eu/repositories/rinf-plus",
}
for _k, _v in os.environ.items():  # DESCRIBE_SPARQL_PROD=https://... overrides or adds one
    if _k.startswith("DESCRIBE_SPARQL_") and _v.strip():
        ENDPOINTS[_k[len("DESCRIBE_SPARQL_"):].lower()] = _v.strip()
LIVE = os.environ.get("DESCRIBE_LIVE", "1") not in ("0", "false", "no", "off")
# Rows per SPARQL query and queries in flight for a live class page.
LIVE_BATCH = int(os.environ.get("DESCRIBE_LIVE_BATCH", "12"))
LIVE_WORKERS = int(os.environ.get("DESCRIBE_LIVE_WORKERS", "8"))
LIVE_CACHE_SECONDS = 600
ATLAS_URL = os.environ.get("DESCRIBE_ATLAS_URL", "https://rinf-atlas.matdata.eu").rstrip("/")
# Public address of the instance; with it the API serves the sitemaps of the describe pages
# (docs/seo.md). Without it there are none.
PUBLIC_URL = os.environ.get("DESCRIBE_PUBLIC_URL", "").strip().rstrip("/")
SITEMAP_SIZE = 40000  # URLs per sitemap file (the protocol allows 50,000)
TRIPLES_MAX = 5000
GRAPH_MAX = 200

pool: ConnectionPool | None = None
dset: shapes.DescribeSet | None = None
_live_pages: dict[tuple[str, str], tuple[float, dict]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool, dset
    pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DESCRIBE_DB_POOL", "8")),
                          kwargs={"row_factory": dict_row, "autocommit": True}, open=True)
    try:
        dset = shapes.load()
    except shapes.ShapeError as e:  # live pages show the generic tabs only; indexed pages are unaffected
        log.error("describe shapes are invalid, no live class pages: %s", e)
    yield
    pool.close()


app = FastAPI(title="RINF Describe API", version="1.1.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _q(sql: str, params: Any = ()) -> list[dict]:
    """Rows of a query; [] when the describe tables do not exist (index switched off)."""
    assert pool is not None
    with pool.connection() as conn:
        try:
            return conn.execute(sql, params).fetchall()
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            return []


def _env(env: str | None) -> str:
    keys = [k for k, _ in ENVS]
    if not env:
        return keys[0]
    if env not in keys:
        raise HTTPException(404, f"unknown environment {env!r}")
    return env


def _iri(uri: str) -> str:
    if not R.valid_iri(uri):
        raise HTTPException(400, "not a valid IRI")
    return uri


def _labels(env: str, iris: set[str]) -> dict[str, str]:
    todo = sorted(i for i in iris if i)
    if not todo:
        return {}
    labels = {r["iri"]: r["label"] for r in _q("SELECT iri, label FROM term WHERE env=%s AND iri = ANY(%s)",
                                               (env, todo))}
    # Atlas's worker labels the values on a page only; tracks, operational points and lines
    # that show up elsewhere (tables, All properties, incoming links) fall back to
    # Atlas's feature label, then to their own rdfs:label or skos:prefLabel in the index.
    if missing := [i for i in todo if i not in labels]:
        for r in _q("SELECT iri, label FROM feature WHERE env=%s AND iri = ANY(%s) AND label IS NOT NULL",
                    (env, missing)):
            labels.setdefault(r["iri"], r["label"])
    if missing := [i for i in todo if i not in labels]:
        rows = _q("SELECT s, o, lang FROM describe_triple WHERE env=%s AND s = ANY(%s) AND p = ANY(%s) AND NOT o_iri",
                  (env, missing, [R.SKOS_PREF, R.RDFS_LABEL]))
        rows.sort(key=lambda r: (r["lang"] not in ("en", None), r["lang"] is not None, r["o"]))
        for r in rows:
            labels.setdefault(r["s"], r["o"])
    return labels


def _collect(node: Any, out: set[str]) -> None:
    """Every IRI inside an evaluated describe document."""
    if isinstance(node, dict):
        v = node.get("iri")
        if isinstance(v, str):
            out.add(v)
        for x in node.values():
            _collect(x, out)
    elif isinstance(node, list):
        for x in node:
            if isinstance(x, str) and x.startswith("http"):
                out.add(x)  # dataStatus lists hold plain property IRIs
            else:
                _collect(x, out)


@app.get("/api/health")
def health():
    _q("SELECT 1")
    return {"ok": True}


@app.get("/api/config")
def config():
    rows = _q("SELECT env, describe_hash, updated_at FROM index_state")
    state = {r["env"]: r for r in rows}
    return {
        "envs": [{"key": k, "label": label, "indexed": bool(state.get(k, {}).get("describe_hash")),
                  "updatedAt": state[k]["updated_at"].isoformat() if k in state else None} for k, label in ENVS],
        "live": LIVE,
        "atlasUrl": ATLAS_URL or None,
    }


def _live_page(env: str, iri: str) -> dict:
    """The class pages of a resource built live from ERA's endpoint, cached for a few minutes."""
    key = (env, iri)
    hit = _live_pages.get(key)
    if hit and time.time() - hit[0] < LIVE_CACHE_SECONDS:
        return hit[1]
    try:
        p = livepage.page(lambda q: live.sparql(ENDPOINTS[env], q), iri, dset or shapes.DescribeSet([], {}),
                          batch=LIVE_BATCH, workers=LIVE_WORKERS)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ERA's SPARQL endpoint did not answer: {e}") from e
    if len(_live_pages) > 500:
        _live_pages.clear()
    _live_pages[key] = (time.time(), p)
    return p


def _dataset(env: str, graph: str | None) -> dict | None:
    if not graph:
        return None
    ds = _q("SELECT provider, title, country, modified FROM dataset WHERE env=%s AND graph_iri=%s", (env, graph))
    if not ds:
        return {"graph": graph}
    return {"graph": graph, "provider": ds[0]["provider"], "title": ds[0]["title"], "country": ds[0]["country"],
            "modified": ds[0]["modified"].isoformat() if ds[0]["modified"] else None}


@app.get("/api/describe")
def describe(uri: str, env: str | None = None, source: str = Query("auto", pattern="^(auto|index|live)$")):
    """The page of one resource: its class pages (layout + evaluated values), classes, labels.

    From the describe index when it holds the resource; otherwise built live from ERA's
    endpoint with the same shapes. source=live builds it live anyway, source=index never."""
    env, iri = _env(env), _iri(uri)
    can_live = LIVE and env in ENDPOINTS and source != "index"
    if source == "live":
        if not can_live:
            raise HTTPException(404, f"no live endpoint for {env!r}")
        return _describe_live(env, iri)
    docs = _q("""SELECT d.shape, d.graph_iri, d.doc, f.class_iri, f.def
                 FROM describe_doc d JOIN describe_def f ON f.shape = d.shape
                 WHERE d.env=%s AND d.iri=%s ORDER BY d.shape""", (env, iri))
    types = [r["o"] for r in _q("SELECT DISTINCT o FROM describe_triple WHERE env=%s AND s=%s AND p=%s AND o_iri",
                                (env, iri, R.RDF_TYPE))]
    # Not in the index, or in it without the pages its classes have (shapes newer than the index).
    if can_live and not docs and (not types or (dset and dset.for_classes(types))):
        return _describe_live(env, iri)
    t0 = time.perf_counter()
    counts = _q("""SELECT (SELECT count(*) FROM describe_triple WHERE env=%s AND s=%s) AS out,
                          (SELECT count(*) FROM describe_triple WHERE env=%s AND o=%s AND o_iri) AS inc""",
                (env, iri, env, iri))
    n_out, n_in = (counts[0]["out"], counts[0]["inc"]) if counts else (0, 0)
    graph = docs[0]["graph_iri"] if docs else None
    if not graph and n_out:
        g = _q("SELECT graph_iri FROM describe_triple WHERE env=%s AND s=%s LIMIT 1", (env, iri))
        graph = g[0]["graph_iri"] if g else None
    found = "index" if (docs or n_out) else "missing"

    iris: set[str] = {iri, *types}
    if graph:
        iris.add(graph)
    pages = []
    for d in docs:
        _collect(d["doc"], iris)
        iris.add(d["class_iri"])
        pages.append({"shape": d["shape"], "class": d["class_iri"], "label": d["def"].get("label"),
                      "rows": d["def"].get("rows", []), "groups": d["def"].get("groups", []), "doc": d["doc"]})
    labels = _labels(env, iris)
    title = labels.get(iri)
    if not title:
        ft = _q("SELECT label FROM feature WHERE env=%s AND iri=%s AND label IS NOT NULL LIMIT 1", (env, iri))
        title = ft[0]["label"] if ft else None
    if not title and n_out:
        lab = _q("SELECT o, lang FROM describe_triple WHERE env=%s AND s=%s AND p=%s AND NOT o_iri", (env, iri, R.RDFS_LABEL))
        lab.sort(key=lambda r: (r["lang"] not in ("en", None), r["lang"] is not None))
        title = lab[0]["o"] if lab else None
    return {"iri": iri, "env": env, "source": found, "title": title, "classes": types, "graph": graph,
            "dataset": _dataset(env, graph), "pages": pages, "counts": {"out": n_out, "in": n_in}, "labels": labels,
            "timing": {"total": round((time.perf_counter() - t0) * 1000)}}


def _describe_live(env: str, iri: str) -> dict:
    p = _live_page(env, iri)
    labels = dict(p["labels"])
    pages = []
    for ds, doc in p["pages"]:
        d = ds.definition(dset.groups)
        pages.append({"shape": ds.iri, "class": ds.class_iri, "label": d["label"], "rows": d["rows"],
                      "groups": d["groups"], "doc": doc})
    title = labels.get(iri)
    if not title:
        ft = _q("SELECT label FROM feature WHERE env=%s AND iri=%s AND label IS NOT NULL LIMIT 1", (env, iri))
        title = ft[0]["label"] if ft else None
    return {"iri": iri, "env": env, "source": "live" if p["classes"] or p["counts"]["out"] else "missing",
            "title": title, "classes": p["classes"], "graph": p["graph"], "dataset": _dataset(env, p["graph"]),
            "pages": pages, "counts": p["counts"], "labels": labels, "timing": p["timing"]}


def _index_triples(env: str, iri: str, direction: str, limit: int, offset: int) -> list[dict]:
    if direction == "out":
        sql = """SELECT s, p, o, o_iri, datatype, lang, graph_iri FROM describe_triple
                 WHERE env=%s AND s=%s ORDER BY p, o LIMIT %s OFFSET %s"""
    else:
        sql = """SELECT s, p, o, o_iri, datatype, lang, graph_iri FROM describe_triple
                 WHERE env=%s AND o=%s AND o_iri ORDER BY p, s LIMIT %s OFFSET %s"""
    return _q(sql, (env, iri, limit, offset))


def _triples(env: str, iri: str, direction: str, limit: int, offset: int = 0) -> tuple[list[dict], str]:
    rows = _index_triples(env, iri, direction, limit, offset)
    if rows or offset:
        return rows, "index"
    # Nothing in the index: a resource it does not hold, or one without incoming links.
    held = _q("SELECT 1 FROM describe_triple WHERE env=%s AND s=%s LIMIT 1", (env, iri))
    if held or not LIVE or env not in ENDPOINTS:
        return [], "index"
    try:
        rows, _ = live.triples(ENDPOINTS[env], iri, direction, limit)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ERA's SPARQL endpoint did not answer: {e}") from e
    return rows, "live"


@app.get("/api/triples")
def triples(uri: str, env: str | None = None, dir: str = Query("out", pattern="^(out|in)$"),
            limit: int = Query(1000, ge=1, le=TRIPLES_MAX), offset: int = Query(0, ge=0)):
    """All properties (dir=out) or incoming links (dir=in) of a resource, with labels."""
    env, iri = _env(env), _iri(uri)
    rows, source = _triples(env, iri, dir, limit, offset)
    iris = {t["p"] for t in rows} | {t["s"] for t in rows} | {t["o"] for t in rows if t["o_iri"]}
    labels = _labels(env, iris)
    if source == "live":
        _, live_labels = live.triples(ENDPOINTS[env], iri, dir, limit)
        labels = {**live_labels, **labels}
    for t in rows:
        t.pop("graph_iri", None)
    return {"iri": iri, "env": env, "dir": dir, "source": source, "triples": rows, "labels": labels,
            "truncated": len(rows) >= limit}


@app.get("/api/graph")
def graph(uri: str, env: str | None = None):
    """Neighbourhood of a resource for the graph view: its links out and in, one hop."""
    env, iri = _env(env), _iri(uri)
    out, _ = _triples(env, iri, "out", GRAPH_MAX)
    inc, _ = _triples(env, iri, "in", GRAPH_MAX)
    nodes = {iri} | {t["o"] for t in out if t["o_iri"]} | {t["s"] for t in inc}
    types: dict[str, list[str]] = {}
    for r in _q("SELECT s, o FROM describe_triple WHERE env=%s AND s = ANY(%s) AND p=%s AND o_iri",
                (env, sorted(nodes), R.RDF_TYPE)):
        types.setdefault(r["s"], []).append(r["o"])
    labels = _labels(env, nodes | {t["p"] for t in out + inc} | {c for cs in types.values() for c in cs})
    for t in out + inc:
        t.pop("graph_iri", None)
    return {"iri": iri, "env": env, "out": out, "in": inc, "types": types, "labels": labels}


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


@app.get("/api/export")
def export(uri: str, env: str | None = None, format: str = Query("ttl", pattern="^(ttl|nt|csv)$")):
    """The resource's outgoing triples as Turtle, N-Triples or CSV."""
    env, iri = _env(env), _iri(uri)
    rows, source = _triples(env, iri, "out", TRIPLES_MAX)
    if not rows:
        raise HTTPException(404, "no triples for this resource")
    name = _SAFE.sub("-", iri.rstrip("/").rsplit("/", 1)[-1]).strip("-") or "resource"
    if format == "nt":
        body, media = R.ntriples(rows), "application/n-triples"
    elif format == "csv":
        body = R.table(rows, _labels(env, {t["p"] for t in rows} | {t["o"] for t in rows if t["o_iri"]}))
        media = "text/csv"
    else:
        where = "RINF Describe index" if source == "index" else "ERA's SPARQL endpoint (live)"
        body, media = R.turtle(rows, f"{iri}\nenvironment {env}, from the {where}"), "text/turtle"
    return Response(body, media_type=f"{media}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'})


@app.get("/api/search")
def search(q: str = Query(..., min_length=2, max_length=200), env: str | None = None,
           limit: int = Query(20, ge=1, le=50)):
    """Resources with a describe page whose label matches, for the start page."""
    env = _env(env)
    if R.valid_iri(q) and q.startswith("http"):
        return {"results": [{"iri": q, "label": None, "class": None}]}
    like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    # Labels come from Atlas's feature table (trigram index), limited to resources with a page.
    rows = _q("""SELECT iri, label, class FROM (
                   SELECT DISTINCT ON (ft.iri) ft.iri, ft.label, ft.class_iri AS class FROM feature ft
                   WHERE ft.env=%s AND ft.label ILIKE %s
                     AND EXISTS (SELECT 1 FROM describe_doc d WHERE d.env = ft.env AND d.iri = ft.iri)
                   ORDER BY ft.iri) x
                 ORDER BY length(label), label LIMIT %s""", (env, like, limit))
    return {"results": rows}


@app.get("/api/examples")
def examples(env: str | None = None):
    """One resource per class page, for the start page."""
    env = _env(env)
    rows = _q("""SELECT f.class_iri AS class, f.def->>'label' AS "classLabel", x.iri FROM describe_def f
                 CROSS JOIN LATERAL (SELECT d.iri FROM describe_doc d
                                     WHERE d.env=%s AND d.shape=f.shape LIMIT 1) x
                 ORDER BY f.def->>'label'""", (env,))
    labels = _labels(env, {r["iri"] for r in rows})
    if missing := [r["iri"] for r in rows if r["iri"] not in labels]:
        for r in _q("SELECT iri, label FROM feature WHERE env=%s AND iri = ANY(%s) AND label IS NOT NULL", (env, missing)):
            labels[r["iri"]] = r["label"]
    return {"results": [{**r, "label": labels.get(r["iri"])} for r in rows]}


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


@app.get("/api/sitemap.xml")
def sitemap_index():
    """Sitemap index: the static pages (sitemap-site.xml, written by the web container) and
    one file per SITEMAP_SIZE describe pages. nginx serves it at /sitemap.xml."""
    env = _sitemap_env()
    rows = _q("SELECT count(DISTINCT iri) AS n FROM describe_doc WHERE env=%s", (env,))
    files = math.ceil((rows[0]["n"] if rows else 0) / SITEMAP_SIZE)
    locs = [f"{PUBLIC_URL}/sitemap-site.xml"] + [f"{PUBLIC_URL}/sitemap-{i}.xml" for i in range(1, files + 1)]
    body = "".join(f"  <sitemap><loc>{escape(u)}</loc></sitemap>\n" for u in locs)
    return Response('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    f"{body}</sitemapindex>\n", media_type=_XML, headers=_SITEMAP_HEADERS)


@app.get("/api/sitemap-{n:int}.xml")
def sitemap_page(n: int):
    """The n-th file of describe pages (from 1), with the publication date of their dataset."""
    env = _sitemap_env()
    if n < 1:
        raise HTTPException(404, "no such sitemap")
    rows = _q("""SELECT d.iri, max(ds.modified) AS modified FROM describe_doc d
                 LEFT JOIN dataset ds ON ds.env = d.env AND ds.graph_iri = d.graph_iri
                 WHERE d.env=%s GROUP BY d.iri ORDER BY d.iri OFFSET %s LIMIT %s""",
              (env, (n - 1) * SITEMAP_SIZE, SITEMAP_SIZE))
    if not rows:
        raise HTTPException(404, "no such sitemap")
    out = []
    for r in rows:
        # The same address the pages give as canonical (web/src/seo.ts): uri, then env.
        loc = f"{PUBLIC_URL}/describe?uri={_form(r['iri'])}&env={_form(env)}"
        mod = f"<lastmod>{r['modified'].date().isoformat()}</lastmod>" if r["modified"] else ""
        out.append(f"  <url><loc>{escape(loc)}</loc>{mod}</url>\n")
    return Response('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    f"{''.join(out)}</urlset>\n", media_type=_XML, headers=_SITEMAP_HEADERS)
