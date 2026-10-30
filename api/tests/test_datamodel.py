"""The data model tab: ERA's SHACL properties of a class and its superclasses as UML boxes."""
from app.datamodel import focus, model
from app.ontology import SKOS_CONCEPT, Ontology

ERA = "http://data.europa.eu/949/"
XSD = "http://www.w3.org/2001/XMLSchema#"


def onto() -> Ontology:
    o = Ontology()
    o.parents = {ERA + "RunningTrack": {ERA + "Track"}, ERA + "Track": {ERA + "InfrastructureElement"},
                 ERA + "Siding": {ERA + "Track"}}
    o.classes = {c: {"label": c[len(ERA):]} for c in
                 (ERA + "RunningTrack", ERA + "Track", ERA + "InfrastructureElement", ERA + "OrganisationRole",
                  ERA + "SectionOfLine", ERA + "Document")}
    o.terms = {ERA + "lineCategory": {"label": "Category of line", "range": SKOS_CONCEPT,
                                      "scheme": ERA + "concepts/line-category/LineCategories"},
               ERA + "infrastructureManager": {"range": ERA + "OrganisationRole"}}
    o.model = {
        ERA + "RunningTrack": [{"p": ERA + "lineCategory"}, {"p": ERA + "trackId", "datatype": XSD + "string", "min": 1, "max": 1},
                               {"p": ERA + "doc", "class": ERA + "Document"}],
        ERA + "InfrastructureElement": [{"p": ERA + "infrastructureManager", "min": 1}],
        ERA + "SectionOfLine": [{"p": ERA + "track", "class": ERA + "RunningTrack"}],
    }
    return o


def test_the_most_specific_class_with_shapes_is_the_focus():
    o = onto()
    assert focus(o, [ERA + "InfrastructureElement", ERA + "RunningTrack"]) == ERA + "RunningTrack"
    assert focus(o, [ERA + "Siding"]) == ERA + "Siding"   # no shape of its own, but its superclass has one
    assert focus(o, [ERA + "Unknown"]) is None


def test_boxes_attributes_and_associations():
    m = model(onto(), [ERA + "RunningTrack"])
    boxes = {b["iri"]: b for b in m["boxes"]}
    # Track has no SHACL properties, so it is not drawn and RunningTrack's superclass is InfrastructureElement.
    assert list(boxes) == [ERA + "RunningTrack", ERA + "InfrastructureElement"]
    assert boxes[ERA + "RunningTrack"]["parents"] == [ERA + "InfrastructureElement"]
    attrs = {a["p"][len(ERA):]: a for a in boxes[ERA + "RunningTrack"]["attributes"]}
    assert attrs["lineCategory"]["type"] == "Concept" and attrs["lineCategory"]["scheme"].endswith("LineCategories")
    assert attrs["trackId"] == {"p": ERA + "trackId", "min": 1, "max": 1, "type": "string"}
    assert [a["class"] for a in boxes[ERA + "RunningTrack"]["associations"]] == [ERA + "Document"]
    # No sh:class, but the ontology's range is a class: an association.
    im = boxes[ERA + "InfrastructureElement"]["associations"][0]
    assert im["class"] == ERA + "OrganisationRole" and im["min"] == 1 and im["max"] is None
    assert [(x["source"], x["p"]) for x in m["incoming"]] == [(ERA + "SectionOfLine", ERA + "track")]
    assert set(m["classes"]) >= {ERA + "Document", ERA + "OrganisationRole", ERA + "SectionOfLine"}
