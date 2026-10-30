"""Time class pages built live from ERA's SPARQL endpoint.

    pip install -r api/requirements.txt
    python scripts/bench_live.py --env prod

Picks --n sections of line and --n running tracks spread over ERA's data (or takes
--iri), builds each page with the API's own code (no cache), with each --batch
setting. Prints a Markdown table: median, 90th percentile and maximum in
milliseconds, and the number of SPARQL queries per page.
"""
from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from app import live, livepage, shapes  # noqa: E402

ERA = "http://data.europa.eu/949/"
ENDPOINTS = {"prod": "https://graph.data.era.europa.eu/repositories/rinf-plus",
             "uat": "https://graph.uat.data.test-era.europa.eu/repositories/rinf-plus"}
CLASSES = {"SectionOfLine": ERA + "SectionOfLine", "RunningTrack": ERA + "RunningTrack"}


def sample(endpoint: str, cls: str, n: int) -> list[str]:
    total = int(live.sparql(endpoint, f"SELECT (COUNT(*) AS ?n) WHERE {{ ?s a <{cls}> }}", 120)[0]["n"]["value"])
    step = max(1, total // n)
    out = []
    for i in range(n):
        b = live.sparql(endpoint, f"SELECT ?s WHERE {{ ?s a <{cls}> }} OFFSET {i * step} LIMIT 1", 120)
        if b:
            out.append(b[0]["s"]["value"])
    return out


def stats(ms: list[float]) -> str:
    if not ms:
        return "| – | – | – |"
    s = sorted(ms)
    p90 = s[min(len(s) - 1, round(0.9 * (len(s) - 1)))]
    return f"| {statistics.median(s):,.0f} | {p90:,.0f} | {s[-1]:,.0f} |"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", default="prod")
    ap.add_argument("--endpoint", help="SPARQL endpoint (default: ERA's for --env)")
    ap.add_argument("--n", type=int, default=10, help="resources per class")
    ap.add_argument("--iri", action="append", default=[], help="these resources instead of a sample")
    ap.add_argument("--batch", default="12", help="rows per query to try, comma separated (e.g. 4,12,100)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    endpoint = args.endpoint or ENDPOINTS[args.env]
    dset = shapes.load()

    if args.iri:
        picks = {"given": args.iri}
    else:
        picks = {name: sample(endpoint, cls, args.n) for name, cls in CLASSES.items()}
    print(f"endpoint {endpoint}; {sum(map(len, picks.values()))} resources", file=sys.stderr)

    sq = lambda q: live.sparql(endpoint, q, 120)  # noqa: E731
    sq("SELECT ?s WHERE { ?s ?p ?o } LIMIT 1")  # open the connection first
    results: list[tuple[str, str, list[float], str]] = []
    for name, iris in picks.items():
        simple = []
        for iri in iris:
            t = time.perf_counter()
            sq(f"SELECT ?p ?o WHERE {{ <{iri}> ?p ?o }} LIMIT 1000")
            simple.append((time.perf_counter() - t) * 1000)
        results.append((name, "plain triples", simple, "1"))
        for batch in (int(b) for b in args.batch.split(",")):
            ms, queries, parts = [], [], {"head": [], "rows": [], "labels": []}
            for iri in iris:
                t = time.perf_counter()
                p = livepage.page(sq, iri, dset, batch=batch, workers=args.workers)
                ms.append((time.perf_counter() - t) * 1000)
                queries.append(p["queries"])
                for k in parts:
                    parts[k].append(p["timing"][k])
                if not p["pages"]:
                    print(f"  no class page: {iri}", file=sys.stderr)
            q = f"{min(queries)}–{max(queries)}" if queries and min(queries) != max(queries) else str(queries[0] if queries else "–")
            results.append((name, f"page, {batch} rows per query", ms, q))
            for k, v in parts.items():
                results.append((name, f"  of which {k}", v, ""))
    print("\n| Class | Page | Median ms | p90 ms | Max ms | SPARQL queries |\n|---|---|---:|---:|---:|---:|")
    for name, what, ms, q in results:
        print(f"| {name} | {what} {stats(ms)} {q} |")


if __name__ == "__main__":
    main()
