from app import rdf as R

T = [
    {"s": "http://data.europa.eu/949/sol/1", "p": R.RDF_TYPE, "o": "http://data.europa.eu/949/SectionOfLine", "o_iri": True,
     "datatype": None, "lang": None},
    {"s": "http://data.europa.eu/949/sol/1", "p": R.RDFS_LABEL, "o": 'A "quoted"\nname', "o_iri": False,
     "datatype": None, "lang": "en"},
    {"s": "http://data.europa.eu/949/sol/1", "p": "http://data.europa.eu/949/lengthOfSectionOfLine", "o": "3.646",
     "o_iri": False, "datatype": R.XSD + "double", "lang": None},
]


def test_ntriples_escapes_literals():
    nt = R.ntriples(T)
    assert '"A \\"quoted\\"\\nname"@en' in nt
    assert '"3.646"^^<http://www.w3.org/2001/XMLSchema#double>' in nt
    assert nt.count(" .\n") == 3


def test_turtle_groups_by_subject_with_type_first():
    ttl = R.turtle(T, "comment")
    assert ttl.startswith("# comment\n@prefix era:")
    body = ttl.split("\n\n", 1)[1]
    # '/' is not allowed in a local name here, so the subject stays a full IRI.
    assert body.startswith("<http://data.europa.eu/949/sol/1>\n    a era:SectionOfLine ;")
    assert 'era:lengthOfSectionOfLine "3.646"^^xsd:double ;' in body
    assert body.rstrip().endswith(" .")


def test_csv_has_labels():
    csv = R.table(T, {R.RDF_TYPE: "type", "http://data.europa.eu/949/SectionOfLine": "Section of line"})
    assert csv.splitlines()[1].endswith(",type,http://data.europa.eu/949/SectionOfLine,Section of line,,")


def test_iri_check():
    assert R.valid_iri("http://data.europa.eu/949/track/1")
    assert not R.valid_iri("http://x/a b")
    assert not R.valid_iri("<http://x>")
    assert not R.valid_iri("nocolon")


def _parsed(text: str, fmt) -> set:
    import pyoxigraph as ox
    return {(str(t.subject), str(t.predicate), str(t.object)) for t in ox.parse(text.encode(), format=fmt)}


def test_rdfxml_and_jsonld_hold_the_same_triples():
    import pyoxigraph as ox
    nt = _parsed(R.ntriples(T), ox.RdfFormat.N_TRIPLES)
    assert _parsed(R.rdfxml(T), ox.RdfFormat.RDF_XML) == nt
    assert _parsed(R.jsonld(T), ox.RdfFormat.JSON_LD) == nt


def test_jsonld_is_compact():
    import json
    doc = json.loads(R.jsonld(T))
    assert doc["@type"] == "era:SectionOfLine"
    assert set(doc["@context"]) == {"era", "rdfs", "xsd"}
    assert doc["era:lengthOfSectionOfLine"] == {"@value": "3.646", "@type": "xsd:double"}
