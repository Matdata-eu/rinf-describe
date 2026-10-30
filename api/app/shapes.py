"""The describe shapes (shapes/*.ttl) compiled to class pages.

A row has a SPARQL path, optionally rd:over and rd:aggregate, sh:node columns, and rd:
paths and settings for its viewer. livepage.py evaluates them on a resource.
"""
from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import pyoxigraph as ox

RD = "https://rinf-describe.matdata.eu/ns#"
SH = "http://www.w3.org/ns/shacl#"
DASH = "http://datashapes.org/dash#"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
AGGREGATES = ("range", "distinct-count", "count")
_KNOWN_RD = {RD + k for k in ("key", "tab", "over", "aggregate", "unit", "format", "enabled")}
# Viewers that read the resource as a whole rather than a path of it.
WHOLE_VIEWERS = {RD + "ParameterIndexViewer"}
_PREFIXES = {
    "era": "http://data.europa.eu/949/", "rdf": RDF, "rdfs": RDFS, "sh": SH,
    "skos": "http://www.w3.org/2004/02/skos/core#", "gsp": "http://www.opengis.net/ont/geosparql#",
    "time": "http://www.w3.org/2006/time#", "dcterms": "http://purl.org/dc/terms/",
}

SHAPES_DIR = Path(os.environ.get("DESCRIBE_SHAPES", Path(__file__).resolve().parents[2] / "shapes"))


class ShapeError(ValueError):
    pass


@dataclass
class Group:
    iri: str
    label: str
    order: int = 100
    tab: str = "overview"


@dataclass
class Row:
    key: str
    name: str | None
    path: str | None
    group: str | None = None
    order: int = 100
    viewer: str | None = None
    roles: list[str] = field(default_factory=list)
    over: str | None = None
    aggregate: str | None = None
    unit: str | None = None
    format: str | None = None
    params: dict[str, str] = field(default_factory=dict)
    settings: dict[str, str] = field(default_factory=dict)
    columns: list[Row] = field(default_factory=list)
    deactivated: bool = False


@dataclass
class DocShape:
    iri: str
    class_iri: str
    label: str
    rows: list[Row] = field(default_factory=list)

    def definition(self, groups: dict[str, Group]) -> dict:
        """The compiled layout the web app draws the page with."""
        used = {r.group for r in self.rows if r.group}
        return {"label": self.label, "rows": [asdict(r) for r in self.rows],
                "groups": [asdict(groups[g]) for g in sorted(used, key=lambda g: (groups[g].order, g))]}


@dataclass
class DescribeSet:
    shapes: list[DocShape]
    groups: dict[str, Group]

    def for_classes(self, classes) -> list[DocShape]:
        cs = set(classes)
        return [s for s in self.shapes if s.class_iri in cs]

    def for_resource(self, classes, ancestors=lambda c: [], depth=lambda c: 0) -> list[DocShape]:
        """The page of a resource: every shape whose class it has, asserted or as a superclass
        of one it has, merged into one. Rows merge by key, the more specific class winning; a
        row with sh:deactivated true hides the row of that key from the less specific ones."""
        cs = set(classes)
        for c in classes:
            cs.update(ancestors(c))
        found = sorted(self.for_classes(cs), key=lambda s: (-depth(s.class_iri), s.iri))
        if not found:
            return []
        top = found[0]
        rows: dict[str, Row] = {}
        for ds in found:
            for r in ds.rows:
                rows.setdefault(r.key, r)
        merged = [r for r in rows.values() if not r.deactivated]
        merged.sort(key=lambda x: (x.order, x.key))
        return [DocShape(iri=top.iri, class_iri=top.class_iri, label=top.label, rows=merged)]


def _iri(t) -> str | None:
    return t.value if isinstance(t, ox.NamedNode) else None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "row"


def _local(iri: str) -> str:
    return re.split(r"[#/]", iri.rstrip("/#"))[-1]


def compact_path(path: str) -> str:
    def iri(m):
        v = m.group(1)
        for p, ns in _PREFIXES.items():
            if v.startswith(ns) and re.fullmatch(r"[A-Za-z_][\w\-]*", v[len(ns):]):
                return f"{p}:{v[len(ns):]}"
        return m.group(0)
    out = re.sub(r"<([^>]+)>", iri, path)
    while out.startswith("(") and out.endswith(")") and out.count("(") == 1:
        out = out[1:-1]
    return out


