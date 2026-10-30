// rd:ConnectionsViewer: the operational point in the middle and the sections of line that
// start or end there as spokes, each ending in the operational point at its other end, with
// the line and the length. Spokes point the way the section leaves on the map when the
// geometries are known. The table row's columns: start, end, line, length, wkt.
import type { Geometry, Position } from 'geojson';
import type { Item, Term } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import { parseWkt } from '../wkt.ts';
import type { Widget } from './types.ts';

interface Spoke { section: string; far?: string; line?: Term; length?: string; angle: number | null }

function points(g: Geometry | null): Position[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat();
  return [];
}

/** Bearing in degrees (0 = east, counter-clockwise) from the centre to the end of the section
 * away from it: where the section goes, not the way its first metres leave the station (lines
 * often leave side by side before they part). */
export function bearing(center: Position, section: Position[]): number | null {
  if (section.length < 2) return null;
  const k = Math.cos((center[1] * Math.PI) / 180);
  const d = (p: Position) => Math.hypot((p[0] - center[0]) * k, p[1] - center[1]);
  const a = section[0], b = section[section.length - 1];
  const far = d(a) > d(b) ? a : b;
  if (d(far) < 1e-9) return null;
  return (Math.atan2(far[1] - center[1], (far[0] - center[0]) * k) * 180) / Math.PI;
}

/** Spreads angles so that no two spokes are closer than `min` degrees. */
export function spread(angles: number[], min = 22): number[] {
  const order = angles.map((a, i) => ({ a: ((a % 360) + 360) % 360, i })).sort((x, y) => x.a - y.a);
  for (let pass = 0; pass < 8; pass++) {
    for (let j = 1; j < order.length; j++) {
      if (order[j].a - order[j - 1].a < min) order[j].a = order[j - 1].a + min;
    }
  }
  const out = new Array<number>(angles.length);
  for (const o of order) out[o.i] = o.a;
  return out;
}

/** Many spokes: evenly spaced, in the order of their bearings, turned to stay closest to them. */
export function evenly(angles: number[]): number[] {
  const n = angles.length, step = 360 / n;
  const order = angles.map((a, i) => ({ a: ((a % 360) + 360) % 360, i })).sort((x, y) => x.a - y.a);
  // The circular mean of how far each bearing is from its even slot.
  let sx = 0, sy = 0;
  order.forEach((o, k) => { const d = ((o.a - k * step) * Math.PI) / 180; sx += Math.cos(d); sy += Math.sin(d); });
  const turn = (Math.atan2(sy, sx) * 180) / Math.PI;
  const out = new Array<number>(n);
  order.forEach((o, k) => { out[o.i] = turn + k * step; });
  return out;
}

function centre(ctx: { page: { doc: { rows: Record<string, { values?: Term[] }> } } }): Position | null {
  const wkt = ctx.page.doc.rows.map?.values?.[0]?.value;
  const pts = wkt ? points(parseWkt(wkt)) : [];
  if (!pts.length) return null;
  return [pts.reduce((x, p) => x + p[0], 0) / pts.length, pts.reduce((y, p) => y + p[1], 0) / pts.length];
}

