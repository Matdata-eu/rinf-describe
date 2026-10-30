# Writing describe shapes

A class page is one `sh:NodeShape` with `sh:targetClass` in [`shapes/`](../shapes), one
file per class. Nothing about a class is in code: the shapes say which properties a page
shows, in which group, tab and order, and which widget draws each one.

The API compiles this folder at start (the image carries it) and evaluates the shapes of a
resource's classes on ERA's SPARQL endpoint each time its page is opened
([architecture.md](architecture.md)). After an edit, restart the API.

## Standard terms

| Term | Used for |
|---|---|
| `sh:property`, `sh:path`, `sh:name`, `sh:order` | One row: any SHACL path (sequence, inverse, alternative), its label and position |
| `sh:PropertyGroup` + `sh:group` | A card on the page, ordered by the group's `sh:order`, titled by its `rdfs:label` |
| `sh:node` | The columns of a table, or the lines of a resource expanded in place |
| `dash:viewer` | The widget for the row (below). Without one, the plain viewer that fits the data |
| `dash:propertyRole dash:LabelRole` | The page title |
| `dash:propertyRole dash:KeyInfoRole` | Also shown as a badge under the title |

## `rd:` terms

Namespace `https://rinf-describe.matdata.eu/ns#`, declared in
[`shapes/describe.ttl`](../shapes/describe.ttl).

| Term | On | Meaning |
|---|---|---|
| `rd:tab` | group | Tab of the group, shown as its title (`"Route compatibility"`). Default: Overview |
| `rd:over` | row | Path to linked resources (the tracks of a section); `sh:path` is evaluated on each |
| `rd:aggregate` | row | How those values are summed up: `"range"`, `"distinct-count"` or `"count"` |
| `rd:unit` | row, column | Unit written after the value |
| `rd:badge` | row | Badge text: `{value}`, `{min}`, `{max}`, `{count}`, `{withValue}`, `{children}`, `{unit}` |
| `rd:key` | row | Stable key of the row (default: from `sh:name` or the path); needed when two rows share a name |
| other `rd:x` with a path | row | A named path the row's widget reads (`rd:start`, `rd:km`, ...) |
| other `rd:x` with a literal | row | A widget setting (`rd:symbol "track-gauge"`) |

## Widgets

| `dash:viewer` | Shows | Reads |
|---|---|---|
| `dash:LabelViewer`, `dash:LiteralViewer` | Linked label, or literal with its unit; booleans as Yes/No; several values joined with a middle dot | `sh:path` |
| `dash:URIViewer` | The raw IRI | `sh:path` |
| `dash:ValueTableViewer` | Linked resources as a table, each opening its page | `sh:path`, `sh:node` (columns) |
| `dash:DetailsViewer` | Linked resources expanded in place | `sh:path`, `sh:node` (lines) |
| `rd:RouteDiagramViewer` | Start and end point on a line, length and km positions | `rd:start`, `rd:end`, `rd:length`, optional `rd:startKm`, `rd:startOffset`, `rd:endKm`, `rd:endOffset` |
| `rd:MapViewer` | WKT on OpenStreetMap + OpenRailwayMap, WKT text below | `sh:path` (highlighted), optional `rd:context` (drawn quieter) |
| `rd:AggregateViewer` | `85–140 km/h`, `1435 (3) · 1668 (3)`, `6` | `sh:path`, `rd:over`, `rd:aggregate` |
| `rd:LrsLocationViewer` | The value with its position, `km 53+240` | `sh:path`, `rd:km`, `rd:offset` (metres) |
| `rd:StepChartViewer` | A `value(length),...` profile as a step chart: rising green, falling red | `sh:path`, `rd:unit`, `rd:lengthUnit` |
| `rd:SymbolViewer` | An illustrative, non-dimensioned symbol per value | `sh:path`, `rd:symbol` (`loading-gauge`, `track-gauge`) |
| `rd:ValidityViewer` | Validity period on a time axis with today marked | `rd:begin`, `rd:end` (`era:validity` is an `era:TemporalFeature`, a `time:TemporalDuration`) |

Every class page also gets a **Data status** card (the parameters marked
`era:notApplicable` or `era:notYetAvailable`), and every resource the **All properties**,
**Incoming links** and **Graph** tabs. They need no shape.

## Layout rules

- Rows without a group and with a map or route diagram go to the top of the Overview tab.
- Rows without a group but with `dash:KeyInfoRole` are badges only; other rows without a group land in an "Other" card.
- An empty row is hidden, unless the resource marks its property not applicable or not yet available: then it says so.
- Tables, expanded resources, maps and charts take the full width of the page.

## Example

```turtle
shape:sol-tracks a sh:PropertyGroup ; rdfs:label "Track characteristics" ; sh:order 20 .

shape:section-of-line a sh:NodeShape ;
  sh:targetClass era:SectionOfLine ;
  sh:property [
    sh:path era:maximumPermittedSpeed ; sh:name "Maximum permitted speed" ;
    rd:over [ sh:alternativePath ( era:hasPart [ sh:inversePath era:isPartOf ] ) ] ;
    rd:aggregate "range" ; rd:unit "km/h" ;
    sh:group shape:sol-tracks ; sh:order 20 ;
    dash:viewer rd:AggregateViewer ; dash:propertyRole dash:KeyInfoRole ;
  ] .
```

## Limits

- One `sh:targetClass` per node shape (a second class needs a second shape).
- Paths are evaluated inside the resource's own named graph; labels are the `skos:prefLabel` or `rdfs:label` of each IRI on the endpoint (all graphs, including the SKOS vocabularies).
- `sh:node` is one level deep, and its columns take plain paths (no `rd:over`).
- Paths are evaluated on the resource itself; a widget that needs values of a linked resource reaches them with a sequence path (`( era:netReference era:startsAt era:hasLrsCoordinate era:kmPost era:kilometer )`).

`tests/test_shapes.py` compiles the shapes and checks the pages on the Luxembourg sample
in `tests/fixtures/`, served as a SPARQL endpoint by pyoxigraph; run it after editing.
Restart the API after editing the shapes.
