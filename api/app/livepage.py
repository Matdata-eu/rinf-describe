"""Class pages built live from a SPARQL endpoint.

The describe shapes are evaluated on the resource: each row's values, summaries over
child resources (rd:over + rd:aggregate), linked resources as tables (sh:node), the rd:
paths of the viewers and the data status. Paths are evaluated inside the resource's own
named graph.

A page takes three rounds of queries, each run in parallel:
  1. the resource's named graph and classes, and its triple counts;
  2. the rows of its shapes, a few rows per query (UNION of one branch per row);
  3. the labels of every IRI on the page.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from .ontology import Ontology
from .shapes import WHOLE_VIEWERS, DescribeSet, DocShape

ERA = "http://data.europa.eu/949/"
XSD = "http://www.w3.org/2001/XMLSchema#"
RDF_LANG = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
INFRA = ERA + "InfrastructureElement"
SKOS_PREF = "http://www.w3.org/2004/02/skos/core#prefLabel"
STATUS = (("notApplicable", ERA + "notApplicable"), ("notYetAvailable", ERA + "notYetAvailable"))

Sparql = Callable[[str], list[dict]]  # query -> SPARQL JSON result bindings


def term(b: dict | None) -> dict | None:
    """A SPARQL JSON binding as a value of a describe document (None for blank nodes)."""
    if not b:
        return None
    if b["type"] == "uri":
        return {"iri": b["value"]}
    if b["type"] not in ("literal", "typed-literal"):
        return None
    out = {"value": b["value"]}
    if b.get("xml:lang"):
        out["lang"] = b["xml:lang"]
    elif b.get("datatype") not in (None, XSD + "string", RDF_LANG):
        out["datatype"] = b["datatype"]
    return out


def _num(v: str | None) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _add(lst: list, v: dict | None) -> None:
    if v is not None and v not in lst:
        lst.append(v)


def aggregate(kind: str, per_child: dict[str, list]) -> dict:
    """Sum up the values of a row over child resources ({child: [values]})."""
    n = len(per_child)
    if kind == "count":
        return {"count": n}
    if kind == "sum":
        nums = [x for vs in per_child.values() for x in [_num(vs[0].get("value")) if vs else None] if x is not None]
        total = round(sum(nums), 6)
        return {"sum": int(total) if total.is_integer() else total, "children": n, "withValue": len(nums)}
    if kind == "range":
        nums = [x for vs in per_child.values() for v in vs for x in [_num(v.get("value"))] if x is not None]
        with_value = sum(1 for vs in per_child.values() if vs)
        if not nums:
            return {"children": n, "withValue": with_value}
        lo, hi = min(nums), max(nums)
        return {"min": int(lo) if lo.is_integer() else lo, "max": int(hi) if hi.is_integer() else hi,
                "children": n, "withValue": with_value}
    counts: dict[str, tuple[dict, int]] = {}
    for vs in per_child.values():
        for v in vs:
            k = json.dumps(v, sort_keys=True)
            counts[k] = (v, counts.get(k, (v, 0))[1] + 1)
    values = sorted(({**v, "count": c} for v, c in counts.values()), key=lambda d: (-d["count"], json.dumps(d)))
    return {"values": values, "children": n, "withoutValue": sum(1 for vs in per_child.values() if not vs)}


def _lit(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _linked(s: str, row, var: str = "?c", offset: int = 0) -> str:
    """The pattern binding `var` to the resources a table row links to: of rd:class only, and
    with rd:limit the first ones (from `offset`) in IRI order."""
    pat = f"{s} {row.path} {var} ." + (f" {var} a <{row.filter_class}> ." if row.filter_class else "")
    if row.limit:
        return f"{{ SELECT DISTINCT {var} WHERE {{ {pat} }} ORDER BY {var} LIMIT {row.limit} OFFSET {offset} }}"
    return pat


def branches(iri: str, ds: DocShape, rows=None, status: bool = True, offset: int = 0) -> list[str]:
    """One UNION branch per value set of the page. ?k says what a binding is for:
    v|row (values), o|row (children via rd:over, ?c), i|row (linked resources of a table),
    c|row|col (a column on each of them), a|row|col (a column with rd:over: ?x the linked
    resource, ?c its child), n|row (how many a table links to, with rd:limit),
    p|row|name (viewer path), s|name (data status), x|row (every property of the resource,
    ?c) and y|row|via (every property of a resource ?x it links to with `via` that is not an
    infrastructure element itself: its contact line system, ETCS...)."""
    s = f"<{iri}>"
    out = []
    for row in ds.rows if rows is None else rows:
        cls = f" ?c a <{row.filter_class}> ." if row.filter_class else ""
        if row.viewer in WHOLE_VIEWERS:
            out.append(f"{{ {s} ?c ?v BIND({_lit('x|' + row.key)} AS ?k) }}")
            out.append(f"{{ {s} ?q ?x FILTER(isIRI(?x)) FILTER NOT EXISTS {{ ?x a <{INFRA}> }} ?x ?c ?v "
                       f"BIND(CONCAT({_lit('y|' + row.key + '|')}, STR(?q)) AS ?k) }}")
        elif row.over:
            out.append(f"{{ {s} {row.over} ?c .{cls} OPTIONAL {{ ?c {row.path} ?v }} BIND({_lit('o|' + row.key)} AS ?k) }}")
        elif row.columns:
            out.append(f"{{ {_linked(s, row, '?v', offset)} BIND({_lit('i|' + row.key)} AS ?k) }}")
            for col in row.columns:
                if col.over:
                    ccls = f" ?c a <{col.filter_class}> ." if col.filter_class else ""
                    out.append(f"{{ {_linked(s, row, '?x', offset)} ?x {col.over} ?c .{ccls} OPTIONAL {{ ?c {col.path} ?v }} "
                               f"BIND({_lit('a|' + row.key + '|' + col.key)} AS ?k) }}")
                    continue
                out.append(f"{{ {_linked(s, row, '?c', offset)} OPTIONAL {{ ?c {col.path} ?v }} "
                           f"BIND({_lit('c|' + row.key + '|' + col.key)} AS ?k) }}")
            if row.limit:
                plain = f"{s} {row.path} ?n ." + (f" ?n a <{row.filter_class}> ." if row.filter_class else "")
                out.append(f"{{ {{ SELECT (COUNT(DISTINCT ?n) AS ?v) WHERE {{ {plain} }} }} BIND({_lit('n|' + row.key)} AS ?k) }}")
        elif row.path:
            vcls = f" ?v a <{row.filter_class}> ." if row.filter_class else ""
            out.append(f"{{ {s} {row.path} ?v .{vcls} BIND({_lit('v|' + row.key)} AS ?k) }}")
        for name, path in row.params.items():
            out.append(f"{{ {s} {path} ?v BIND({_lit('p|' + row.key + '|' + name)} AS ?k) }}")
    if status:
        for name, pred in STATUS:
            out.append(f"{{ {s} <{pred}> ?v BIND({_lit('s|' + name)} AS ?k) }}")
    return out


def query(graph: str | None, parts: list[str]) -> str:
    """The branches over the resource's graph, or over every graph (rd:scope "all")."""
    body = " UNION ".join(parts)
    return f"SELECT ?k ?c ?v ?x WHERE {{ {f'GRAPH <{graph}> {{ {body} }}' if graph else body} }}"


