// Plain DASH viewers (label, literal, URI, value table, details) and the rd: summaries
// that are text: aggregates over linked resources and railway locations.
import type { Aggregate, CountedTerm, Item, RowDef, Term } from '../api.ts';
import { h, joined } from '../dom.ts';
import { api } from '../api.ts';
import { boolValue, formatKm, formatNumber, formatRange, isBoolean, termText, withUnit } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel, pathText } from '../rdf.ts';
import type { Ctx, Widget } from './types.ts';

/** One value: a link for an IRI, a Yes/No chip for a boolean, text with its unit otherwise. */
export function valueNode(t: Term, env: string, labels: Record<string, string>, unit?: string | null): Node {
  if (t.iri) return h('a', { class: 'iri-link', href: describeHref(t.iri, env), title: t.iri }, iriLabel(t.iri, labels));
  if (isBoolean(t)) return h('span', { class: `chip ${boolValue(t) ? 'yes' : 'no'}` }, termText(t, labels));
  const text = termText(t, labels);
  if (text.length > 160) return h('span', { class: 'long-text' }, text);
  return h('span', { class: 'lit', lang: t.lang || null }, withUnit(text, unit));
}

/** Several values joined with a middle dot. */
export function valuesNode(values: Term[] | undefined, env: string, labels: Record<string, string>, unit?: string | null): Node | null {
  if (!values?.length) return null;
  if (values.length === 1) return valueNode(values[0], env, labels, unit);
  return h('span', { class: 'values' }, joined(values.map((v) => valueNode(v, env, labels, unit))));
}

export const LabelViewer: Widget = {
  render: ({ entry, env, labels, row }) => valuesNode(entry.values, env, labels, row.unit),
};

export const URIViewer: Widget = {
  render: ({ entry }) => {
    const iris = (entry.values ?? []).filter((v) => v.iri);
    if (!iris.length) return null;
    return h('span', { class: 'values' }, joined(iris.map((v) => h('a', { class: 'mono iri', href: v.iri!, rel: 'noopener noreferrer' }, v.iri!))));
  },
};

function countedNode(v: CountedTerm, env: string, labels: Record<string, string>, unit: string | null, total?: number): Node {
  const tip = total ? `${v.count} of ${total}` : String(v.count);
  return h('span', { class: 'counted', title: tip }, valueNode(v, env, labels, unit), h('span', { class: 'count' }, ` (${v.count})`));
}

/** Plain text of a summary, for badges and table cells. */
export function aggregateText(a: Aggregate, labels: Record<string, string>, unit?: string | null): string | null {
  if (a.count !== undefined) return String(a.count);
  if (a.sum !== undefined) return withUnit(formatNumber(a.sum), unit);
  if (a.min !== undefined) return formatRange(a, unit);
  if (a.values?.length) return a.values.map((v) => withUnit(termText(v, labels), unit)).join(' · ');
  return null;
}

export const AggregateViewer: Widget = {
  render: ({ entry, env, labels, row }) => {
    const a = entry.aggregate;
    if (!a) return null;
    if (a.count !== undefined) return h('span', { class: 'lit' }, String(a.count));
    if (a.sum !== undefined) return h('span', { class: 'lit' }, withUnit(formatNumber(a.sum), row.unit));
    if (a.min !== undefined) {
      const partial = a.children !== undefined && a.withValue !== undefined && a.withValue < a.children;
      return h('span', null, h('span', { class: 'lit' }, formatRange(a, row.unit)),
        partial ? h('span', { class: 'count', title: 'Linked resources with a value' }, ` (${a.withValue} of ${a.children})`) : null);
    }
    if (!a.values?.length) return null;
    const parts: Node[] = a.values.map((v) => countedNode(v, env, labels, row.unit, a.children));
    if (a.withoutValue) parts.push(h('span', { class: 'counted none', title: `${a.withoutValue} of ${a.children}` }, 'none', h('span', { class: 'count' }, ` (${a.withoutValue})`)));
    return h('span', { class: 'values' }, joined(parts));
  },
};

