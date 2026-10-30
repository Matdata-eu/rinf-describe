import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, parseSteps } from './format.ts';
import { helpPredicate, helpText, indexUnder } from './rdf.ts';
import { fileType } from './widgets/document.ts';
import { chaptersOf, indexRoots } from './widgets/parameters.ts';
import { parseMarks } from './widgets/scalebar.ts';
import { countryCode } from './widgets/symbol.ts';

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