def assemble(ds: DocShape, bindings: list[dict]) -> dict:
    """The describe document of one resource from the bindings of its branches."""
    vals: dict[str, list] = {}                            # v|row, i|row, p|row|name, s|name
    kids: dict[str, dict[str, list]] = defaultdict(dict)  # o|row, c|row|col -> child -> values
    props: dict[str, dict[tuple, list]] = defaultdict(dict)  # x|row, y|row -> (p, via, of) -> values
    deep: dict[str, dict[str, dict[str, list]]] = defaultdict(lambda: defaultdict(dict))  # a|row|col -> item -> child -> values
    for b in bindings:
        k = b["k"]["value"]
        v = term(b.get("v"))
        if k[0] == "a":
            x, c = b.get("x"), b.get("c")
            if x and c and x["type"] == c["type"] == "uri":
                lst = deep[k][x["value"]].setdefault(c["value"], [])
                if v is not None:
                    _add(lst, v)
            continue
        if k[0] in "xy":
            if v is None or b.get("c", {}).get("type") != "uri":
                continue
            if k[0] == "x":
                key, where = k, (b["c"]["value"], None, None)
            else:
                row_key, via = k[2:].split("|", 1)
                key, where = "x|" + row_key, (b["c"]["value"], via, b.get("x", {}).get("value"))
            _add(props[key].setdefault(where, []), v)
            continue
        if k[0] in "oc":
            c = b.get("c")
            if not c or c["type"] != "uri":
                continue
            lst = kids[k].setdefault(c["value"], [])
            if v is not None:
                _add(lst, v)
        else:
            _add(vals.setdefault(k, []), v)
    rows: dict[str, dict] = {}
    for row in ds.rows:
        e: dict = {}
        if row.viewer in WHOLE_VIEWERS:
            found = props.get(f"x|{row.key}", {})
            if found:
                e["parameters"] = [{"p": p, **({"via": via, "of": of} if via else {}), "values": vs}
                                   for (p, via, of), vs in sorted(found.items(), key=lambda kv: tuple(x or "" for x in kv[0]))]
        elif row.over:
            if f"o|{row.key}" in kids:
                e["aggregate"] = aggregate(row.aggregate or "distinct-count", kids[f"o|{row.key}"])
        elif row.columns:
            linked = [v["iri"] for v in vals.get(f"i|{row.key}", []) if "iri" in v]
            if linked:
                items = {i: {"iri": i, "cells": {}} for i in linked}
                for col in row.columns:
                    if col.over:
                        for x, per_child in deep.get(f"a|{row.key}|{col.key}", {}).items():
                            if x in items:
                                items[x].setdefault("aggregates", {})[col.key] = aggregate(col.aggregate or "distinct-count", per_child)
                        continue
                    for c, vs in kids.get(f"c|{row.key}|{col.key}", {}).items():
                        if c in items:
                            items[c]["cells"][col.key] = vs
                e["items"] = sorted(items.values(), key=lambda i: i["iri"])
            if row.limit and f"n|{row.key}" in vals:
                e["total"] = int(vals[f"n|{row.key}"][0]["value"])
        elif row.path and f"v|{row.key}" in vals:
            e["values"] = vals[f"v|{row.key}"]
        for name in row.params:
            if f"p|{row.key}|{name}" in vals:
                e.setdefault("params", {})[name] = vals[f"p|{row.key}|{name}"]
        if e:
            rows[row.key] = e
    doc: dict = {"class": ds.class_iri, "rows": rows}
    for name, _ in STATUS:
        if f"s|{name}" in vals:
            doc.setdefault("dataStatus", {})[name] = sorted(v["iri"] for v in vals[f"s|{name}"] if "iri" in v)
    return doc


