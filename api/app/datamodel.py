"""The data model of a resource's class, from ERA's SHACL shapes: the "Data model" tab.

The class and its superclasses are boxes with their attributes (datatype and code list
properties); the properties whose values are of another class are associations, out to
the classes they point at and in from the classes that point at this one.
"""
from __future__ import annotations

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