/** A railway location: the value (an operational point) with its kilometre position. */
export const LrsLocationViewer: Widget = {
  render: ({ entry, env, labels, row }) => {
    const value = valuesNode(entry.values, env, labels, row.unit);
    const km = formatKm(entry.params?.km?.[0]?.value, entry.params?.offset?.[0]?.value);
    if (!value && !km) return null;
    return h('span', { class: 'lrs' }, value, km ? h('span', { class: 'km' }, km) : null);
  },
};

/** One cell of a table: the column's values, or its summary over the item's children. */
export function cellNode(it: Item, col: RowDef, env: string, labels: Record<string, string>): Node {
  const a = it.aggregates?.[col.key];
  const text = a ? aggregateText(a, labels, col.unit) : null;
  if (text) return h('span', { class: 'lit' }, text);
  return valuesNode(it.cells[col.key], env, labels, col.unit) ?? h('span', { class: 'muted' }, '–');
}

/** Linked resources as a table, columns from the row's sh:node. */
export const ValueTableViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels, row, iri }) => {
    const items = entry.items ?? [];
    if (!items.length) return null;
    const cols = row.columns.filter((c) => c.settings?.hidden !== 'true');
    const total = entry.total ?? items.length;
    const line = (it: Item) => h('tr', null,
      h('td', null, h('a', { class: 'iri-link', href: describeHref(it.iri, env), title: it.iri }, iriLabel(it.iri, labels))),
      cols.map((c) => h('td', null, cellNode(it, c, env, labels))));
    // A paged table keeps the endpoint's order, so the next page follows on; a whole one is sorted.
    // rd:sortBy "km": in the numeric order of that column (sections of a line by start km).
    const by = row.settings.sortBy;
    const numeric = (it: Item) => { const v = Number(it.cells[by ?? '']?.[0]?.value); return Number.isFinite(v) ? v : Infinity; };
    const shown = by ? [...items].sort((a, b) => numeric(a) - numeric(b) || a.iri.localeCompare(b.iri))
      : entry.total !== undefined ? items : [...items].sort((a, b) => sortKey(a, cols, labels).localeCompare(sortKey(b, cols, labels), 'en', { numeric: true }));
    const body = h('tbody', null, shown.map(line));
    const note = h('p', { class: 'table-note muted small' });
    let count = items.length;
    const more = h('button', { type: 'button', class: 'btn small show-more' }, 'Show more');
    const update = () => {
      note.textContent = count < total ? `${formatNumber(count)} of ${formatNumber(total)} resources` : `${formatNumber(total)} ${total === 1 ? 'resource' : 'resources'}`;
      more.hidden = count >= total;
    };
    more.addEventListener('click', async () => {
      more.disabled = true;
      more.textContent = 'Loading…';
      try {
        const r = await api.rows(iri, env, row.key, count);
        Object.assign(labels, r.labels);
        body.append(...r.items.map(line));
        count += r.items.length;
        if (!r.items.length) count = total;
        more.textContent = 'Show more';
      } catch (e) {
        more.textContent = `Could not load more: ${e instanceof Error ? e.message : e}`;
      }
      more.disabled = false;
      update();
    });
    update();
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'value-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), cols.map((c) => h('th', { scope: 'col' }, c.name ?? c.key)))),
        body),
      h('div', { class: 'table-foot' }, note, total > items.length ? more : null));
  },
};

function sortKey(it: Item, cols: RowDef[], labels: Record<string, string>): string {
  const first = cols[0] && it.cells[cols[0].key]?.[0];
  return first ? termText(first, labels) : iriLabel(it.iri, labels);
}

/** A linked resource expanded in place: its own label / value lines. */
export const DetailsViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels, row }) => {
    const items = entry.items ?? [];
    if (!items.length) return null;
    return h('div', { class: 'details-list' }, items.map((it) => h('div', { class: 'details' },
      h('a', { class: 'details-title iri-link', href: describeHref(it.iri, env), title: it.iri }, iriLabel(it.iri, labels)),
      h('dl', { class: 'rows' }, row.columns.filter((c) => it.cells[c.key]?.length || it.aggregates?.[c.key]).map((c) =>
        h('div', { class: 'row' }, h('dt', { title: c.path ? pathText(c.path) : null }, c.name ?? c.key),
          h('dd', null, cellNode(it, c, env, labels))))))));
  },
};

export type { Ctx };