def labels(sparql: Sparql, iris: set[str], pool: ThreadPoolExecutor, chunk: int = 200) -> dict[str, str]:
    """skos:prefLabel before rdfs:label, English or untagged first."""
    todo = sorted(i for i in iris if i.startswith("http") and not any(c in i for c in '<> "{}|^`\\'))
    queries = [f"""SELECT ?i ?p ?l WHERE {{ VALUES ?i {{ {' '.join(f'<{x}>' for x in todo[n:n + chunk])} }}
                   VALUES ?p {{ <{SKOS_PREF}> <{RDFS_LABEL}> }} ?i ?p ?l }}""" for n in range(0, len(todo), chunk)]
    found: dict[str, tuple[int, str]] = {}
    for res in pool.map(sparql, queries):
        for b in res:
            lit = b["l"]
            if lit["type"] not in ("literal", "typed-literal"):
                continue
            lang = lit.get("xml:lang")
            rank = (0 if b["p"]["value"] == SKOS_PREF else 2) + (0 if lang in ("en", None, "") else 1)
            i = b["i"]["value"]
            if i not in found or rank < found[i][0]:
                found[i] = (rank, lit["value"])
    return {k: v[1] for k, v in found.items()}


def _collect(node, out: set[str]) -> None:
    if isinstance(node, dict):
        if isinstance(node.get("iri"), str):
            out.add(node["iri"])
        for x in node.values():
            _collect(x, out)
    elif isinstance(node, list):
        for x in node:
            if isinstance(x, str) and x.startswith("http"):
                out.add(x)
            else:
                _collect(x, out)