class _Reader:
    def __init__(self, store: ox.Store):
        self.s = store

    def objs(self, subj, pred: str) -> list:
        return [q.object for q in self.s.quads_for_pattern(subj, ox.NamedNode(pred), None)]

    def one(self, subj, pred: str):
        o = self.objs(subj, pred)
        return o[0] if o else None

    def lit(self, subj, pred: str, default=None):
        o = self.one(subj, pred)
        return o.value if isinstance(o, ox.Literal) else default

    def label(self, subj, *preds: str) -> str | None:
        for p in preds:
            vals = [o for o in self.objs(subj, p) if isinstance(o, ox.Literal)]
            for o in vals:
                if o.language in (None, "en"):
                    return o.value
            if vals:
                return vals[0].value
        return None

    def rdf_list(self, node) -> list:
        out = []
        while node is not None and not (isinstance(node, ox.NamedNode) and node.value == RDF + "nil"):
            first = self.one(node, RDF + "first")
            if first is None:
                raise ShapeError("malformed RDF list in shapes")
            out.append(first)
            node = self.one(node, RDF + "rest")
        return out

    def _structured(self, node) -> bool:
        """A named path node (shape:own-or-subset in common.ttl) rather than a predicate."""
        return any(self.one(node, p) is not None for p in (
            RDF + "first", SH + "inversePath", SH + "zeroOrMorePath", SH + "oneOrMorePath",
            SH + "zeroOrOnePath", SH + "alternativePath"))

    def path(self, node) -> str:
        """SHACL path node -> SPARQL property path."""
        if isinstance(node, ox.NamedNode) and not self._structured(node):
            return f"<{node.value}>"
        if isinstance(node, ox.Literal):
            raise ShapeError(f"literal {node.value!r} used as a path")
        if self.one(node, RDF + "first") is not None:
            return "(" + "/".join(self.path(n) for n in self.rdf_list(node)) + ")"
        for pred, fmt in ((SH + "inversePath", "^{}"), (SH + "zeroOrMorePath", "{}*"),
                          (SH + "oneOrMorePath", "{}+"), (SH + "zeroOrOnePath", "{}?")):
            inner = self.one(node, pred)
            if inner is not None:
                p = self.path(inner)
                if not p.startswith("(") and not p.startswith("<"):
                    p = f"({p})"
                return fmt.format(p)
        alt = self.one(node, SH + "alternativePath")
        if alt is not None:
            return "(" + "|".join(self.path(n) for n in self.rdf_list(alt)) + ")"
        raise ShapeError("unsupported SHACL path")


