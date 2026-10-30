"""RINF Describe HTTP API.

Pages come from the describe index that RINF Atlas's worker builds when
ATLAS_DESCRIBE is on (tables describe_doc, describe_def, describe_triple; labels
in term). The API only reads that database. A resource the index does not hold
is described live from ERA's SPARQL endpoint (plain triples, no class page).
"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from typing import Any

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.gzip import GZipMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import live
from . import rdf as R

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
ATLAS_URL = os.environ.get("DESCRIBE_ATLAS_URL", "https://rinf-atlas.matdata.eu").rstrip("/")
TRIPLES_MAX = 5000
GRAPH_MAX = 200

pool: ConnectionPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DESCRIBE_DB_POOL", "8")),
                          kwargs={"row_factory": dict_row, "autocommit": True}, open=True)
    yield
    pool.close()


app = FastAPI(title="RINF Describe API", version="0.1.0", lifespan=lifespan,
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
    return {r["iri"]: r["label"] for r in _q("SELECT iri, label FROM term WHERE env=%s AND iri = ANY(%s)", (env, todo))}


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


@app.get("/api/describe")
def describe(uri: str, env: str | None = None):
    """The page of one resource: its class pages (layout + evaluated values), classes, labels."""
    env, iri = _env(env), _iri(uri)
    docs = _q("""SELECT d.shape, d.graph_iri, d.doc, f.class_iri, f.def
                 FROM describe_doc d JOIN describe_def f ON f.shape = d.shape
                 WHERE d.env=%s AND d.iri=%s ORDER BY d.shape""", (env, iri))
    types = [r["o"] for r in _q("SELECT DISTINCT o FROM describe_triple WHERE env=%s AND s=%s AND p=%s AND o_iri",
                                (env, iri, R.RDF_TYPE))]
    counts = _q("""SELECT (SELECT count(*) FROM describe_triple WHERE env=%s AND s=%s) AS out,
                          (SELECT count(*) FROM describe_triple WHERE env=%s AND o=%s AND o_iri) AS inc""",
                (env, iri, env, iri))
    n_out, n_in = (counts[0]["out"], counts[0]["inc"]) if counts else (0, 0)
    graph = docs[0]["graph_iri"] if docs else None
    if not graph and n_out:
        g = _q("SELECT graph_iri FROM describe_triple WHERE env=%s AND s=%s LIMIT 1", (env, iri))
        graph = g[0]["graph_iri"] if g else None
    source = "index" if (docs or n_out) else ("live" if LIVE and env in ENDPOINTS else "missing")

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
    dataset = None
    if graph:
        ds = _q("SELECT provider, title, country, modified FROM dataset WHERE env=%s AND graph_iri=%s", (env, graph))
        if ds:
            dataset = {"graph": graph, "provider": ds[0]["provider"], "title": ds[0]["title"],
                       "country": ds[0]["country"],
                       "modified": ds[0]["modified"].isoformat() if ds[0]["modified"] else None}
        else:
            dataset = {"graph": graph}
    return {"iri": iri, "env": env, "source": source, "title": title, "classes": types, "graph": graph,
            "dataset": dataset, "pages": pages, "counts": {"out": n_out, "in": n_in}, "labels": labels}


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