export const ConnectionsViewer: Widget = {
  wide: true,
  render: (ctx) => {
    const { entry, env, labels, iri } = ctx;
    const items: Item[] = entry.items ?? [];
    if (!items.length) return null;
    const c = centre(ctx);
    const spokes: Spoke[] = items.map((it) => {
      const start = it.cells.start?.[0]?.iri, end = it.cells.end?.[0]?.iri;
      const far = start === iri ? end : end === iri ? start : end ?? start;
      const geom = it.cells.wkt?.[0]?.value;
      return { section: it.iri, far, line: it.cells.line?.[0], length: it.cells.length?.[0]?.value,
        angle: c && geom ? bearing(c, points(parseWkt(geom))) : null };
    });
    const known = spokes.filter((x) => x.angle !== null).length;
    const raw = spokes.map((x, i) => (known === spokes.length ? x.angle! : (360 / spokes.length) * i + 90));
    const angles = spokes.length > 8 ? evenly(raw) : spread(raw, 28);
    const W = 640, H = 380, cx = W / 2, cy = H / 2, R = 130;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'conn-svg', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
    const labelsBox = h('div', { class: 'conn-labels' });
    angles.forEach((deg, i) => {
      const r = (deg * Math.PI) / 180;
      const x = cx + Math.cos(r) * R, y = cy - Math.sin(r) * R * 1.12;
      const sp = spokes[i];
      // The spoke is the section of line: it opens its page.
      const link = s('a', { href: describeHref(sp.section, env) });
      link.append(s('title', {}, `Section of line: ${iriLabel(sp.section, labels)}`),
        s('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'conn-hit' }), s('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'conn-line' }));
      svg.append(link);
      svg.append(s('circle', { cx: x, cy: y, r: 6, class: 'conn-far' }));
      const right = Math.cos(r) >= -0.2;
      const side = Math.abs(Math.cos(r)) < 0.26 ? 'mid' : right ? 'right' : 'left';
      const meta = [sp.line ? termText(sp.line, labels) : null, sp.length ? `${formatNumber(sp.length)} km` : null].filter(Boolean).join(' · ');
      labelsBox.append(h('div', { class: `conn-label ${side} ${Math.sin(r) > 0 ? 'up' : 'down'}`, style: `left:${((x / W) * 100).toFixed(2)}%;top:${((y / H) * 100).toFixed(2)}%` },
        sp.far ? h('a', { class: 'iri-link conn-name', href: describeHref(sp.far, env), title: sp.far }, iriLabel(sp.far, labels)) : h('span', { class: 'muted' }, 'Unknown'),
        h('a', { class: 'iri-link conn-meta small', href: describeHref(sp.section, env), title: `Section of line: ${iriLabel(sp.section, labels)}` }, meta || 'section')));
    });
    svg.append(s('circle', { cx, cy, r: 13, class: 'conn-hub-ring' }), s('circle', { cx, cy, r: 6, class: 'conn-hub' }));
    labelsBox.append(h('div', { class: 'conn-label centre', style: 'left:50%;top:50%' }, h('strong', null, iriLabel(iri, labels))));
    // The sections themselves, in the order of the spokes (clockwise from north).
    const order = spokes.map((sp, i) => ({ sp, a: ((90 - angles[i]) % 360 + 360) % 360 })).sort((x, y) => x.a - y.a).map((o) => o.sp);
    const table = h('div', { class: 'table-wrap conn-table' }, h('table', { class: 'value-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Section of line'), h('th', { scope: 'col' }, 'Line'),
        h('th', { scope: 'col' }, 'To'), h('th', { scope: 'col' }, 'Length'))),
      h('tbody', null, order.map((sp) => h('tr', null,
        h('td', null, h('a', { class: 'iri-link', href: describeHref(sp.section, env), title: sp.section }, iriLabel(sp.section, labels))),
        h('td', null, sp.line ? termText(sp.line, labels) : h('span', { class: 'muted' }, '–')),
        h('td', null, sp.far ? h('a', { class: 'iri-link', href: describeHref(sp.far, env), title: sp.far }, iriLabel(sp.far, labels)) : h('span', { class: 'muted' }, '–')),
        h('td', null, sp.length ? `${formatNumber(sp.length)} km` : h('span', { class: 'muted' }, '–')))))));
    return h('figure', { class: 'connections', role: 'group', 'aria-label': `${items.length} connected ${items.length === 1 ? 'section' : 'sections'} of line` },
      h('div', { class: 'conn-canvas' }, svg, labelsBox),
      table,
      h('figcaption', { class: 'muted small' }, `${items.length} ${items.length === 1 ? 'section' : 'sections'} of line start or end here${known === spokes.length ? '; each spoke points to where its section goes, north up' : ''}. Click a spoke for its section. Not to scale.`));
  },
};
