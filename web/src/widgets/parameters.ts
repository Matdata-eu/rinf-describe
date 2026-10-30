// rd:ParameterIndexViewer: every RINF parameter of the resource, grouped by the chapters
// of the RINF index and ordered by index, with the ontology's name, unit and definition.
// The parameters the resource marks not applicable or not yet available are listed too.
import type { Parameter, TermInfo } from '../api.ts';
import { h } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { humanize, indexUnder, localName, prefixed } from '../rdf.ts';
import { valuesNode } from './basic.ts';
import type { Ctx, Widget } from './types.ts';

const STATUS = { notApplicable: 'Not applicable', notYetAvailable: 'Not yet available' } as const;

interface Line { p: string; index: string | null; values?: Parameter[]; status?: keyof typeof STATUS }

const indexKey = (ix: string | null) => (ix ?? '99').split('.').map((x) => Number(x) || 0);
function compareIndex(a: string | null, b: string | null): number {
  const x = indexKey(a), y = indexKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** The RINF index roots of a resource ("1.1.1" for a track of a section of line, "1.2.1" for
 * one in an operational point...): set on the row as rd:indexRoot, else the root most of its
 * parameters share. */
export function indexRoots(ps: string[], terms: Record<string, TermInfo>, setting?: string): string[] {
  if (setting) return setting.split(/[\s,]+/).filter(Boolean);
  const votes = new Map<string, number>();
  for (const p of ps) {
    for (const r of new Set((terms[p]?.index ?? []).map((ix) => ix.split('.').slice(0, 3).join('.')))) {
      votes.set(r, (votes.get(r) ?? 0) + 1);
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1] || compareIndex(a[0], b[0])).map(([r]) => r);
}

/** The chapters an index sits in, outermost first: [["1.1.1.2", "Energy subsystem"], ["1.1.1.2.2", "Contact line system"]]. */
export function chaptersOf(index: string | null, chapters: Record<string, string>): [string, string][] {
  if (!index) return [];
  const parts = index.split('.');
  const out: [string, string][] = [];
  for (let n = 3; n < parts.length; n++) {
    const ix = parts.slice(0, n).join('.');
    if (chapters[ix]) out.push([ix, chapters[ix]]);
  }
  return out.slice(-2);
}

const nameOf = (p: string, terms: Record<string, TermInfo>) => {
  const l = terms[p]?.label;
  return l ? l[0].toUpperCase() + l.slice(1) : humanize(localName(p));
};

function lineNode(l: Line, ctx: Ctx, terms: Record<string, TermInfo>): HTMLElement {
  const info = terms[l.p];
  const tip = [info?.comment, prefixed(l.p)].filter(Boolean).join('\n');
  const unit = info?.unit ?? null;
  const values: Node[] = [];
  for (const v of l.values ?? []) {
    const node = valuesNode(v.values, ctx.env, ctx.labels, unit);
    if (!node) continue;
    values.push(h('div', { class: 'param-value' }, node, v.via && v.of
      ? h('span', { class: 'param-via muted small' }, ' on ', h('a', { class: 'iri-link', href: describeHref(v.of, ctx.env), title: v.of }, nameOf(v.via, terms)))
      : null));
  }
  if (l.status) values.push(h('span', { class: 'chip status' }, STATUS[l.status]));
  return h('tr', { 'data-text': `${l.index ?? ''} ${nameOf(l.p, terms)}`.toLowerCase() },
    h('td', { class: 'mono small muted param-index' }, l.index ?? ''),
    h('th', { scope: 'row', title: tip }, nameOf(l.p, terms)),
    h('td', null, values));
}

export const ParameterIndexViewer: Widget = {
  wide: true,
  render: (ctx) => {
    const terms = ctx.terms ?? {};
    const chapters = ctx.chapters ?? {};
    const found = ctx.entry.parameters ?? [];
    const ds = ctx.page.doc.dataStatus ?? {};
    const byP = new Map<string, Parameter[]>();
    for (const x of found) {
      if (!byP.has(x.p)) byP.set(x.p, []);
      byP.get(x.p)!.push(x);
    }
    const status = new Map<string, keyof typeof STATUS>();
    for (const k of Object.keys(STATUS) as (keyof typeof STATUS)[]) {
      for (const p of ds[k] ?? []) if (terms[p]?.index && !byP.has(p)) status.set(p, k);
    }
    const all = [...byP.keys(), ...status.keys()];
    if (!all.length) return null;
    const roots = indexRoots(all, terms, ctx.row.settings?.indexRoot);
    const lines: Line[] = all.map((p) => ({ p, index: indexUnder(terms[p]?.index, roots), values: byP.get(p), status: status.get(p) }));
    lines.sort((a, b) => compareIndex(a.index, b.index) || nameOf(a.p, terms).localeCompare(nameOf(b.p, terms)));

    const body: Node[] = [];
    let open: string[] = [];
    for (const l of lines) {
      const chain = chaptersOf(l.index, chapters);
      chain.forEach(([ix, label], depth) => {
        if (open[depth] === ix) return;
        open = [...open.slice(0, depth), ix];
        body.push(h('tr', { class: `param-chapter level-${depth}` },
          h('td', { class: 'mono small muted param-index' }, ix), h('th', { colspan: 2, scope: 'rowgroup' }, label)));
      });
      if (!chain.length) open = [];
      body.push(lineNode(l, ctx, terms));
    }
    const filter = h('input', { type: 'search', class: 'param-filter', placeholder: 'Filter parameters', 'aria-label': 'Filter parameters' });
    const table = h('table', { class: 'params' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Index'), h('th', { scope: 'col' }, 'Parameter'), h('th', { scope: 'col' }, 'Value'))),
      h('tbody', null, body));
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const tr of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
        tr.hidden = !!q && (tr.classList.contains('param-chapter') || !(tr.dataset.text ?? '').includes(q));
      }
    });
    const given = byP.size;
    return h('div', { class: 'param-index' },
      h('div', { class: 'param-head' }, filter,
        h('span', { class: 'muted small' }, `${given} ${given === 1 ? 'parameter' : 'parameters'} given${status.size ? `, ${status.size} marked not applicable or not yet available` : ''}`)),
      h('div', { class: 'table-wrap' }, table));
  },
};
