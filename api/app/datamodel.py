"""The data model of a resource's class, from ERA's SHACL shapes: the "Data model" tab.

The class and its superclasses are boxes with their attributes (datatype and code list
properties); the properties whose values are of another class are associations, out to
the classes they point at and in from the classes that point at this one.
"""
from __future__ import annotations

import re

from .ontology import SKOS_CONCEPT, Ontology

XSD = "http://www.w3.org/2001/XMLSchema#"


def focus(onto: Ontology, classes: list[str]) -> str | None:
    """The most specific class of the resource that ERA's shapes say something about."""
    known = [c for c in classes if c in onto.model or any(a in onto.model for a in onto.ancestors(c))]
    return max(known, key=lambda c: (onto.depth(c), c in onto.model, c), default=None)


def _member(onto: Ontology, p: dict) -> dict:
    t = onto.terms.get(p["p"], {})
    out = {"p": p["p"], "min": p.get("min", 0), "max": p.get("max")}
    for k in ("label", "comment", "index"):
        if k in t:
            out[k] = t[k]
    cls = p.get("class")
    if not cls and not p.get("datatype") and t.get("range") in onto.classes and t["range"] != SKOS_CONCEPT:
        cls = t["range"]   # no sh:class, but the ontology's range is one of its classes
    if cls and cls != SKOS_CONCEPT:
        out["class"] = cls
    elif p.get("datatype"):
        dt = p["datatype"]
        out["type"] = dt[len(XSD):] if dt.startswith(XSD) else dt
    elif cls == SKOS_CONCEPT or t.get("range") == SKOS_CONCEPT or t.get("scheme"):
        out["type"] = "Concept"
        if t.get("scheme"):
            out["scheme"] = t["scheme"]
    elif t.get("range"):
        out["type"] = t["range"]
    else:
        out["type"] = "IRI"
    return out


def _parents_in(onto: Ontology, c: str, boxes: set[str]) -> list[str]:
    """The nearest superclasses of c among the boxes, skipping classes that are not drawn."""
    out, todo, seen = [], sorted(onto.parents.get(c, ())), set()
    while todo:
        p = todo.pop(0)
        if p in seen:
            continue
        seen.add(p)
        if p in boxes:
            out.append(p)
        else:
            todo.extend(sorted(onto.parents.get(p, ())))
    return out


def model(onto: Ontology, classes: list[str]) -> dict | None:
    root = focus(onto, classes)
    if not root:
        return None
    drawn = [root, *(a for a in onto.ancestors(root) if a in onto.model)]
    boxes = set(drawn)

    def info(c: str) -> dict:
        return {"iri": c, **{k: v for k, v in onto.classes.get(c, {}).items() if k in ("label", "comment")}}

    out_boxes = []
    for c in drawn:
        members = [_member(onto, p) for p in onto.model.get(c, [])]
        out_boxes.append({**info(c), "depth": onto.depth(c), "parents": _parents_in(onto, c, boxes),
                          "attributes": [m for m in members if "class" not in m],
                          "associations": [m for m in members if "class" in m]})
    incoming = []
    for c, props in sorted(onto.model.items()):
        if c in boxes:
            continue
        for p in props:
            m = _member(onto, p)
            if m.get("class") in boxes:
                incoming.append({**m, "source": c})
    related = {m["class"] for b in out_boxes for m in b["associations"]} | {m["source"] for m in incoming}
    return {"focus": root, "boxes": out_boxes, "incoming": incoming,
            "classes": {c: info(c) for c in sorted(related | boxes)}}


# --- What a page shows: its rows' paths walked over the model --------------------------

_TOKEN = re.compile(r"<[^>]+>|[\^/|()?*+]")
MAX_WALKS = 64


