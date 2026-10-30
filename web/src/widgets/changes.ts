// rd:ChangesViewer: parameters that apply from or until a date (era:parameterApplicability),
// on a time axis with today marked, one line per parameter and value. Columns of the row's
// sh:node: parameter, value, begin, end.
import type { Item } from '../api.ts';
import { h } from '../dom.ts';
import { formatDate, termText } from '../format.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

const day = (d: string | undefined) => (d ? Date.parse(d.slice(0, 10)) : NaN);

export const ChangesViewer: Widget = {
  wide: true,
  render: ({ entry, labels }) => {
    const items = (entry.items ?? []).filter((it) => it.cells.parameter?.length);
    if (!items.length) return null;
    const now = Date.now();
    const begins = items.map((it) => day(it.cells.begin?.[0]?.value)).filter(Number.isFinite);
    const ends = items.map((it) => day(it.cells.end?.[0]?.value)).filter(Number.isFinite);
    const lo = Math.min(now, ...begins), hi = Math.max(now + 365 * 864e5, ...ends);
    const pct = (t: number) => `${(((t - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const name = (it: Item) => { const p = it.cells.parameter![0]; return p.iri ? iriLabel(p.iri, labels) : termText(p, labels); };
    const sorted = [...items].sort((a, b) => name(a).localeCompare(name(b)) || day(a.cells.begin?.[0]?.value) - day(b.cells.begin?.[0]?.value));
    return h('div', { class: 'changes' },
      h('ul', { class: 'changes-list' }, sorted.map((it) => {
        const b = day(it.cells.begin?.[0]?.value), e = day(it.cells.end?.[0]?.value);
        const from = Number.isFinite(b) ? b : lo, to = Number.isFinite(e) ? e : hi;
        const value = it.cells.value?.[0] ? termText(it.cells.value[0], labels) : '';
        const when = `${Number.isFinite(b) ? `from ${formatDate(it.cells.begin![0].value!)}` : ''}${Number.isFinite(e) ? ` until ${formatDate(it.cells.end![0].value!)}` : ''}`.trim();
        const state = from > now ? 'future' : to < now ? 'past' : 'now';
        return h('li', { class: `change ${state}` },
          h('span', { class: 'change-name' }, name(it), h('span', { class: 'chip' }, value)),
          h('span', { class: 'change-axis' },
            h('span', { class: 'change-bar', style: `left:${pct(from)};width:calc(${pct(to)} - ${pct(from)})` }),
            h('span', { class: 'change-today', style: `left:${pct(now)}`, title: 'Today' })),
          h('span', { class: 'muted small' }, when));
      })));
  },
};
