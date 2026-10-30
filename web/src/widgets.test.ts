import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, parseSteps } from './format.ts';
import { helpPredicate, helpText, indexUnder } from './rdf.ts';
import { markOf } from './widgets/alongline.ts';
import { bearing, evenly } from './widgets/connections.ts';
import { multiplicity, typeName } from './widgets/datamodel.ts';
import { fileName, fileType } from './widgets/document.ts';
import { classTree, pageTree } from './widgets/modeltree.ts';
import { tokens } from './widgets/source.ts';
import { classUml, mermaid, pageUml, plantuml } from './widgets/umltext.ts';
import { place } from './widgets/lineprofile.ts';
import { chaptersOf, indexRoots } from './widgets/parameters.ts';
import { heightMm } from './widgets/platform.ts';
import { parseMarks } from './widgets/scalebar.ts';
import { countryCode, directionOf, supplyColor, supplyOf } from './widgets/symbol.ts';
import { commonPrefix } from './widgets/tracklayout.ts';

const ERA = 'http://data.europa.eu/949/';

test('row help reads the property of a plain path', () => {
  assert.equal(helpPredicate(`<${ERA}maximumPermittedSpeed>`), ERA + 'maximumPermittedSpeed');
  assert.equal(helpPredicate(`(<${ERA}contactLineSystem>/<${ERA}contactLineSystemType>)`), ERA + 'contactLineSystemType');
  assert.equal(helpPredicate(`(<${ERA}isPartOf>|^<${ERA}hasPart>)`), null);
  assert.equal(helpText({ comment: 'Speed on the line.', index: ['1.1.1.1.2.5'] }, null), 'Speed on the line.\nRINF 1.1.1.1.2.5');
});

test('the RINF index of a parameter follows the root of the resource', () => {
  const terms = {
    a: { index: ['1.1.1.1.2.1', '1.2.1.0.2.1'] },
    b: { index: ['1.2.1.0.3.1'] },
    c: { index: ['1.2.1.0.6.1'] },
  };
  const roots = indexRoots(['a', 'b', 'c'], terms);
  assert.deepEqual(roots, ['1.2.1', '1.1.1']);
  assert.equal(indexUnder(terms.a.index, roots), '1.2.1.0.2.1');
  assert.deepEqual(indexRoots(['a'], terms, '1.1.1'), ['1.1.1']);
});

test('chapters are the labelled prefixes of an index, the last two', () => {
  const chapters = { '1.1.1.2': 'Energy subsystem', '1.1.1.2.2': 'Contact line system', '1.1.1': 'unused' };
  assert.deepEqual(chaptersOf('1.1.1.2.2.1', chapters), [['1.1.1.2', 'Energy subsystem'], ['1.1.1.2.2', 'Contact line system']]);
  assert.deepEqual(chaptersOf(null, chapters), []);
});

test('widget helpers', () => {
  assert.deepEqual(parseMarks('400 Passenger train; 740 Freight train'), [{ value: 400, label: 'Passenger train' }, { value: 740, label: 'Freight train' }]);
  assert.equal(fileType('https://x.org/RINF/a.PDF'), 'PDF');
  assert.equal(fileType('https://x.org/doc'), null);
  assert.equal(countryCode('http://publications.europa.eu/resource/authority/country/SWE'), 'SE');
  assert.equal(formatDate('2025-02-19T00:00:00+01:00'), '19 Feb 2025');
  assert.deepEqual(parseSteps('-06.0(+172.800)'), [{ value: -6, length: 172.8 }]);
});

test('a connection points the way its section leaves the operational point', () => {
  // A section running east from the centre, given either way round.
  assert.equal(Math.round(bearing([4, 50], [[4, 50], [4.1, 50], [4.2, 50]])!), 0);
  assert.equal(Math.round(bearing([4, 50], [[4, 50.2], [4, 50.1], [4, 50]])!), 90);
  assert.equal(bearing([4, 50], [[4, 50]]), null);
});

test('many connections are spread evenly in the order of their bearings', () => {
  const out = evenly([0, 2, 4, 6, 180, 182, 184, 186, 270]);
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(Math.abs(sorted[i] - sorted[i - 1] - 40) < 1e-9);
  assert.ok(out[0] < out[1] && out[1] < out[2] && out[3] < out[4]);
});

