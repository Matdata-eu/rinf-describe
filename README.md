# RINF Describe

Readable pages for the resources of ERA's Register of Infrastructure (RINF). Every RINF
class has a page of its own: sections of line with their route, map and the parameters of
their tracks summed up; tracks with their gradient profile, cross-section and route
compatibility; operational points with the lines that meet there and a schematic of their
tracks; national lines with a profile along km; platforms, sidings, tunnels, contact line
systems, ETCS, train detection systems, infrastructure managers, primary locations,
signals, border points, kilometric posts, linear elements with their topology, the
RINF code lists (SKOS concept schemes) and their concepts, and the rest. Every resource also gets all its
RINF parameters by index chapter, all its properties, incoming links, a graph, and a UML
diagram of its data model from ERA's SHACL shapes.

- **Laid out by SHACL DASH shapes.** What a class page shows, in which group, tab and
  order, and which widget draws each value is in [`shapes/`](shapes): standard SHACL and
  DASH plus a few `rd:` terms for widgets DASH lacks. Adding a class is a Turtle file, not
  code. See [docs/shapes.md](docs/shapes.md).
- **Live and fast.** Every page is built on the spot from ERA's SPARQL endpoint, about a
  fraction of a second, so it always shows what ERA publishes today.
  Nothing is stored: no database, no index to keep up to date.
- **One family with RINF Atlas.** Same type (IBM Plex), colours, light and dark themes,
  MapLibre maps and vis-network graphs, with the MatData design system's graph grammar.

Pages: `/describe?uri=<IRI>&env=prod`. Each has its own title, description and canonical
address, and the class pages are listed in sitemaps ([docs/seo.md](docs/seo.md)). Help, a
first-visit tour, What's new and Share work as in RINF Atlas.

## Widgets

Route diagram, map with layers (OpenStreetMap + OpenRailwayMap), summaries over linked
resources (ranges, counts, sums), key figures, railway locations (`km 53+240`), line
profile, along-the-line strip, track cross-section, step chart (gradient profile),
connections of an operational point, track layout, platform side view, symbols (gauging,
track gauge, country, platform height, direction, energy supply), validity on a time
axis, changes over time, data status (not applicable / not yet available), value tables,
resources expanded in place, the RINF parameters by index chapter, documents, facilities,
scale bars, the neighbourhood graph and the data model diagram. Help text, units and RINF
indexes come from ERA's ontology. Each is a `dash:viewer` a shape picks per property; the
tabs All properties, Incoming links, Graph and Data model come with every page.

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
