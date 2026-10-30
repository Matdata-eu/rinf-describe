import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClassPage, RowDef } from './api.ts';
import { badgeText, layout, statusOf } from './layout.ts';

const DASH = 'http://datashapes.org/dash#';
const RD = 'https://rinf-describe.matdata.eu/ns#';
const row = (o: Partial<RowDef>): RowDef => ({ key: 'k', name: null, path: null, group: null, order: 100, viewer: null, roles: [],
  over: null, aggregate: null, unit: null, format: null, params: {}, settings: {}, columns: [], ...o });

const page: ClassPage = {
  shape: 's', class: 'c', label: 'Section of line',
  groups: [
    { iri: 'g:route', label: 'Route', order: 10, tab: 'overview' },
    { iri: 'g:rcc', label: 'Infrastructure', order: 110, tab: 'Route compatibility' },
  ],
  rows: [
    row({ key: 'title', path: '<http://www.w3.org/2000/01/rdf-schema#label>', roles: [DASH + 'LabelRole'] }),
    row({ key: 'route', viewer: RD + 'RouteDiagramViewer', order: 1 }),
    row({ key: 'from', group: 'g:route', order: 10 }),
    row({ key: 'gauge', group: 'g:rcc', order: 10, path: '<http://data.europa.eu/949/wheelSetGauge>' }),
    row({ key: 'speed', roles: [DASH + 'KeyInfoRole'], unit: 'km/h', name: 'Speed' }),
    row({ key: 'misc', name: 'Misc' }),
  ],
  doc: { class: 'c', rows: {}, dataStatus: { notApplicable: ['http://data.europa.eu/949/wheelSetGauge'] } },
};

test('shapes lay out into title, badges, hero widgets and tabs of groups', () => {
  const l = layout(page);
  assert.equal(l.titleRow?.key, 'title');
  assert.deepEqual(l.badges.map((r) => r.key), ['speed']);
  assert.deepEqual(l.hero.map((r) => r.key), ['route']);
  assert.deepEqual(l.tabs.map((t) => [t.key, t.label, t.groups.map((g) => g.group.label)]), [
    ['overview', 'Overview', ['Route', 'Other']],
    ['route-compatibility', 'Route compatibility', ['Infrastructure']],
  ]);
});

test('an empty row the resource marks not applicable says so', () => {
  assert.equal(statusOf(page.rows[3], page), 'notApplicable');
  assert.equal(statusOf(page.rows[2], page), null);
});

test('badges: template, else name and value', () => {
  const speed = page.rows[4];
  assert.equal(badgeText(speed, { aggregate: { min: 85, max: 140, children: 6, withValue: 6 } }, {}), 'Speed 85–140 km/h');
  assert.equal(badgeText({ ...speed, settings: { badge: 'Electrified {withValue} of {children}' } },
    { aggregate: { values: [{ iri: 'x', count: 5 }], children: 6, withoutValue: 1 } }, {}), 'Electrified 5 of 6');
  assert.equal(badgeText(speed, {}, {}), null);
});
