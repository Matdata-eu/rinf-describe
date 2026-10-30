"""Fill a local database with describe pages, for development and CI.

Builds the describe index the way RINF Atlas's worker does (its atlas.describe
module, from a rinf-atlas checkout), from an N-Triples sample instead of ERA's
endpoint, and this repository's shapes:

    pip install -e ../rinf-atlas/worker
    psql "$DATABASE_URL" -f scripts/dev-schema.sql     # skip on a real Atlas database
    python scripts/dev_seed.py --atlas ../rinf-atlas [--vocab]

The default sample is Atlas's tests/fixtures/lu-sample.nt.gz (CFL, Luxembourg).
--vocab also downloads ERA's SKOS concept schemes and ontology from ERA's GitLab
(cached in .cache/), so concepts and properties get their labels as on the real index.
"""
from __future__ import annotations

import argparse
import gzip
import io
import os
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

import psycopg
import pyoxigraph as ox
from atlas import describe as D
from atlas.extract import update_term_labels

ROOT = Path(__file__).resolve().parent.parent
ERA = "http://data.europa.eu/949/"
RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
GITLAB = ("https://gitlab.com/api/v4/projects/era-europa-eu%2Fpublic%2Finteroperable-data-programme"
          "%2Fera-ontology%2Fera-ontology/repository")
VOCAB_GRAPH = ERA + "graph/rinf/skos"
ONTOLOGY_GRAPH = ERA + "graph/rinf/ontology"


def _fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {url}", file=sys.stderr)
        with urllib.request.urlopen(url, timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def load_vocab(store: ox.Store, tag: str) -> None:
    cache = ROOT / ".cache" / tag
    skos = _fetch(f"{GITLAB}/archive.tar.gz?sha={tag}&path=era-skos", cache / "era-skos.tar.gz")
    with tarfile.open(skos) as tf:
        for m in tf.getmembers():
            if m.isfile() and m.name.endswith(".ttl"):
                data = tf.extractfile(m).read()
                try:
                    store.load(data, format=ox.RdfFormat.TURTLE, to_graph=ox.NamedNode(VOCAB_GRAPH))
                except SyntaxError as e:
                    print(f"skipped {m.name}: {e}", file=sys.stderr)
    onto = _fetch(f"{GITLAB}/files/ontology.ttl/raw?ref={tag}", cache / "ontology.ttl")
    store.load(path=str(onto), format=ox.RdfFormat.TURTLE, to_graph=ox.NamedNode(ONTOLOGY_GRAPH))


def km_posts(store: ox.Store, graph: str) -> int:
    """The sample lacks the kilometric posts its LRS coordinates point to. Add them
    with the kilometre the coordinate labels state ("KM: 53.24" with an offset of
    240 m: post 53), so the km positions can be seen in development."""
    g = ox.NamedNode(graph)
    added = 0
    q = f"""SELECT ?c ?kp ?off ?l WHERE {{ ?c <{ERA}kmPost> ?kp ; <{ERA}offsetFromKilometricPost> ?off ;
             <{RDFS_LABEL}> ?l }}"""
    seen = set()
    for r in store.query(q, default_graph=[g]):
        kp = r["kp"]
        if kp.value in seen:
            continue
        m = re.search(r"KM:? ([0-9.]+)", r["l"].value)
        if not m:
            continue
        seen.add(kp.value)
        km = round(float(m.group(1)) - float(r["off"].value) / 1000, 3)
        store.add(ox.Quad(kp, ox.NamedNode(RDF_TYPE), ox.NamedNode(ERA + "KilometricPost"), g))
        store.add(ox.Quad(kp, ox.NamedNode(ERA + "kilometer"),
                          ox.Literal(str(km), datatype=ox.NamedNode("http://www.w3.org/2001/XMLSchema#double")), g))
        added += 1
    return added


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--atlas", type=Path, default=ROOT.parent / "rinf-atlas", help="rinf-atlas checkout")
    ap.add_argument("--data", type=Path, help="N-Triples (.nt or .nt.gz); default: Atlas's Luxembourg sample")
    ap.add_argument("--graph", default=ERA + "graph/0082", help="named graph the sample belongs to")
    ap.add_argument("--env", default="prod")
    ap.add_argument("--shapes", type=Path, default=ROOT / "shapes")
    ap.add_argument("--vocab", action="store_true", help="also load ERA's SKOS and ontology (labels)")
    ap.add_argument("--vocab-tag", default="v3.3.4")
    args = ap.parse_args()
    data = args.data or args.atlas / "tests" / "fixtures" / "lu-sample.nt.gz"
    raw = gzip.decompress(data.read_bytes()) if data.suffix == ".gz" else data.read_bytes()

    store = ox.Store()
    store.load(io.BytesIO(raw), format=ox.RdfFormat.N_TRIPLES, to_graph=ox.NamedNode(args.graph))
    print(f"added {km_posts(store, args.graph)} kilometric posts", file=sys.stderr)
    if args.vocab:
        load_vocab(store, args.vocab_tag)
    dset = D.load_describe_shapes(args.shapes)

    env, g = args.env, args.graph
    with psycopg.connect(os.environ.get("DATABASE_URL", "postgresql://atlas:atlas@localhost:5432/atlas")) as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO dataset (env, graph_iri, kind, title, provider, country, status)
                           VALUES (%s, %s, 'provider', 'Development sample', 'Development sample', NULL, 'loaded')
                           ON CONFLICT (env, graph_iri) DO NOTHING""", (env, g))
            cur.execute("INSERT INTO index_state (env, shapes_hash) VALUES (%s, 'dev') ON CONFLICT (env) DO NOTHING",
                        (env,))
            # Atlas's feature table: what the start page searches.
            cur.execute("DELETE FROM feature WHERE env=%s AND graph_iri=%s", (env, g))
            q = f"""SELECT ?s ?c (SAMPLE(?l) AS ?label) WHERE {{ ?s a ?c ; <{RDFS_LABEL}> ?l .
                     ?s a <{ERA}InfrastructureElement> FILTER(?c != <{ERA}InfrastructureElement>) }} GROUP BY ?s ?c"""
            rows = [(env, r["s"].value, re.sub(r"(?<!^)(?=[A-Z])", "-", r["c"].value[len(ERA):]).lower(),
                     r["c"].value, g, re.sub(r"\s*\(from .* until .*\)$", "", r["label"].value))
                    for r in store.query(q, default_graph=[ox.NamedNode(g)])]
            cur.executemany("""INSERT INTO feature (env, iri, class, class_iri, graph_iri, label)
                               VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""", rows)
        conn.commit()
        D.publish_defs(conn, dset)
        n = D.index_graph(conn, store, env, g, dset, triples=True)
        D.mark_done(conn, env, dset)
        # Labels of predicates and classes, as on a real index. Like the worker, leave the other
        # resources to the labels of page values, so the API's own fallbacks are exercised.
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT p FROM describe_triple WHERE env=%s UNION SELECT DISTINCT o FROM "
                        "describe_triple WHERE env=%s AND p=%s AND o_iri", (env, env, RDF_TYPE))
            iris = {r[0] for r in cur.fetchall()}
        update_term_labels(conn, store, env, iris, g)
    print(f"{n} describe pages, {len(rows)} features in {env}", file=sys.stderr)


if __name__ == "__main__":
    main()
