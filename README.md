# RINF Describe

Readable pages for the resources of ERA's Register of Infrastructure (RINF): a section of
line with its route, map and the parameters of its tracks summed up; a track with its
gradient profile, contact line, ETCS and route compatibility parameters; every
infrastructure element with its map, identification and all its RINF parameters by RINF
index chapter; and every other resource with all its properties, incoming links and a
graph.

- **Laid out by SHACL DASH shapes.** What a class page shows, in which group, tab and
  order, and which widget draws each value is in [`shapes/`](shapes): standard SHACL and
  DASH plus a few `rd:` terms for widgets DASH lacks. Adding a class is a Turtle file, not
  code. See [docs/shapes.md](docs/shapes.md).
- **Live and fast.** Every page is built on the spot from ERA's SPARQL endpoint, about a
  tenth of a second for a section of line, so it always shows what ERA publishes today.
  Nothing is stored: no database, no index to keep up to date.
- **One family with RINF Atlas.** Same type (IBM Plex), colours, light and dark themes,
  MapLibre maps and vis-network graphs, with the MatData design system's graph grammar.

Pages: `/describe?uri=<IRI>&env=prod`. Each has its own title, description and canonical
address, and the class pages are listed in sitemaps ([docs/seo.md](docs/seo.md)). Help, a
first-visit tour, What's new and Share work as in RINF Atlas.

## Widgets

Route diagram, map (OpenStreetMap + OpenRailwayMap), summaries over linked resources
(ranges, counts per value), railway locations (`km 53+240`), step chart (gradient
profile), symbols (gauging, track gauge, country), validity on a time axis, data status
(not applicable / not yet available), value tables, resources expanded in place, the
RINF parameters by index chapter, documents, facilities, scale bars, and the
neighbourhood graph. Help text, units and RINF indexes come from ERA's ontology. Each is a `dash:viewer` a shape picks per property.

## Run it

Anywhere with outbound HTTPS to ERA: [docs/deploy.md](docs/deploy.md). The search box
finds names through [RINF Atlas](https://github.com/Matdata-eu/rinf-atlas)'s public API.

```sh
cp .env.example .env
docker compose pull && docker compose up -d     # http://<host>:8090
```

How it fits together: [docs/architecture.md](docs/architecture.md). Search engines:
[docs/seo.md](docs/seo.md). Privacy statement: [docs/privacy.md](docs/privacy.md).

## Layout

| Path | What |
|---|---|
| `shapes/` | Describe shapes |
| `api/` | FastAPI service: builds the pages from ERA's SPARQL endpoint |
| `web/` | TypeScript + Vite UI |
| `site/` | Your own pages, such as `privacy.html` |
| `scripts/` | Benchmark of pages against ERA's endpoint |
| `tests/` | The shapes, evaluated on a Luxembourg sample of ERA's data |

## Licence

MIT. Data: European Union Agency for Railways (ERA), Register of Infrastructure (RINF).
Map data © OpenStreetMap contributors; rail overlay © OpenRailwayMap (CC-BY-SA 2.0).