def _indexed(ds: DocShape, doc: dict, onto: Ontology) -> dict:
    """Keeps the RINF parameters: the properties with a RINF index."""
    for row in ds.rows:
        e = doc["rows"].get(row.key)
        if e and "parameters" in e:
            e["parameters"] = [x for x in e["parameters"] if "index" in onto.terms.get(x["p"], {})]
            if not e["parameters"]:
                del doc["rows"][row.key]
    return doc


def page(sparql: Sparql, iri: str, dset: DescribeSet, batch: int = 12, workers: int = 8,
         onto: Ontology | None = None) -> dict:
    """Everything /api/describe needs about one resource, read from the endpoint:
    graph, classes, counts, pages [(shape, doc)], labels and timings in ms. With the
    ontology, shapes of superclasses apply too (shapes.DescribeSet.for_resource)."""
    onto = onto or Ontology()

    def shapes_for(classes):
        return dset.for_resource(classes, onto.ancestors, onto.depth)
    t0 = time.perf_counter()
    timing: dict[str, float] = {}
    with ThreadPoolExecutor(workers) as pool:
        head = pool.submit(sparql, f"SELECT ?g ?t WHERE {{ GRAPH ?g {{ <{iri}> a ?t }} }}")
        n_out = pool.submit(sparql, f"SELECT (COUNT(*) AS ?n) WHERE {{ <{iri}> ?p ?o }}")
        n_in = pool.submit(sparql, f"SELECT (COUNT(*) AS ?n) WHERE {{ ?s ?p <{iri}> FILTER(isIRI(?s)) }}")
        by_graph: dict[str, list[str]] = defaultdict(list)
        for b in head.result():
            if b["t"]["type"] == "uri":
                by_graph[b["g"]["value"]].append(b["t"]["value"])
        classes = sorted({c for cs in by_graph.values() for c in cs})
        # The graph that types the resource with a class page, else any graph that types it.
        # Typed in several graphs (an IM role, a primary location): first the provider whose
        # code is in the IRI (.../organisationRole/0087_IM in graph/0087).
        order = sorted(by_graph, key=lambda g: (g.rstrip("/").rsplit("/", 1)[-1] not in iri, g))
        graph = next((g for g in order if shapes_for(by_graph[g])), order[0] if order else None)
        timing["head"] = (time.perf_counter() - t0) * 1000
        shapes = shapes_for(by_graph.get(graph, [])) if graph else []
        jobs = []
        for ds in shapes:
            wide = [r for r in ds.rows if r.scope_all]
            if wide:  # rows over every graph: queries of their own, without GRAPH
                for p in branches(iri, ds, wide, status=False):
                    jobs.append((ds, pool.submit(sparql, query(None, [p]))))
            parts = branches(iri, ds, [r for r in ds.rows if not r.scope_all])
            # The whole-resource branches (x|, y|) return many rows: a query of their own each.
            alone = [p for p in parts if 'AS ?k' in p and ('"x|' in p or '"y|' in p)]
            parts = [p for p in parts if p not in alone]
            for p in alone:
                jobs.append((ds, pool.submit(sparql, query(graph, [p]))))
            for n in range(0, len(parts), batch):
                jobs.append((ds, pool.submit(sparql, query(graph, parts[n:n + batch]))))
        found: dict[str, list[dict]] = defaultdict(list)
        for ds, f in jobs:
            found[ds.iri].extend(f.result())
        pages = [(ds, _indexed(ds, assemble(ds, found[ds.iri]), onto)) for ds in shapes]
        timing["rows"] = (time.perf_counter() - t0) * 1000 - timing["head"]
        iris: set[str] = {iri, *classes} | ({graph} if graph else set())
        for ds, doc in pages:
            iris.add(ds.class_iri)
            _collect(doc, iris)
        t1 = time.perf_counter()
        labs = labels(sparql, iris, pool)
        timing["labels"] = (time.perf_counter() - t1) * 1000
        counts = {"out": int(n_out.result()[0]["n"]["value"]), "in": int(n_in.result()[0]["n"]["value"])}
    timing["total"] = (time.perf_counter() - t0) * 1000
    return {"graph": graph, "classes": classes, "pages": pages, "labels": labs, "counts": counts,
            "cacheSeconds": max((ds.cache_seconds or 0 for ds in shapes), default=0) or None,
            "queries": 3 + len(jobs) + max(1, -(-len(iris) // 200)), "timing": {k: round(v) for k, v in timing.items()}}
