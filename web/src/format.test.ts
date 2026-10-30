import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillTemplate, formatKm, formatRange, parseSteps } from './format.ts';
import { humanize, iriLabel } from './rdf.ts';
import { parseWkt } from './wkt.ts';

test('km positions are written km 53+240', () => {
  assert.equal(formatKm('53', '240'), 'km 53+240');
  assert.equal(formatKm('57', '46'), 'km 57+046');
  assert.equal(formatKm('12.5', null), 'km 12.5');
  assert.equal(formatKm(undefined, '240'), null);
});

test('ranges collapse when every child agrees', () => {
  assert.equal(formatRange({ min: 85, max: 140 }, 'km/h'), '85–140 km/h');
  assert.equal(formatRange({ min: 95, max: 95 }, 'km/h'), '95 km/h');
  assert.equal(formatRange({ count: 3 }), null);
});

test('badge templates need every field they name', () => {
  assert.equal(fillTemplate('Electrified {withValue} of {children}', { withValue: 5, children: 6 }), 'Electrified 5 of 6');
  assert.equal(fillTemplate('{count} tracks', {}), null);
});

test('gradient profiles parse as value(length) steps', () => {
  assert.deepEqual(parseSteps('+0.1(22.21),-0.1(52.209),+0(20.303)'), [
    { value: 0.1, length: 22.21 }, { value: -0.1, length: 52.209 }, { value: 0, length: 20.303 }]);
  assert.deepEqual(parseSteps('no profile'), []);
});

test('WKT, with or without a CRS', () => {
  assert.deepEqual(parseWkt('POINT (6.09 49.89)'), { type: 'Point', coordinates: [6.09, 49.89] });
  assert.deepEqual(parseWkt('<http://www.opengis.net/def/crs/OGC/1.3/CRS84> LINESTRING (1 2, 3 4)'),
    { type: 'LineString', coordinates: [[1, 2], [3, 4]] });
  assert.deepEqual(parseWkt('MULTILINESTRING ((1 2, 3 4), (5 6, 7 8))'),
    { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] });
  assert.equal(parseWkt('nonsense'), null);
});

test('labels fall back to readable forms', () => {
  assert.equal(iriLabel('http://data.europa.eu/949/concepts/nominal-track-gauges/30', {}), 'nominal track gauges 30');
  assert.equal(iriLabel('http://x/y', { 'http://x/y': 'Track (from 2020-01-01 until 2030-01-01)' }), 'Track');
  assert.equal(humanize('maximumAltitude'), 'Maximum altitude');
});
