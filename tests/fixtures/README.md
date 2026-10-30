# Test fixtures

`lu-sample.nt.gz`: a small extract (about 9,800 triples) of the CFL (Luxembourg)
provider graph `http://data.europa.eu/949/graph/0082` from ERA's RINF PROD
repository: 40 operational points, the sections of line between them, their
parts (tracks, platforms...) and the nodes they reference (net references,
geometries). The tests serve it as a SPARQL endpoint with pyoxigraph
(`tests/sample.py`). Copied from RINF Atlas's `tests/fixtures`.

Source: European Union Agency for Railways (ERA), Register of Infrastructure
(RINF), https://data-interop.era.europa.eu/. Extracted 2026-10-14.

`era-ontology.nt.gz`: the labels, definitions (`rdfs:comment`), RINF indexes, units
and `rdfs:subClassOf` statements of ERA's ontology graph
`http://data.europa.eu/949/graph/rinf/ontology` on the same endpoint (about 2,400
triples), as the API reads them (`api/app/ontology.py`). Extracted 2026-10-30.

`era-shacl.nt.gz`: ERA's SHACL shapes graph `http://data.europa.eu/949/graph/rinf/shacl`
on the same endpoint, reduced to what the data model tab reads (`api/app/ontology.py`,
`read_model`): each node shape's `sh:targetClass` and `sh:property`, and each property
shape's path, datatype, class, counts and severity (about 2,000 triples). Extracted 2026-10-30.