test('platform heights, track id prefixes and document names', () => {
  assert.equal(heightMm('550'), 550);
  assert.equal(heightMm('760 mm'), 760);
  assert.equal(heightMm('other'), null);
  assert.equal(commonPrefix(['Leuven - Voie A', 'Leuven - Voie B']), 'Leuven - ');
  assert.equal(commonPrefix(['Leuven - Voie A', 'Leuven|2 - CDS']), '');
  assert.equal(fileName('https://rinf.data.era.europa.eu/api/v1/document/9c66681895/download/'), 'Document 9c66681895');
  assert.equal(fileName('https://example.org/files/plan.pdf'), 'plan.pdf');
});

const v = (value: string) => [{ value }];
const op = (iri: string) => [{ iri }];

test('sections lie along their line by km, or chained when they have none', () => {
  const byKm = place([
    { iri: 'b', cells: { 'start-km': v('10'), 'start-offset': v('500'), length: v('4') } },
    { iri: 'a', cells: { 'start-km': v('0'), length: v('10.5') } },
  ]);
  assert.deepEqual(byKm.map((p) => [p.it.iri, p.from, p.to]), [['a', 0, 10.5], ['b', 10.5, 14.5]]);
  const chained = place([
    { iri: 'y', cells: { from: op('B'), to: op('C'), length: v('2') } },
    { iri: 'x', cells: { from: op('A'), to: op('B'), length: v('3') } },
  ]);
  assert.deepEqual(chained.map((p) => [p.it.iri, p.from, p.to]), [['x', 0, 3], ['y', 3, 5]]);
});

test('assets along a line: points, stretches and short stretches in metres', () => {
  assert.deepEqual(markOf({ iri: 's', cells: { km: v('12'), offset: v('250') } })?.from, 12.25);
  const t = markOf({ iri: 't', cells: { 'start-km': v('5'), 'end-km': v('4'), 'end-offset': v('500') } })!;
  assert.deepEqual([t.from, t.to], [4.5, 5]);
  assert.equal(markOf({ iri: 'p', cells: { km: v('2'), length: v('100') } })?.to, 2.1);
  assert.equal(markOf({ iri: 'n', cells: {} }), null);
});

test('the running direction of a track', () => {
  const D = 'http://data.europa.eu/949/concepts/track-running-directions/';
  assert.equal(directionOf({ iri: D + '10' }, {}), 'normal');
  assert.equal(directionOf({ iri: D + 'TrackRunningDirections/20' }, {}), 'opposite');
  assert.equal(directionOf({ iri: 'x' }, { x: 'B' }), 'both');
  assert.equal(directionOf({ iri: 'http://data.europa.eu/949/concepts/orientations/01' }, {}), 'opposite');
});

test('energy supply systems: current, voltage, frequency and map colour', () => {
  assert.deepEqual(supplyOf('AC 15kV-16.7Hz'), { ac: true, volts: 15000, hz: 16.7 });
  assert.deepEqual(supplyOf('DC 600 V'), { ac: false, volts: 600, hz: null });
  assert.equal(supplyOf('not electrified'), null);
  assert.notEqual(supplyColor(supplyOf('AC 25kV-50Hz')), supplyColor(supplyOf('AC 15kV-16.7Hz')));
  assert.notEqual(supplyColor(supplyOf('DC 3kV')), supplyColor(supplyOf('DC 1.5kV')));
});

test('the data model writes UML multiplicities and attribute types', () => {
  assert.equal(multiplicity({ min: 0, max: null }), '[0..*]');
  assert.equal(multiplicity({ min: 1, max: 1 }), '[1]');
  assert.equal(multiplicity({ min: 0, max: 1 }), '[0..1]');
  assert.equal(multiplicity({ min: 1, max: null }), '[1..*]');
  assert.equal(typeName({ p: 'x', min: 0, max: null, type: 'Concept', scheme: `${ERA}concepts/line-category/LineCategories` }), 'LineCategories');
  assert.equal(typeName({ p: 'x', min: 0, max: 1, type: 'boolean' }), 'boolean');
  assert.equal(typeName({ p: 'x', min: 0, max: 1 }), 'IRI');
});

