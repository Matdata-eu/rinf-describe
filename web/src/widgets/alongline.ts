// rd:AlongLineViewer: a section of line as a strip from its start to its end operational
// point, with what lies along it at its km: tunnels and phase separations as bands, signals,
// level crossings and kilometric posts as ticks. rd:table names the row with the section's
// km (params startKm, startOffset, endKm, endOffset, start, end: the route diagram);
// rd:markers lists the (hidden) table rows with the assets, each with the columns km and
// offset (a point), start-km, start-offset, end-km, end-offset (a stretch), or km and
// length in metres (a short stretch). Assets outside the section's km are left out.
import type { Item, RowDef, Term } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatKm, formatNumber } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

const num = (t: Term[] | undefined) => { const v = t?.[0]?.value; const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) ? x : null; };
const kmOf = (km: Term[] | undefined, off: Term[] | undefined) => { const k = num(km); return k === null ? null : k + (num(off) ?? 0) / 1000; };

export interface Mark { it: Item; from: number; to: number | null }

/** Where an asset lies: a point (to null) or a stretch, in km; null when it has no km. */
export function markOf(it: Item): Mark | null {
  const c = it.cells;
  const a = kmOf(c['start-km'], c['start-offset']);
  if (a !== null) {
    const b = kmOf(c['end-km'], c['end-offset']);
    return { it, from: Math.min(a, b ?? a), to: Math.max(a, b ?? a) };
  }
  const k = kmOf(c.km, c.offset);
  if (k === null) return null;
  const len = num(c.length);
  return { it, from: k, to: len ? k + len / 1000 : null };
}

const KINDS = ['--lane-0', '--lane-2', '--lane-1', '--lane-3', '--lane-4', '--lane-5'];

export const AlongLineViewer: Widget = {
  wide: true,
  render: ({ entry, row, page, env, labels }) => {
    const route = entry.params ?? {};
    const a = kmOf(route.startKm, route.startOffset), b = kmOf(route.endKm, route.endOffset);
    if (a === null || b === null || a === b) return null;
    const lo = Math.min(a, b), hi = Math.max(a, b), slack = 0.05;
    const kinds: { def: RowDef; marks: Mark[] }[] = [];
    for (const key of (row.settings.markers ?? '').split(/\s+/).filter(Boolean)) {
      const def = page.rows.find((r) => r.key === key);
      const marks = (page.doc.rows[key]?.items ?? []).map(markOf)
        .filter((m): m is Mark => !!m && (m.to ?? m.from) >= lo - slack && m.from <= hi + slack);
      if (def && marks.length) kinds.push({ def, marks });
    }
    if (!kinds.length) return null;
    const W = 1000, L = 16, R = 16, Y = 56, H = 120;
    const x = (km: number) => L + ((Math.min(hi, Math.max(lo, km)) - a) / (b - a)) * (W - L - R);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'along-svg', role: 'img', 'aria-label': `What lies along the section, km ${formatNumber(lo)} to ${formatNumber(hi)}` });
    svg.append(s('path', { d: `M${L} ${Y}H${W - R}`, class: 'al-line' }));
    for (const px of [L, W - R]) svg.append(s('circle', { cx: px, cy: Y, r: 6, class: 'al-end' }));
    kinds.forEach(({ def, marks }, i) => {
      const color = `var(${KINDS[i % KINDS.length]})`;
      for (const m of marks) {
        const link = s('a', { href: describeHref(m.it.iri, env) });
        const tip = `${def.name ?? def.key}: ${iriLabel(m.it.iri, labels)}, km ${formatNumber(Math.round(m.from * 1000) / 1000)}${m.to !== null && m.to !== m.from ? `–${formatNumber(Math.round(m.to * 1000) / 1000)}` : ''}`;
        if (m.to !== null && m.to !== m.from) {
          const x0 = Math.min(x(m.from), x(m.to)), w = Math.max(3, Math.abs(x(m.to) - x(m.from)));
          const r = s('rect', { x: x0, y: Y - 9, width: w, height: 18, rx: 3, class: 'al-band', style: `fill:${color}` });
          r.append(s('title', {}, tip));
          link.append(r);
        } else {
          const px = x(m.from), y0 = Y + 10 + (i % 3) * 14;
          const g = s('path', { d: `M${px.toFixed(1)} ${Y + 4}V${y0}M${(px - 4).toFixed(1)} ${y0 + 6}h8`, class: 'al-tick', style: `stroke:${color}` });
          g.append(s('title', {}, tip));
          link.append(g);
        }
        svg.append(link);
      }
    });
    const end = (iri: Term[] | undefined, km: number, anchor: 'start' | 'end') => {
      const op = iri?.[0]?.iri;
      svg.append(s('text', { x: anchor === 'start' ? L : W - R, y: 22, class: 'al-end-text', 'text-anchor': anchor }, op ? iriLabel(op, labels) : ''));
      svg.append(s('text', { x: anchor === 'start' ? L : W - R, y: 38, class: 'al-km-text', 'text-anchor': anchor }, formatKm(Math.trunc(km), Math.round((km - Math.trunc(km)) * 1000)) ?? ''));
    };
    end(route.start, a, 'start');
    end(route.end, b, 'end');
    const legend = h('div', { class: 'pr-legend small' }, kinds.map(({ def, marks }, i) =>
      h('span', { class: 'pr-key' }, h('span', { class: 'pr-swatch', style: `background:var(${KINDS[i % KINDS.length]})` }), `${def.name ?? def.key} (${marks.length})`)));
    return h('figure', { class: 'along-line' }, h('div', { class: 'profile-wrap' }, svg), legend,
      h('figcaption', { class: 'muted small' }, 'Placed at their km on the line; hover for the name and km, click to open.'));
  },
};
