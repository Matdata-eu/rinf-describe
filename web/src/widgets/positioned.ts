// rd:PositionedViewer: what is positioned on a linear element. Points (signals, switches,
// kilometric posts...) whose topological coordinate is on the element are ticks along it,
// at their offset from its origin, one lane per type; below, everything by type, with the
// stretches (tracks, sections, lines) that run over it. The table row's columns: type, on
// (the element of the coordinate), offset (m), direction; the page's "length" row gives the
// element's length.
import type { Item } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatNumber } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

const ERA = 'http://data.europa.eu/949/';
// Types every object has besides its own: never the one it is listed under.
const GENERIC = new Set([ERA + 'InfrastructureElement', ERA + 'Feature', 'http://www.opengis.net/ont/geosparql#Feature', ERA + 'Track', ERA + 'NetElement']);
const KINDS = ['--lane-0', '--lane-2', '--lane-1', '--lane-3', '--lane-4', '--lane-5'];

/** The type an object is listed under: its most specific one. */
export function kindOf(it: Item): string {
  const ts = (it.cells.type ?? []).map((t) => t.iri).filter((t): t is string => !!t);
  return ts.find((t) => !GENERIC.has(t)) ?? ts[0] ?? '';
}

export interface Placed { it: Item; kind: string; at: number | null }

/** Each object with its type and, for a point on this element, its offset in metres. */
export function placed(items: Item[], element: string): Placed[] {
  return items.map((it) => {
    const on = (it.cells.on ?? []).some((t) => t.iri === element);
    const v = Number(it.cells.offset?.[0]?.value);
    return { it, kind: kindOf(it), at: on && it.cells.offset?.length && Number.isFinite(v) ? v : null };
  });
}

const metres = (m: number) => (m >= 1000 ? `${formatNumber(Math.round(m) / 1000)} km` : `${formatNumber(Math.round(m))} m`);

export const PositionedViewer: Widget = {
  wide: true,
  render: ({ entry, page, iri, env, labels }) => {
    const all = placed(entry.items ?? [], iri);
    if (!all.length) return null;
    const kinds = [...new Set(all.map((p) => p.kind))].sort((a, b) => iriLabel(a, labels).localeCompare(iriLabel(b, labels)));
    const color = (k: string) => `var(${KINDS[kinds.indexOf(k) % KINDS.length]})`;
    const points = all.filter((p) => p.at !== null);
    const length = Number(page.doc.rows.length?.values?.[0]?.value);
    const span = Math.max(Number.isFinite(length) && length > 0 ? length : 0, ...points.map((p) => p.at!));

    let strip: Node | null = null;
    if (points.length && span > 0) {
      const lanes = kinds.filter((k) => points.some((p) => p.kind === k));
      const W = 1000, L = 14, R = 14, Y = 24, lane = 18, H = Y + 16 + lanes.length * lane;
      const x = (m: number) => L + (m / span) * (W - L - R);
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'along-svg pos-svg', role: 'img', 'aria-label': `${points.length} objects along the element, 0 to ${metres(span)}` });
      svg.append(s('path', { d: `M${L} ${Y}H${W - R}`, class: 'al-line' }));
      for (const px of [L, W - R]) svg.append(s('circle', { cx: px, cy: Y, r: 5, class: 'al-end' }));
      svg.append(s('text', { x: L, y: 12, class: 'al-km-text' }, 'origin'), s('text', { x: W - R, y: 12, class: 'al-km-text', 'text-anchor': 'end' }, metres(span)));
      lanes.forEach((k, i) => {
        const y0 = Y + 14 + i * lane;
        svg.append(s('path', { d: `M${L} ${y0}H${W - R}`, class: 'pos-lane' }));
        for (const p of points.filter((q) => q.kind === k)) {
          const a = s('a', { href: describeHref(p.it.iri, env) });
          const px = x(p.at!).toFixed(1);
          const mark = s('path', { d: `M${px} ${Y + 4}V${y0}`, class: 'al-tick', style: `stroke:${color(k)}` });
          const dot = s('circle', { cx: px, cy: y0, r: 3.5, style: `fill:${color(k)}` });
          const tip = `${iriLabel(k, labels)}: ${iriLabel(p.it.iri, labels)}, ${metres(p.at!)} from the origin`;
          mark.append(s('title', {}, tip));
          dot.append(s('title', {}, tip));
          a.append(mark, dot);
          svg.append(a);
        }
      });
      strip = h('div', { class: 'profile-wrap' }, svg);
    }

    const groups = kinds.map((k) => {
      const of = all.filter((p) => p.kind === k).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || iriLabel(a.it.iri, labels).localeCompare(iriLabel(b.it.iri, labels), 'en', { numeric: true }));
      return h('details', { class: 'pos-group', open: of.length <= 12 },
        h('summary', null, h('span', { class: 'pr-swatch', style: `background:${color(k)}` }), h('strong', null, iriLabel(k, labels) || 'Other'), h('span', { class: 'muted' }, ` ${formatNumber(of.length)}`)),
        h('ul', { class: 'pos-list' }, of.map((p) => h('li', null,
          h('a', { class: 'iri-link', href: describeHref(p.it.iri, env), title: p.it.iri }, iriLabel(p.it.iri, labels)),
          p.at !== null ? h('span', { class: 'muted small mono' }, ` ${metres(p.at)}`) : p.it.cells.offset?.length ? null : h('span', { class: 'muted small' }, ' runs over this element')))));
    });
    return h('figure', { class: 'positioned' }, strip,
      h('div', { class: 'pos-groups' }, groups),
      h('figcaption', { class: 'muted small' }, points.length
        ? `${formatNumber(points.length)} ${points.length === 1 ? 'point' : 'points'} placed at their offset from the element's origin; hover for the name, click to open.`
        : 'No object has a position on this element; these refer to it.'));
  },
};
