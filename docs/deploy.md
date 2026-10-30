# Deploying next to RINF Atlas

RINF Describe has no indexer of its own: RINF Atlas's worker builds the describe index
from this repository's shapes, in Atlas's database. RINF Describe adds two containers
(API and web) and a one-off job that creates a read-only database role.

```
ERA ──> Atlas worker ──> Atlas database (PostGIS) <── describe-api ──> describe-web :8090
           ▲               feature, term, dataset,     (read-only role)
           │               describe_doc, describe_def,
  rinf-describe/shapes     describe_triple
```

## 1. Switch Atlas's describe index on

In RINF Atlas's `.env`, point at this repository's shapes and start Atlas with its
describe overlay ([Atlas docs/describe.md](https://github.com/Matdata-eu/rinf-atlas/blob/main/docs/describe.md)):

```sh
# rinf-atlas/.env
ATLAS_DESCRIBE_SHAPES_DIR=../rinf-describe/shapes

docker compose -f docker-compose.yml -f docker-compose.describe.yml up -d
```

The first poll builds the pages of every loaded graph from the mirror. `describe_triple`
holds a copy of every provider triple, so try it on one country first with
`ATLAS_ONLY_GRAPHS`.

## 2. Start RINF Describe

```sh
cp .env.example .env     # port, Atlas's network name, the read-only role's password
docker compose up -d --build
```

`db-role` creates the role `describe_ro` with `SELECT` on the tables the API reads, then
exits; it runs again on every `up`, which also grants tables Atlas created since. The API
joins Atlas's network (`ATLAS_NETWORK`, `rinf-atlas_default` unless Atlas's project is
named otherwise) to reach its database; the web container serves the UI and proxies
`/api/` to the API.

Open `http://<host>:8090/describe?uri=<IRI>&env=prod`.

## Without the describe index

The app also runs against an Atlas database without the describe tables, or for IRIs the
index does not hold: it then reads the triples live from ERA's SPARQL endpoint
(`DESCRIBE_LIVE=1`, the default) and shows the generic tabs only.

## Development

```sh
# a PostgreSQL to play with, and Atlas's worker for its indexer
pip install -e ../rinf-atlas/worker -r api/requirements.txt
export DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas
psql "$DATABASE_URL" -f scripts/dev-schema.sql
python scripts/dev_seed.py --atlas ../rinf-atlas --vocab   # Atlas's Luxembourg sample

(cd api && DESCRIBE_LIVE=0 uvicorn app.main:app --reload)
(cd web && npm install && npm run dev)                     # http://localhost:5173
```

`dev_seed.py` builds the pages with Atlas's own indexer from Atlas's
`tests/fixtures/lu-sample.nt.gz`. The sample lacks the kilometric posts its railway
locations point to; the script adds them with the kilometre their labels state, so km
positions show in development. `--vocab` downloads ERA's SKOS concept schemes and
ontology (tag `v3.3.4`) from ERA's GitLab for labels.

Checks: `ruff check api scripts tests`, `pytest -q tests` (shapes), `cd api && pytest -q`
(API, with `DATABASE_URL`), `cd web && npm test && npm run build`.