def _row(r: _Reader, prop, where: str, nested: bool = False) -> Row | None:
    if r.lit(prop, RD + "enabled", "true") == "false":
        return None
    if r.lit(prop, SH + "deactivated", "false") == "true":
        key = r.lit(prop, RD + "key")
        if not key:
            raise ShapeError(f"{where}: a deactivated property needs rd:key (the row it hides)")
        return Row(key=key, name=None, path=None, deactivated=True)
    pnode = r.one(prop, SH + "path")
    name = r.label(prop, SH + "name", RDFS + "label")
    path = r.path(pnode) if pnode is not None else None
    key = r.lit(prop, RD + "key") or (_slug(name) if name else _slug(compact_path(path)) if path else None)
    if not key:
        raise ShapeError(f"{where}: a property without sh:path needs sh:name or rd:key")
    row = Row(key=key, name=name, path=path,
              group=_iri(r.one(prop, SH + "group")),
              order=int(float(r.lit(prop, SH + "order", "100"))),
              viewer=_iri(r.one(prop, DASH + "viewer")),
              roles=sorted(i for i in (_iri(o) for o in r.objs(prop, DASH + "propertyRole")) if i),
              aggregate=r.lit(prop, RD + "aggregate"),
              unit=r.lit(prop, RD + "unit"),
              format=r.lit(prop, RD + "format"))
    over = r.one(prop, RD + "over")
    if over is not None:
        row.over = r.path(over)
    if row.aggregate and row.aggregate not in AGGREGATES:
        raise ShapeError(f"{where}.{key}: rd:aggregate must be one of {', '.join(AGGREGATES)}")
    if row.over and not row.path:
        raise ShapeError(f"{where}.{key}: rd:over needs a sh:path to evaluate on each child")
    if row.aggregate and not row.over:
        raise ShapeError(f"{where}.{key}: rd:aggregate needs rd:over")
    # rd:x given more than once (rd:facility on rd:FacilitiesViewer): x, x.1, x.2... in a
    # stable order.
    found: dict[str, list[tuple[bool, str]]] = {}
    for q in r.s.quads_for_pattern(prop, None, None):
        p = q.predicate.value
        if not p.startswith(RD) or p in _KNOWN_RD:
            continue
        lit = isinstance(q.object, ox.Literal)
        found.setdefault(p[len(RD):], []).append((lit, q.object.value if lit else r.path(q.object)))
    for name, vals in sorted(found.items()):
        for n, (lit, v) in enumerate(sorted(vals)):
            (row.settings if lit else row.params)[name if n == 0 else f"{name}.{n}"] = v
    if not row.path and not row.params and row.viewer not in WHOLE_VIEWERS:
        raise ShapeError(f"{where}.{key}: needs sh:path or rd: paths for its viewer")
    node = r.one(prop, SH + "node")
    if node is not None:
        if nested:
            raise ShapeError(f"{where}.{key}: sh:node inside sh:node is not supported")
        if row.over or not row.path:
            raise ShapeError(f"{where}.{key}: sh:node needs a plain sh:path to the linked resources")
        for col in r.objs(node, SH + "property"):
            c = _row(r, col, f"{where}.{key}", nested=True)
            if c is None or c.deactivated:
                continue
            if not c.path or c.over or c.params:
                raise ShapeError(f"{where}.{key}.{c.key}: a column needs a plain sh:path")
            row.columns.append(c)
        _unique([c.key for c in row.columns], f"{where}.{key}")
        row.columns.sort(key=lambda c: (c.order, c.key))
    return row


def _unique(keys: list[str], where: str) -> None:
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise ShapeError(f"{where}: duplicate row key(s) {', '.join(dup)}; set rd:key")


def load(shapes_dir: Path = SHAPES_DIR) -> DescribeSet:
    st = ox.Store()
    files = sorted(Path(shapes_dir).glob("**/*.ttl"))
    if not files:
        raise ShapeError(f"no describe shapes found in {shapes_dir}")
    for f in files:
        try:
            st.load(path=str(f), format=ox.RdfFormat.TURTLE)
        except SyntaxError as e:
            raise ShapeError(f"{f.name}: {e}") from e
    r = _Reader(st)
    groups: dict[str, Group] = {}
    for q in st.quads_for_pattern(None, ox.NamedNode(RDF + "type"), ox.NamedNode(SH + "PropertyGroup")):
        g = q.subject.value
        groups[g] = Group(iri=g, label=r.label(q.subject, RDFS + "label", SH + "name") or _local(g),
                          order=int(float(r.lit(q.subject, SH + "order", "100"))),
                          tab=r.lit(q.subject, RD + "tab", "overview"))
    shapes: list[DocShape] = []
    for q in st.quads_for_pattern(None, ox.NamedNode(SH + "targetClass"), None):
        node = q.subject
        if not isinstance(node, ox.NamedNode) or r.lit(node, RD + "enabled", "true") == "false":
            continue
        where = _local(node.value)
        ds = DocShape(iri=node.value, class_iri=_iri(q.object),
                      label=r.label(node, RDFS + "label", SH + "name") or where)
        for prop in r.objs(node, SH + "property"):
            row = _row(r, prop, where)
            if row is None:
                continue
            if row.group and row.group not in groups:
                raise ShapeError(f"{where}.{row.key}: sh:group {row.group} is not a sh:PropertyGroup")
            ds.rows.append(row)
        _unique([x.key for x in ds.rows], where)
        ds.rows.sort(key=lambda x: (x.order, x.key))
        shapes.append(ds)
    if not shapes:
        raise ShapeError(f"no node shape with sh:targetClass in {shapes_dir}")
    shapes.sort(key=lambda s: s.iri)
    return DescribeSet(shapes=shapes, groups=groups)
