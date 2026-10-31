import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeUrl } from './dom.ts';

test('links never run script', () => {
  for (const ok of ['http://data.europa.eu/949/sectionOfLine/14fd15444d', 'https://example.org/a?b=c', '/describe?uri=x', 'blob:https://x/1', 'mailto:a@b.c']) {
    assert.equal(safeUrl(ok), true, ok);
  }
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', 'vbscript:x', 'data:text/html,<script>alert(1)</script>']) {
    assert.equal(safeUrl(bad), false, bad);
  }
});
