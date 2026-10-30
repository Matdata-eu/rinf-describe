# RINF Describe

Readable pages for the resources of ERA's Register of Infrastructure (RINF): a section of
line with its route, map and the parameters of its tracks summed up; a track with its
gradient profile, contact line, ETCS and route compatibility parameters; and every other
resource with all its properties, incoming links and a graph.

- **Laid out by SHACL DASH shapes.** What a class page shows, in which group, tab and
  order, and which widget draws each value is in [`shapes/`](shapes): standard SHACL and
  DASH plus a few `rd:` terms for widgets DASH lacks. Adding a class is a Turtle file, not
  code. See [docs/shapes.md](docs/shapes.md).
- **Fast.** Pages are evaluated ahead of time by [RINF Atlas](https://github.com/Matdata-eu/rinf-atlas)'s
  worker into Atlas's database, so a page is one lookup, not a series of live SPARQL
  queries. Resources outside the index are read live from ERA.
- **One family with RINF Atlas.** Same type (IBM Plex), colours, light and dark themes,
  MapLibre maps and vis-network graphs, with the MatData design system's graph grammar.

Pages: `/describe?uri=<IRI>&env=prod`.

## Widgets

Route diagram, map (OpenStreetMap + OpenRailwayMap), summaries over linked resources
(ranges, counts per value), railway locations (`km 53+240`), step chart (gradient
profile), symbols (gauging, track gauge), validity on a time axis, data status (not
applicable / not yet available), value tables, resources expanded in place, and the
neighbourhood graph. Each is a `dash:viewer` a shape picks per property.

## Run it

Next to a running RINF Atlas with its describe index on: [docs/deploy.md](docs/deploy.md).

```sh
cp .env.example .env
docker compose up -d --build     # http://<host>:8090
```

## Layout

| Path | What |
|---|---|
| `shapes/` | Describe shapes, mounted into Atlas's worker |
| `api/` | FastAPI service, read-only on Atlas's database |
| `web/` | TypeScript + Vite UI |
| `db/readonly.sql` | The read-only role the API uses |
| `scripts/` | Development database and seed from Atlas's sample |
| `tests/` | The shapes, evaluated with Atlas's indexer on Atlas's sample |

## Licence

MIT. Data: European Union Agency for Railways (ERA), Register of Infrastructure (RINF).
Map data © OpenStreetMap contributors; rail overlay © OpenRailwayMap (CC-BY-SA 2.0).
