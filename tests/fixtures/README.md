# Test fixtures

`lu-sample.nt.gz`: a small extract (about 9,800 triples) of the CFL (Luxembourg)
provider graph `http://data.europa.eu/949/graph/0082` from ERA's RINF PROD
repository: 40 operational points, the sections of line between them, their
parts (tracks, platforms...) and the nodes they reference (net references,
geometries). The tests serve it as a SPARQL endpoint with pyoxigraph
(`tests/sample.py`). Copied from RINF Atlas's `tests/fixtures`.

Source: European Union Agency for Railways (ERA), Register of Infrastructure
(RINF), https://data-interop.era.europa.eu/. Extracted 2026-10-14.
