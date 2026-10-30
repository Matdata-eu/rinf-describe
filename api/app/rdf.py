"""RDF terms and serialisations: Turtle, N-Triples, RDF/XML, JSON-LD and CSV for the exports."""
from __future__ import annotations

import csv
import io
import json
import re

import pyoxigraph as ox

XSD = "http://www.w3.org/2001/XMLSchema#"
RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
SKOS_PREF = "http://www.w3.org/2004/02/skos/core#prefLabel"
PREFIXES = {
    "era": "http://data.europa.eu/949/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "xsd": XSD,
    "owl": "http://www.w3.org/2002/07/owl#",
    "skos": "http://www.w3.org/2004/02/skos/core#",
    "dcterms": "http://purl.org/dc/terms/",
    "gsp": "http://www.opengis.net/ont/geosparql#",
    "time": "http://www.w3.org/2006/time#",
    "country": "http://publications.europa.eu/resource/authority/country/",
}
# Longest namespace first, so era: never wins over a longer, more specific prefix.
_BY_LENGTH = sorted(PREFIXES.items(), key=lambda kv: -len(kv[1]))
_LOCAL = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*$")
_ESCAPES = {"\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t"}
_ESC_RE = re.compile(r'[\\"\n\r\t]')
_BAD_IRI = re.compile(r'[<>"{}|^`\\\s]')


def valid_iri(value: str) -> bool:
    return bool(value) and len(value) < 2000 and ":" in value and not _BAD_IRI.search(value)


def _iri_nt(value: str) -> str:
    return "<" + value + ">"


def _curie(value: str) -> str:
    """prefix:local where a prefix fits, else the IRI unchanged."""
    for p, ns in _BY_LENGTH:
        if value.startswith(ns) and _LOCAL.match(value[len(ns):]):
            return f"{p}:{value[len(ns):]}"
    return value


def _iri_ttl(value: str) -> str:
    c = _curie(value)
    return c if c != value else _iri_nt(value)


def _literal(value: str, datatype: str | None, lang: str | None, iri=_iri_nt) -> str:
    s = '"' + _ESC_RE.sub(lambda m: _ESCAPES[m.group()], value) + '"'
    if lang:
        return f"{s}@{lang}"
    if datatype and datatype != XSD + "string":
        return f"{s}^^{iri(datatype)}"
    return s


def _obj(t: dict, iri) -> str:
    if t["o_iri"]:
        return iri(t["o"])
    return _literal(t["o"], t.get("datatype"), t.get("lang"), iri)


def ntriples(triples: list[dict]) -> str:
    return "".join(f"{_iri_nt(t['s'])} {_iri_nt(t['p'])} {_obj(t, _iri_nt)} .\n" for t in triples)


def turtle(triples: list[dict], comment: str = "") -> str:
    """Turtle grouped by subject, rdf:type first, with the usual RINF prefixes."""
    head = [f"# {line}" for line in comment.splitlines()]
    head += [f"@prefix {p}: <{ns}> ." for p, ns in PREFIXES.items()]
    by_s: dict[str, dict[str, list[str]]] = {}
    for t in triples:
        objs = by_s.setdefault(t["s"], {}).setdefault(t["p"], [])
        o = _obj(t, _iri_ttl)
        if o not in objs:
            objs.append(o)
    blocks = []
    for s, preds in by_s.items():
        order = sorted(preds, key=lambda p: (p != RDF_TYPE, p))
        lines = [f"    {'a' if p == RDF_TYPE else _iri_ttl(p)} {', '.join(preds[p])}" for p in order]
        blocks.append(_iri_ttl(s) + "\n" + " ;\n".join(lines) + " .\n")
    return "\n".join(head) + "\n\n" + "\n".join(blocks)


def _ox_term(t: dict):
    if t["o_iri"]:
        return ox.NamedNode(t["o"])
    if t.get("lang"):
        return ox.Literal(t["o"], language=t["lang"])
    return ox.Literal(t["o"], datatype=ox.NamedNode(t["datatype"]) if t.get("datatype") else None)


def rdfxml(triples: list[dict]) -> str:
    """RDF/XML with the usual RINF prefixes as XML namespaces."""
    quads = [ox.Triple(ox.NamedNode(t["s"]), ox.NamedNode(t["p"]), _ox_term(t)) for t in triples]
    return ox.serialize(quads, format=ox.RdfFormat.RDF_XML, prefixes=PREFIXES).decode()


def jsonld(triples: list[dict]) -> str:
    """Compact JSON-LD: one node per subject, compact IRIs from a context with the prefixes it uses."""
    nodes: dict[str, dict] = {}
    for t in triples:
        node = nodes.setdefault(t["s"], {"@id": _curie(t["s"])})
        if t["p"] == RDF_TYPE and t["o_iri"]:
            key, value = "@type", _curie(t["o"])
        else:
            key = _curie(t["p"])
            if t["o_iri"]:
                value = {"@id": _curie(t["o"])}
            elif t.get("lang"):
                value = {"@value": t["o"], "@language": t["lang"]}
            elif t.get("datatype") and t["datatype"] != XSD + "string":
                value = {"@value": t["o"], "@type": _curie(t["datatype"])}
            else:
                value = t["o"]
        vals = node.setdefault(key, [])
        if value not in vals:
            vals.append(value)
    graph = [{k: n[k][0] if isinstance(n[k], list) and len(n[k]) == 1 else n[k]
              for k in sorted(n, key=lambda k: (k != "@id", k != "@type", k))} for n in nodes.values()]
    used = {c.split(":", 1)[0] for c in _strings(graph)}
    doc: dict = {"@context": {p: ns for p, ns in PREFIXES.items() if p in used}}
    if len(graph) == 1:
        doc.update(graph[0])
    else:
        doc["@graph"] = graph
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def _strings(x):
    """The keys and the @id/@type values of a JSON-LD tree: where compact IRIs can be."""
    if isinstance(x, list):
        for v in x:
            yield from _strings(v)
    elif isinstance(x, dict):
        for k, v in x.items():
            yield k
            if k in ("@id", "@type"):
                yield from ([v] if isinstance(v, str) else v)
            else:
                yield from _strings(v)


def table(triples: list[dict], labels: dict[str, str]) -> str:
    """CSV with one row per triple and the labels next to the IRIs."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["subject", "predicate", "predicate_label", "object", "object_label", "datatype", "lang"])
    for t in triples:
        w.writerow([t["s"], t["p"], labels.get(t["p"], ""), t["o"],
                    labels.get(t["o"], "") if t["o_iri"] else "", t.get("datatype") or "", t.get("lang") or ""])
    return buf.getvalue()
