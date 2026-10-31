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
| `DESCRIBE_MAX_QUERIES` | `16` | SPARQL queries in flight for the whole API; more wait up to 20 s, then get 503 |
| `DESCRIBE_CACHE_ENTRIES` | `2000` | Answers kept in the API's memory |
| `DESCRIBE_RATE_LIMIT` | `10` | Requests per second per client to `/api/` and the sitemaps (bursts of four times that); `off`: no limit. Web container |
| `DESCRIBE_TRUSTED_PROXIES` | empty | Reverse proxies in front of the web container (addresses or CIDR ranges, comma separated), whose `X-Forwarded-For` names the client. Web container |
| `DESCRIBE_ATLAS_URL` | `https://rinf-atlas.matdata.eu` | RINF Atlas for the search box and the "Open in RINF Atlas" button; empty: IRIs only, no button |
| `DESCRIBE_PUBLIC_URL` | empty | Public address: canonical links, sitemaps, search engines ([seo.md](seo.md)) |

Pages are kept in the API for ten minutes, the start-page examples and the sitemaps for a
day, the dataset explorer's answer for an hour. `scripts/bench_live.py` times pages
against ERA's endpoint for a few batch settings.

## Load on ERA's endpoint

Every page that is not in the cache is built from ERA's public SPARQL endpoint, which other
people use too. Measured against PROD in October 2026:

| What | Queries to ERA | Time |
|---|---|---|
| A page (section of line, track, operational point...) | 4 in the first round, then about 2 to 6, then labels | 0.4 to 1 s |
| An infrastructure manager's page (`rd:scope "all"`) | the same, over every graph | about 5 s, kept a day |
| The start-page examples | one per class page, about 25 | a few seconds, kept a day |
| One sitemap file | 1, over the whole store | 15 to 30 s, kept a day |

So the instance holds itself back:

- The API runs as one process (`WEB_CONCURRENCY=1`), so it keeps one cache and one count of
  queries in flight. Threads do the waiting on ERA. More processes multiply both.
- At most `DESCRIBE_MAX_QUERIES` queries are in flight at once; a page that cannot get its
  turn within 20 s gets `503` with `Retry-After`.
- After five failures in a row (timeouts, connection errors, `5xx`), the API stops asking
  that endpoint for 30 s and answers `503` at once, instead of holding a thread for each
  request until it times out.
- When the cache is full, expired answers go first and then the least recently used ones,
  so a crawler does not push out what is kept for a day. Two requests for the same page share
  one build.
- Browsers and proxies may keep the API's answers for five minutes (`Cache-Control`).
- nginx limits each client to `DESCRIBE_RATE_LIMIT` requests per second on `/api/` and the
  sitemaps, and answers `429` beyond that. Behind a reverse proxy, set
  `DESCRIBE_TRUSTED_PROXIES` to its address; otherwise every visitor shares the proxy's limit.
  `robots.txt` asks crawlers for a second between requests.

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
