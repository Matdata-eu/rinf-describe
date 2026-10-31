"""The API with ERA's endpoint stood in for by the Luxembourg sample (tests/sample.py), for
the browser tests (web/e2e) and for working on the web app without network:

    python scripts/sample_api.py            # http://localhost:8000, then: cd web && npm run dev

The search box finds the sample's resources by label; the dataset explorer is left out.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "tests"), str(ROOT / "api")]
os.environ.setdefault("DESCRIBE_SHAPES", str(ROOT / "shapes"))

import sample as S  # noqa: E402
import uvicorn  # noqa: E402

from app import live, main  # noqa: E402

run = S.sparql(S.store())


def sparql(endpoint: str, query: str, timeout: float = 30.0) -> list[dict]:
    return run(query)


def search(base, env, q, classes, limit):
    vals = " ".join(f"<{c}>" for c in classes)
    rows = run(f"""SELECT ?s ?l ?c WHERE {{ VALUES ?c {{ {vals} }} ?s a ?c ; <http://www.w3.org/2000/01/rdf-schema#label> ?l
                   FILTER(CONTAINS(LCASE(STR(?l)), LCASE({json.dumps(q)}))) }} LIMIT {limit}""")
    return [{"iri": b["s"]["value"], "label": b["l"]["value"], "class": b["c"]["value"]} for b in rows]


live.sparql = sparql
live.published = lambda api, timeout=20.0: {}
main.atlas = SimpleNamespace(search=search)

if __name__ == "__main__":
    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
