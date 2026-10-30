// rd:LineProfileViewer: a national line along km, one lane per value of its sections:
// numbers (a range such as the maximum speed of the tracks, a count) as steps, categories
// (energy supply, ETCS level, gauge) as coloured bands, the operational points as ticks.
// rd:table names the table row with the sections (columns start-km, start-offset, end-km,
// end-offset, length, from, to); rd:lanes lists the columns drawn as lanes.
import type { Aggregate, Item } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

/** A section along its line: from..to in km (from < to); a and b the km of its start and end point. */
export interface Placed { it: Item; from: number; to: number; a: number; b: number }

const num = (v: string | undefined) => { const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) ? x : null; };

/** Where each section lies along the line, in km: from its start km and length (or end km).
 * When most sections lack a km, they are chained from end to start in the order they connect. */
export function place(items: Item[]): Placed[] {
  const at = (it: Item, end: boolean) => {
    const km = num(it.cells[end ? 'end-km' : 'start-km']?.[0]?.value);
    const off = num(it.cells[end ? 'end-offset' : 'start-offset']?.[0]?.value) ?? 0;
    return km === null ? null : km + off / 1000;
  };
  const length = (it: Item) => num(it.cells.length?.[0]?.value);
  const withKm = items.filter((it) => at(it, false) !== null);
  if (withKm.length >= items.length / 2) {
    return withKm.map((it) => {
      const a = at(it, false)!, b = at(it, true);
      const len = length(it);
      const to = len !== null && (b === null || Math.abs(b - a - len) > len * 0.5 + 0.5) ? a + len : b ?? a;
      return { it, from: Math.min(a, to), to: Math.max(a, to), a, b: to };
    }).sort((x, y) => x.from - y.from || x.to - y.to);
  }
  // Chain: start with the sections whose start is no other section's end.
  const ends = new Set(items.map((it) => it.cells.to?.[0]?.iri));
  const byStart = new Map<string, Item[]>();
  for (const it of items) { const k = it.cells.from?.[0]?.iri ?? ''; if (!byStart.has(k)) byStart.set(k, []); byStart.get(k)!.push(it); }
  const out: Placed[] = [];
  const done = new Set<string>();
  let km = 0;
  const walk = (it: Item) => {
    while (it && !done.has(it.iri)) {
      done.add(it.iri);
      const len = length(it) ?? 1;
      out.push({ it, from: km, to: km + len, a: km, b: km + len });
      km += len;
      it = (byStart.get(it.cells.to?.[0]?.iri ?? '') ?? []).find((x) => !done.has(x.iri))!;
    }
  };
  for (const it of items) if (!ends.has(it.cells.from?.[0]?.iri)) walk(it);
  for (const it of items) walk(it);
  return out;
}

const PALETTE = ['--lane-0', '--lane-1', '--lane-2', '--lane-3', '--lane-4', '--lane-5'];

/** The value a band shows: the most common one. */
const top = (a: Aggregate | undefined) => a?.values?.[0];

