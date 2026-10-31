# Deploying

RINF Describe needs no database and no other service of its own: two containers (API and
web) and outbound HTTPS to ERA's SPARQL endpoint and dataset explorer, and to RINF
Atlas's public API for the search box.

```
ERA SPARQL + dataset explorer ──> describe-api ──> describe-web :8090
RINF Atlas /api/search ─────────┘
```

## Start it

```sh
cp .env.example .env     # port, environments, the RINF Atlas instance for search
docker compose pull      # the published images (or: docker compose up -d --build)
docker compose up -d
```

Open `http://<host>:8090/describe?uri=<IRI>&env=prod`.

The images are published to GitHub Container Registry by
`.github/workflows/docker-publish.yml`: `ghcr.io/matdata-eu/rinf-describe-api` and
`-web`, tagged `latest` and `sha-…` on every push to `main`, and `X.Y.Z` and `X.Y` for a
version tag `vX.Y.Z`. `DESCRIBE_VERSION` in `.env` picks the tag. To release, add the
release to `web/src/whats-new.json`, set the version in `web/package.json`, and push a tag:

```sh
git tag v1.2.0 && git push origin v1.2.0
```

## Settings

| Variable | Default | What |
|---|---|---|
| `DESCRIBE_ENVS` | `prod=PROD,uat=UAT` | Environments in menu order; the first is the default |
| `DESCRIBE_SPARQL_<ENV>` | ERA's endpoints | Another SPARQL endpoint for an environment |
| `DESCRIBE_DATASETS_<ENV>` | ERA's dataset explorers | Another dataset explorer API (publisher and publication date) |
| `DESCRIBE_LIVE_BATCH` | `12` | Shape rows per SPARQL query |
| `DESCRIBE_LIVE_WORKERS` | `8` | SPARQL queries in flight per page |
| `DESCRIBE_ATLAS_URL` | `https://rinf-atlas.matdata.eu` | RINF Atlas for the search box and the "Open in RINF Atlas" button; empty: IRIs only, no button |
| `DESCRIBE_PUBLIC_URL` | empty | Public address: canonical links, sitemaps, search engines ([seo.md](seo.md)) |

Pages are kept in the API for ten minutes, the start-page examples and the sitemaps for a
day, the dataset explorer's answer for an hour. `scripts/bench_live.py` times pages
against ERA's endpoint for a few batch settings.

## A public instance

Set `DESCRIBE_PUBLIC_URL` to the instance's HTTPS address so search engines may index it
and get its sitemaps ([seo.md](seo.md)), and add a privacy statement in `site/`
([privacy.md](privacy.md)).

## Upgrading from 1.1 or earlier

Up to 1.1, the API read a describe index from RINF Atlas's database. It no longer does:

1. Remove `ATLAS_NETWORK`, `ATLAS_DB_HOST`, `ATLAS_DB_NAME`, `ATLAS_DB_USER`,
   `POSTGRES_PASSWORD`, `DESCRIBE_DB_PASSWORD` and `DESCRIBE_LIVE` from `.env`.
2. `docker compose pull && docker compose up -d --remove-orphans` (drops the `db-role`
   job).
3. Optionally, in Atlas's database: `DROP OWNED BY describe_ro; DROP ROLE describe_ro;`.
   Atlas can stop building the index: start it without `docker-compose.describe.yml`.

## Development

```sh
pip install -r api/requirements.txt
(cd api && uvicorn app.main:app --reload)            # against ERA's endpoints
(cd web && npm install && npm run dev)               # http://localhost:5173
```

Checks: `ruff check api scripts tests`, `pytest -q tests` (shapes), `cd api && pytest -q`
(API), `cd web && npm test && npm run build`, and `cd web && npm run e2e` (the built app in
Chromium; `npx playwright install chromium` once). The tests serve the Luxembourg sample in
`tests/fixtures/` as a SPARQL endpoint with pyoxigraph, so they need no network.
`python scripts/sample_api.py` runs the API on that sample, for working on the web app
offline.
