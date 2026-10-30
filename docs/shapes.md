# Writing describe shapes

A class page is one `sh:NodeShape` with `sh:targetClass` in [`shapes/`](../shapes), one
file per class. Nothing about a class is in code: the shapes say which properties a page
shows, in which group, tab and order, and which widget draws each one.

## Base page and merging

A resource gets every shape whose class it has, asserted or as a superclass in the ERA
ontology (`rdfs:subClassOf`, read from ERA's endpoint). They are merged into one page:
rows merge by `rd:key`, the more specific class winning. So
[`infrastructure-element.ttl`](../shapes/infrastructure-element.ttl) on
`era:InfrastructureElement` gives every infrastructure class a page (map, identification,
validity, parts and the RINF parameters tab), and a class shape only adds or overrides
what it needs. To drop a base row, deactivate its key:

```turtle
sh:property [ rd:key "parts" ; sh:deactivated true ] .
```

Shared pieces live in [`common.ttl`](../shapes/common.ttl): named paths
(`shape:own-or-subset`, `shape:part-of`, `shape:parts`, `shape:validity-begin`,
`shape:validity-end`) and the document card (`shape:document-card`). A named node with
path triples (`sh:alternativePath`, `rdf:first`...) is read as that path wherever a path
goes, so files can share it; a blank node cannot be shared between files.

## Help, units and RINF index from the ontology

Every row whose path ends in an ERA property gets the ontology's definition and RINF
index as its help text, and the ontology's unit when the row has no `rd:unit`. Write
`rd:unit` only to override it.

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
| `rd:aggregate` | row, column | How those values are summed up: `"range"`, `"distinct-count"`, `"count"` or `"sum"` (of the first value of each) |
| `rd:weight` | row | With a distinct count: a path from each linked resource to the number it counts for, so shares are by that rather than by count (track-km: `( shape:part-of era:lengthOfSectionOfLine )`); `rd:weightUnit` names it |
| `rd:unit` | row, column | Unit written after the value |
| `rd:badge` | row | Badge text: `{value}`, `{min}`, `{max}`, `{count}`, `{withValue}`, `{children}`, `{unit}` |
| `rd:class` | row | Only the linked resources of this class (the tracks among the parts of an operational point) |
| `rd:limit` | table row | At most this many linked resources at a time; the page shows the total and a **Show more** button (`/api/rows`) |
| `rd:scope "all"` | row | Evaluated over every graph, not only the resource's own (sections of line of another provider that end at a border point) |
| `rd:hidden "true"` | row, column | Read but not shown: a column for the map (`wkt`), or a row that is only data for another row's widget (the markers of `rd:AlongLineViewer`) |
| `rd:figures` | row | Keys of the (hidden) summary rows `rd:KeyFiguresViewer` shows as tiles; the row needs no path |
| `rd:table` | row | Key of another row whose values the widget draws (the sections of a line profile); the row needs no path |
| `rd:sortBy` | table row | Column the table is sorted by, as numbers (`"start-km"`) |
| `rd:cacheSeconds` | node shape | How long its pages are kept (86400 for national lines, which sum up thousands of tracks); default 10 minutes |
| `rd:over` on a column | column | Sums the column up over the children of each linked resource (the tracks of each section of a line), with `rd:aggregate` and `rd:class` |
| `rd:key` | row | Stable key of the row (default: from `sh:name` or the path); needed when two rows share a name |
| other `rd:x` with a path | row | A named path the row's widget reads (`rd:start`, `rd:km`, ...) |
| other `rd:x` with a literal | row | A widget setting (`rd:symbol "track-gauge"`) |
| the same `rd:x` more than once | row | Numbered `x`, `x.1`, `x.2`... in a stable order (`rd:facility`) |
| `sh:deactivated true` | row | Hides the row of that `rd:key` from a less specific shape |

## Widgets

| `dash:viewer` | Shows | Reads |
|---|---|---|
| `dash:LabelViewer`, `dash:LiteralViewer` | Linked label, or literal with its unit; booleans as Yes/No; several values joined with a middle dot | `sh:path` |
| `dash:URIViewer` | The raw IRI | `sh:path` |
| `dash:ValueTableViewer` | Linked resources as a table, each opening its page | `sh:path`, `sh:node` (columns) |
| `dash:DetailsViewer` | Linked resources expanded in place | `sh:path`, `sh:node` (lines) |
| `rd:RouteDiagramViewer` | Start and end point on a line, length and km positions | `rd:start`, `rd:end`, `rd:length`, optional `rd:startKm`, `rd:startOffset`, `rd:endKm`, `rd:endOffset` |
| `rd:MapViewer` | WKT on OpenStreetMap + OpenRailwayMap, WKT text below | `sh:path` (highlighted), optional `rd:context` (drawn quieter), optional `rd:layers "connections track-table"`: table rows of the page whose `wkt` column becomes a layer that can be switched off, each line or point opening its page |
| `rd:ConnectionsViewer` | The sections of line that start or end at an operational point as spokes, pointing to where each goes (its far end, north up), each to the operational point at its other end with line and length; a spoke opens its section, and a table below lists the sections | `sh:path`, `sh:node` with columns `start`, `end`, `line`, `length`, `wkt` |
| `rd:TrackLayoutViewer` | An operational point's tracks as parallel bars, its platform edges on the tracks they serve, its sidings below; not to scale | `sh:path` to the tracks (column `id`); `rd:platforms` and `rd:sidings` name the table rows with the platforms (`track`, `length`, `height`) and sidings (`length`) |
| `rd:LineProfileViewer` | A national line along km: one lane per column of its sections, numbers as steps, categories as coloured bands, gradient profiles as the steepest gradient along the km, operational points as ticks | `rd:table` (columns `start-km`, `start-offset`, `end-km`, `end-offset`, `length`, `from`, `to`), `rd:lanes "speed energy etcs"`, `rd:profiles "gradient"` (lanes holding `era:gradientProfile` values, `gradient(km)` per change) |
| `rd:LineStopsViewer` | The operational points of a line in km order, with their type | `rd:table` (as above, plus `from-type`, `to-type`) |
| `rd:AlongLineViewer` | A section of line as a strip between its operational points, with tunnels and phase separations as bands and kilometric posts as ticks at their km | `rd:table "route"` (the route diagram row), `rd:markers` (hidden rows with columns `km`/`offset`, `start-km`…`end-offset`, or `km` and `length` in m) |
| `rd:CrossSectionViewer` | A track end-on, not to scale: gauge, gauging profile, contact wire heights, rail inclination | `rd:gauge`, `rd:loadingGauge`, `rd:wireMin`, `rd:wireMax`, `rd:inclination` |
| `rd:KeyFiguresViewer` | Stat tiles: a number for a count, sum or range; shares as a bar for a distinct count (by `rd:weight` when the row has one) | `rd:figures "im-ops im-km im-energy"` |
| `rd:ChangesViewer` | Parameters that apply from or until a date (`era:parameterApplicability`) on a time axis with today marked | `sh:path`, `sh:node` with columns `parameter`, `value`, `begin`, `end` |
| `rd:PlatformViewer` | Side view of a platform edge against the TSI heights of 550 and 760 mm, with its usable length and whether it is curved | `rd:height`, `rd:length`, `rd:curved` |
| `rd:AggregateViewer` | `85–140 km/h`, `1435 (3) · 1668 (3)`, `6` | `sh:path`, `rd:over`, `rd:aggregate` |
| `rd:LrsLocationViewer` | The value with its position, `km 53+240` | `sh:path`, `rd:km`, `rd:offset` (metres) |
| `rd:StepChartViewer` | A `value(length),...` profile as a step chart: rising green, falling red | `sh:path`, `rd:unit`, `rd:lengthUnit` |
| `rd:SymbolViewer` | An illustrative, non-dimensioned symbol per value | `sh:path`, `rd:symbol` (`loading-gauge`, `track-gauge`, `country`, `platform-height`, `direction`, `energy-supply`) |
| `rd:ValidityViewer` | Validity period on a time axis with today marked | `rd:begin`, `rd:end` (`era:validity` is an `era:TemporalFeature`, a `time:TemporalDuration`) |
| `rd:ParameterIndexViewer` | Every RINF parameter of the resource (and of the non-infrastructure resources it links to: contact line system, ETCS...) by RINF index chapter, with a filter; parameters marked not applicable or not yet available too | No path; optional `rd:indexRoot "1.2.1"` (default: the root most parameters share) |
| `rd:DocumentViewer` | `era:Document` resources as cards: file type, name, open link | `sh:path`, `sh:node shape:document-card` |
| `rd:FacilitiesViewer` | Yes/no parameters as tiles: yes, no, not applicable, not yet available | `rd:facility`, once per property |
| `rd:ScaleBarViewer` | A length against reference marks, or a min–max range on a scale | `sh:path` or `rd:min` / `rd:max`; `rd:marks "400 Passenger train; 740 Freight train"`, `rd:scale "4 7"` |

Every class page also gets a **Data status** card (the parameters marked
`era:notApplicable` or `era:notYetAvailable`), and every resource the **All properties**,
**Incoming links**, **Graph** and **Data model** tabs. They need no shape: the data model is
a UML class diagram drawn from ERA's own SHACL shapes, not from these.

## Layout rules

- Rows without a group and with a map, route diagram, line profile or platform sketch go to the top of the Overview tab.
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
- `rd:ParameterIndexViewer` follows one link from the resource (to resources that are not
  infrastructure elements themselves) and keeps the properties with a RINF index.
- Paths are evaluated inside the resource's own named graph (unless `rd:scope "all"`); labels are the `skos:prefLabel` or `rdfs:label` of each IRI on the endpoint (all graphs, including the SKOS vocabularies).
- `sh:node` is one level deep; a column with `rd:over` sums up over one more level (no deeper).
- Paths are evaluated on the resource itself; a widget that needs values of a linked resource reaches them with a sequence path (`( era:netReference era:startsAt era:hasLrsCoordinate era:kmPost era:kilometer )`).

`tests/test_shapes.py` compiles the shapes and checks the pages on the Luxembourg sample
in `tests/fixtures/`, served as a SPARQL endpoint by pyoxigraph; run it after editing.
Restart the API after editing the shapes.