export const LineProfileViewer: Widget = {
  wide: true,
  render: ({ entry, row, page, env, labels }) => {
    const items = entry.items ?? [];
    if (items.length < 1) return null;
    const placed = place(items);
    if (!placed.length) return null;
    const table = page.rows.find((r) => r.key === row.settings.table);
    const lanes = (row.settings.lanes ?? '').split(/\s+/).map((k) => table?.columns.find((c) => c.key === k)).filter((c) => !!c)
      // A lane no section has a value for says nothing.
      .filter((c) => items.some((it) => { const g = it.aggregates?.[c!.key]; return g && (g.count || g.max !== undefined || g.values?.length || g.sum !== undefined); }));
    const lo = placed[0].from, hi = Math.max(...placed.map((p) => p.to));
    const span = hi - lo || 1;
    const W = 1000, L = 120, R = 12, LANE = 30, GAP = 8, TOP = 34;
    const x = (km: number) => L + ((km - lo) / span) * (W - L - R);
    const H = TOP + lanes.length * (LANE + GAP) + 26;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'profile-svg', role: 'img', 'aria-label': `Line profile over ${formatNumber(Math.round(span * 10) / 10)} km` });
    const legends: Node[] = [];
    // Operational points: a tick at each section boundary, named where there is room.
    const stops = new Map<number, string>();
    for (const p of placed) {
      for (const [km, op] of [[p.a, p.it.cells.from?.[0]?.iri], [p.b, p.it.cells.to?.[0]?.iri]] as const) {
        if (op && ![...stops.keys()].some((k) => Math.abs(x(k) - x(km)) < 1)) stops.set(km, op);
      }
    }
    let lastLabel = -Infinity;
    for (const [km, op] of [...stops.entries()].sort((a, b) => a[0] - b[0])) {
      const px = x(km);
      svg.append(s('path', { d: `M${px.toFixed(1)} ${TOP - 6}V${H - 24}`, class: 'pr-stop' }));
      if (px - lastLabel > 90) {
        const a = s('a', { href: describeHref(op, env) });
        a.append(s('text', { x: px, y: TOP - 12, class: 'pr-stop-text', 'text-anchor': px < L + 40 ? 'start' : px > W - 60 ? 'end' : 'middle' }, iriLabel(op, labels).slice(0, 18)));
        svg.append(a);
        lastLabel = px;
      }
    }
    lanes.forEach((col, i) => {
      const y = TOP + i * (LANE + GAP);
      svg.append(s('text', { x: 0, y: y + LANE / 2 + 4, class: 'pr-lane-name' }, col.name ?? col.key));
      svg.append(s('rect', { x: L, y, width: W - L - R, height: LANE, class: 'pr-lane-bg' }));
      const aggs = placed.map((p) => p.it.aggregates?.[col.key]);
      const numeric = aggs.some((a) => a?.max !== undefined || a?.count !== undefined);
      if (numeric) {
        const v = (a: Aggregate | undefined) => a?.max ?? a?.count ?? null;
        const max = Math.max(1, ...aggs.map((a) => v(a) ?? 0));
        placed.forEach((p, j) => {
          const val = v(aggs[j]);
          if (val === null) return;
          const hgt = Math.max(2, (val / max) * (LANE - 4));
          const x0 = x(p.from), w = Math.max(1, x(p.to) - x0);
          const r = s('rect', { x: x0, y: y + LANE - hgt, width: w, height: hgt, class: 'pr-step' });
          r.append(s('title', {}, `${iriLabel(p.it.iri, labels)}: ${aggs[j]?.min !== undefined && aggs[j]?.min !== val ? `${formatNumber(aggs[j]!.min!)}–` : ''}${formatNumber(val)}${col.unit ? ` ${col.unit}` : ''}`));
          svg.append(r);
          if (w > 34) svg.append(s('text', { x: x0 + w / 2, y: y + LANE - hgt + 11 > y + LANE - 2 ? y + LANE - 3 : y + LANE - hgt + 11, class: 'pr-step-text', 'text-anchor': 'middle' }, formatNumber(val)));
        });
      } else {
        const cats: string[] = [];
        placed.forEach((p, j) => {
          const t = top(aggs[j]);
          if (!t) return;
          const name = termText(t, labels);
          if (!cats.includes(name)) cats.push(name);
          const r = s('rect', { x: x(p.from), y: y + 3, width: Math.max(1, x(p.to) - x(p.from)), height: LANE - 6, class: 'pr-band', style: `fill:var(${PALETTE[cats.indexOf(name) % PALETTE.length]})` });
          r.append(s('title', {}, `${iriLabel(p.it.iri, labels)}: ${aggs[j]!.values!.map((v) => termText(v, labels)).join(', ')}`));
          svg.append(r);
        });
        if (cats.length) {
          legends.push(h('div', { class: 'pr-legend small' }, h('span', { class: 'muted' }, `${col.name ?? col.key}:`),
            cats.map((c, k) => h('span', { class: 'pr-key' }, h('span', { class: 'pr-swatch', style: `background:var(${PALETTE[k % PALETTE.length]})` }), c))));
        }
      }
    });
    // The km axis.
    const ya = H - 14;
    const step = [1, 2, 5, 10, 20, 50, 100, 200].find((s0) => span / s0 <= 10) ?? 500;
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) {
      svg.append(s('path', { d: `M${x(k).toFixed(1)} ${ya - 8}v4`, class: 'pr-axis' }));
      svg.append(s('text', { x: x(k), y: ya + 6, class: 'pr-axis-text', 'text-anchor': 'middle' }, `${formatNumber(k)}`));
    }
    svg.append(s('text', { x: 0, y: ya + 6, class: 'pr-lane-name' }, 'km'));
    return h('figure', { class: 'line-profile' }, h('div', { class: 'profile-wrap' }, svg), legends,
      h('figcaption', { class: 'muted small' }, `${placed.length} sections of line along ${formatNumber(Math.round(span * 10) / 10)} km. Numbers show the highest value of the section's tracks; bands its most common value.`));
  },
};

// rd:LineStopsViewer: the operational points of a line in km order, from the ends of its
// sections (the rd:table row: columns from, to, from-type, to-type and the km columns).
export const LineStopsViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels }) => {
    const placed = place(entry.items ?? []);
    const seen = new Map<string, { km: number; type?: string }>();
    for (const p of placed) {
      for (const [op, km, type] of [[p.it.cells.from?.[0]?.iri, p.a, p.it.cells['from-type']?.[0]], [p.it.cells.to?.[0]?.iri, p.b, p.it.cells['to-type']?.[0]]] as const) {
        if (op && !seen.has(op)) seen.set(op, { km, type: type ? termText(type, labels) : undefined });
      }
    }
    if (!seen.size) return null;
    const rows = [...seen.entries()].sort((a, b) => a[1].km - b[1].km);
    return h('div', { class: 'table-wrap' }, h('table', { class: 'value-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'km'), h('th', { scope: 'col' }, 'Operational point'), h('th', { scope: 'col' }, 'Type'))),
      h('tbody', null, rows.map(([op, v]) => h('tr', null,
        h('td', { class: 'mono small' }, formatNumber(Math.round(v.km * 1000) / 1000)),
        h('td', null, h('a', { class: 'iri-link', href: describeHref(op, env), title: op }, iriLabel(op, labels))),
        h('td', null, v.type ?? h('span', { class: 'muted' }, '–')))))),
      h('p', { class: 'table-note muted small' }, `${rows.length} operational points`));
  },
};