def path_walks(path: str) -> list[list[tuple[str, bool]]]:
    """A SPARQL property path as the step sequences it can take: [(predicate, inverse)...].
    An optional or repeated step is taken zero times and once."""
    toks = _TOKEN.findall(path)
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def take():
        nonlocal pos
        pos += 1
        return toks[pos - 1]

    def alt():
        out = seq()
        while peek() == "|":
            take()
            out = out + seq()
        return out[:MAX_WALKS]

    def seq():
        out = elt()
        while peek() == "/":
            take()
            nxt = elt()
            out = [a + b for a in out for b in nxt][:MAX_WALKS]
        return out

    def elt():
        inv = False
        if peek() == "^":
            take()
            inv = True
        t = take()
        if t == "(":
            inner = alt()
            take()   # ")"
        else:
            inner = [[(t[1:-1], False)]]
        if inv:
            inner = [[(p, not i) for p, i in reversed(w)] for w in inner]
        if peek() in ("?", "*"):
            take()
            inner = [[], *inner]
        elif peek() == "+":
            take()
        return inner

    try:
        return alt() if toks else []
    except IndexError:
        return []


def _own(onto: Ontology, c: str, p: str) -> dict | None:
    """The SHACL property p of class c or one of its superclasses."""
    for k in (c, *onto.ancestors(c)):
        for prop in onto.model.get(k, ()):
            if prop["p"] == p:
                return prop
    return None


class _Walk:
    """Nodes (classes, with the members the page reads) and edges collected over the walks."""

    def __init__(self, onto: Ontology, root: str):
        self.onto, self.root = onto, root
        self.nodes: dict[str, dict] = {root: {"iri": root, "hop": 0, "side": 0, "members": {}}}
        self.edges: dict[tuple, dict] = {}

    def node(self, c: str, hop: int, side: int, untyped: bool = False, narrowed: str | None = None) -> dict:
        n = self.nodes.get(c)
        if n is None:
            n = self.nodes[c] = {"iri": c, "hop": hop, "side": side, "members": {}}
            if untyped:
                n["untyped"] = True
            if narrowed:
                n["narrowedFrom"] = narrowed
        elif hop < n["hop"]:
            n["hop"], n["side"] = hop, side
        return n

    def member(self, c: str, p: str, prop: dict | None, row: str):
        m = self.nodes[c]["members"].get(p)
        if m is None:
            m = self.nodes[c]["members"][p] = _member(self.onto, prop) if prop else {"p": p, "min": 0, "max": None, "type": "?", "missing": True}
            m = self.nodes[c]["members"][p]
            m["rows"] = []
        if row not in m["rows"]:
            m["rows"].append(row)

    def edge(self, a: str, b: str, p: str, prop: dict | None, row: str, missing=False):
        if a == b:
            return
        e = self.edges.get((a, b, p))
        if e is None:
            base = _member(self.onto, prop) if prop else {"p": p, "min": 0, "max": None}
            e = self.edges[(a, b, p)] = {**{k: v for k, v in base.items() if k != "class"}, "from": a, "to": b, "rows": []}
            if missing:
                e["missing"] = True
        if row not in e["rows"]:
            e["rows"].append(row)

    def resolves(self, c: str, p: str) -> bool:
        return p == RDF_TYPE or _own(self.onto, c, p) is not None or (c in self.onto.model and any(
            x["p"] == p for d in self.onto.descendants(c) for x in self.onto.model.get(d, ())))

    def walk(self, c: str, steps: list[tuple[str, bool]], row: str, hop: int = 0, side: int = 0, pending=None):
        """Follow the steps from class c. `pending` is the edge that led here, committed once
        the next step shows whether c stands or narrows to one of its subclasses."""
        onto = self.onto

        def commit(to: str):
            if pending:
                a, b_from, p, prop, missing = pending
                n = self.node(to, hop, side, narrowed=c if to != c else None)
                (self.edge(a, to, p, prop, row, missing) if b_from else self.edge(to, a, p, prop, row, missing))
                return n
            return None

        if not steps:
            commit(c)
            return
        p, inv = steps[0]
        rest = steps[1:]
        if p.startswith("@"):   # rd:class: the linked resources are of this subclass
            k = p[1:]
            self.walk(k if k in onto.descendants(c) else c, rest, row, hop, side, pending)
            return
        nside = side or (-1 if inv else 1)
        if p == RDF_TYPE:
            commit(c)
            return
        if not inv:
            # Where p is defined: on c or a superclass, else on some of c's subclasses.
            prop = _own(onto, c, p)
            # A subclass only stands in for a class ERA's shapes describe themselves (a part of an
            # infrastructure element that has a track id is a track).
            owners = [(c, prop)] if prop else [] if c not in onto.model else [
                (d, _own(onto, d, p)) for d in sorted(onto.descendants(c)) if any(x["p"] == p for x in onto.model.get(d, ()))]
            if not owners:
                commit(c)
                if rest:   # a hop ERA's shapes do not type: the walk stops in an untyped box
                    u = f"untyped:{p}"
                    self.node(u, hop + 1, nside, untyped=True)
                    self.edge(c, u, p, None, row, missing=True)
                else:
                    self.member(c, p, None, row)
                return
            for o, prop in owners:
                commit(o)
                m = _member(onto, prop)
                if "class" in m and (rest or True):
                    if rest:
                        self.walk(m["class"], rest, row, hop + 1, nside, (o, True, p, prop, False))
                    else:
                        self.node(m["class"], hop + 1, nside)
                        self.edge(o, m["class"], p, prop, row)
                elif rest:
                    u = f"untyped:{p}"
                    self.node(u, hop + 1, nside, untyped=True)
                    self.edge(o, u, p, prop, row)
                else:
                    self.member(o, p, prop, row)
            return
        # Inverse: the classes whose property p points at c (or a superclass or subclass of c).
        near = {c, *onto.ancestors(c), *onto.descendants(c)}
        sources = [(s, prop) for s, props in sorted(onto.model.items()) for prop in props
                   if prop["p"] == p and _member(onto, prop).get("class") in near]
        # Of several classes pointing here, those the next step goes on from.
        if rest and len(sources) > 1 and not rest[0][1]:
            nxt = rest[0][0]
            if nxt.startswith("@"):   # rd:class names which of them
                fit = [(s, prop) for s, prop in sources if s == nxt[1:] or nxt[1:] in onto.descendants(s)]
            else:
                fit = [(s, prop) for s, prop in sources if self.resolves(s, nxt)]
            sources = fit or sources
        commit(c)
        if not sources:
            u = f"untyped:^{p}"
            self.node(u, hop + 1, nside, untyped=True)
            self.edge(u, c, p, None, row, missing=True)
            return
        for s, prop in sources:
            if rest:
                self.walk(s, rest, row, hop + 1, nside, (c, False, p, prop, False))
            else:
                self.node(s, hop + 1, nside)
                self.edge(s, c, p, prop, row)


RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"


def page_model(onto: Ontology, root: str, rows, groups: dict) -> dict:
    """The classes and properties the rows of a page read, from its class outwards: every
    row's path (rd:over, sh:path, its columns and rd: paths) walked over ERA's model."""
    w = _Walk(onto, root)

    def name(row, col=None) -> str:
        g = groups.get(row.group)
        parts = [g.label if g else None, row.name or row.key.replace("-", " ").capitalize(), (col.name or col.key) if col else None]
        return " › ".join(x for x in parts if x)

    def walk(paths: list, label: str):
        seqs = [[]]
        for p in paths:
            if isinstance(p, tuple):   # ("@", class): narrow to rd:class here
                seqs = [s + [("@" + p[1], False)] for s in seqs]
            elif p:
                seqs = [a + b for a in seqs for b in path_walks(p)][:MAX_WALKS]
        for s in seqs:
            if s:
                w.walk(root, s, label)

    for row in rows:
        if row.viewer in WHOLE:
            continue
        cls = ("@", row.filter_class) if row.filter_class else None
        if row.columns:
            for col in row.columns:
                ccls = ("@", col.filter_class) if col.filter_class else None
                walk([row.path, cls, col.over, ccls, col.path], name(row, col))
        elif row.over:
            walk([row.over, cls, row.path], name(row))
        elif row.path:
            walk([row.path, cls], name(row))
        for pname, ppath in row.params.items():
            walk([ppath], name(row))
    nodes = []
    for n in w.nodes.values():
        nodes.append({**{k: v for k, v in n.items() if k != "members"}, "members": sorted(n["members"].values(), key=lambda m: m["p"]),
                      **{k: v for k, v in onto.classes.get(n["iri"], {}).items() if k in ("label", "comment")}})
    return {"nodes": nodes, "edges": list(w.edges.values())}


WHOLE = {"https://rinf-describe.matdata.eu/ns#ParameterIndexViewer"}