const MODEL = {
  iri: ERA + 'sol/1', env: 'prod',
  model: {
    focus: ERA + 'SectionOfLine',
    boxes: [
      { iri: ERA + 'SectionOfLine', depth: 2, parents: [ERA + 'InfrastructureElement'],
        attributes: [{ p: ERA + 'lengthOfSectionOfLine', min: 1, max: 1, type: 'double' }, { p: ERA + 'solNature', min: 0, max: 1, type: 'Concept', scheme: ERA + 'SoLNatures' }],
        associations: [{ p: ERA + 'opStart', min: 1, max: 1, class: ERA + 'OperationalPoint' }] },
      { iri: ERA + 'InfrastructureElement', depth: 1, parents: [],
        attributes: [{ p: ERA + 'lengthOfSectionOfLine', min: 0, max: 1, type: 'double' }, { p: ERA + 'canonicalURI', min: 0, max: 1, type: 'anyURI' }],
        associations: [] },
    ],
    incoming: [{ p: ERA + 'hasPart', min: 0, max: null, class: ERA + 'SectionOfLine', source: ERA + 'NationalLine' }],
    classes: {},
    page: {
      nodes: [
        { iri: ERA + 'SectionOfLine', hop: 0, side: 0, members: [{ p: ERA + 'lengthOfSectionOfLine', min: 1, max: 1, type: 'double', rows: [] }] },
        { iri: ERA + 'OperationalPoint', hop: 1, side: 1, members: [{ p: ERA + 'uopid', min: 1, max: 1, type: 'string', rows: [] }] },
        { iri: ERA + 'Track', hop: 1, side: -1, members: [{ p: ERA + 'gauge', min: 0, max: 1, type: '?', missing: true, rows: [] }] },
      ],
      edges: [
        { p: ERA + 'opStart', min: 1, max: 1, from: ERA + 'SectionOfLine', to: ERA + 'OperationalPoint', rows: [] },
        { p: ERA + 'isPartOf', min: 0, max: null, from: ERA + 'Track', to: ERA + 'SectionOfLine', rows: [] },
      ],
    },
  },
  used: { out: { [ERA + 'lengthOfSectionOfLine']: 1, [ERA + 'opStart']: 1 }, in: {}, via: {} },
};

test('the data model exports as PlantUML and Mermaid class diagrams', () => {
  const u = classUml(MODEL, false)!;
  assert.deepEqual(u.classes.find((c) => c.name === 'SectionOfLine')!.members, ['lengthOfSectionOfLine : double [1]']);
  const puml = plantuml(u);
  assert.match(puml, /^@startuml\n/);
  assert.match(puml, /SectionOfLine --\|> InfrastructureElement/);
  assert.match(puml, /SectionOfLine --> "1" OperationalPoint : opStart/);
  assert.doesNotMatch(puml, /NationalLine/);   // not used on the resource
  assert.match(plantuml(classUml(MODEL, true)!), /NationalLine --> "0\.\.\*" SectionOfLine : hasPart/);
  const mmd = mermaid(pageUml(MODEL)!);
  assert.match(mmd, /^---\ntitle: What the page of a SectionOfLine shows\n---\nclassDiagram\n/);
  assert.match(mmd, /Track --> "0\.\.\*" SectionOfLine : isPartOf/);
  assert.match(mmd, /gauge : \?/);
});

test('the content tree lists a property once, as the subclass narrows it', () => {
  const root = classTree(MODEL, true)!;
  assert.deepEqual(root.children!.map((n) => [n.name, n.note ?? '', n.state]), [
    ['lengthOfSectionOfLine', '', 'on'], ['opStart', '', 'on'], ['solNature', '', 'off'], ['canonicalURI', 'from InfrastructureElement', 'off']]);
  assert.equal(root.children![1].children, null);   // a link opens when asked
  const page = pageTree(MODEL)!;
  assert.deepEqual(page.children!.map((n) => n.name), ['lengthOfSectionOfLine', 'opStart', '^isPartOf']);
  assert.deepEqual(page.children![1].children!.map((n) => n.name), ['uopid']);
  assert.equal(page.children![2].children![0].state, 'missing');
});

test('RDF text is split into highlighted tokens', () => {
  const ttl = tokens('<http://x/a> a era:Foo ; rdfs:label "a # b"@en . # note', 'ttl').filter(([k]) => k).map(([k, t]) => `${k}:${t}`);
  assert.deepEqual(ttl, ['iri:<http://x/a>', 'keyword:a', 'name:era:Foo', 'name:rdfs:label', 'string:"a # b"', 'name:@en', 'comment:# note']);
  const js = tokens('{"@id": "http://x/a"}', 'jsonld').filter(([k]) => k).map(([k, t]) => `${k}:${t}`);
  assert.deepEqual(js, ['key:"@id"', 'string:"http://x/a"']);
});
