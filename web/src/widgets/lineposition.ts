// rd:LinePositionViewer: where a kilometric post is on its line. The line as a strip from
// its first to its last km, its operational points (the ends of its sections) as stops, the
// other posts as ticks and this one marked; below, the stops and posts on either side.
// rd:table names the row with the sections of the line (columns from, to, start-km,
// start-offset, end-km, end-offset); rd:posts the row with its posts (column km); the
// page's "km" row is the post's own km.
import type { Item, Term } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatNumber } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

const num = (t: Term[] | undefined) => { const v = t?.[0]?.value; const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) ? x : null; };
const kmOf = (km: Term[] | undefined, off: Term[] | undefined) => { const k = num(km); return k === null ? null : k + (num(off) ?? 0) / 1000; };
const kmText = (k: number) => `km ${formatNumber(Math.round(k * 1000) / 1000)}`;

export interface Stop { iri: string; km: number }

/** The operational points of a line at the km of the section ends they are at. */
export function stops(sections: Item[]): Stop[] {
  const at = new Map<string, number>();
  for (const it of sections) {
    const a = kmOf(it.cells['start-km'], it.cells['start-offset']), b = kmOf(it.cells['end-km'], it.cells['end-offset']);
    const from = it.cells.from?.[0]?.iri, to = it.cells.to?.[0]?.iri;
    if (from && a !== null && !at.has(from)) at.set(from, a);
    if (to && b !== null && !at.has(to)) at.set(to, b);
  }
  return [...at].map(([iri, km]) => ({ iri, km })).sort((x, y) => x.km - y.km);
}

/** The last of `list` at or before `km` and the first after it (excluding `self`). */
export function around<T extends { km: number; iri: string }>(list: T[], km: number, self?: string): [T | null, T | null] {
  const others = list.filter((x) => x.iri !== self);
  const before = others.filter((x) => x.km <= km).at(-1) ?? null;
  const after = others.find((x) => x.km > km) ?? null;
  return [before, after];
}

export const LinePositionViewer: Widget = {
  wide: true,
  render: ({ row, page, iri, env, labels }) => {
    const km = num(page.doc.rows.km?.values);
    if (km === null) return null;
    const ops = stops(page.doc.rows[row.settings.table ?? '']?.items ?? []);
    const posts = (page.doc.rows[row.settings.posts ?? '']?.items ?? [])
      .map((it) => ({ iri: it.iri, km: num(it.cells.km) }))
      .filter((p): p is Stop => p.km !== null).sort((a, b) => a.km - b.km);
    const all = [km, ...ops.map((o) => o.km), ...posts.map((p) => p.km)];
    const lo = Math.min(...all), hi = Math.max(...all);
    if (!(hi > lo)) return null;

    const W = 1000, L = 20, R = 20, Y = 70, H = 128;
    const x = (k: number) => L + ((k - lo) / (hi - lo)) * (W - L - R);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'along-svg kp-svg', role: 'img', 'aria-label': `${kmText(km)} on a line from ${kmText(lo)} to ${kmText(hi)}` });
    svg.append(s('path', { d: `M${L} ${Y}H${W - R}`, class: 'al-line' }));
    for (const p of posts) {
      if (p.iri === iri) continue;
      const a = s('a', { href: describeHref(p.iri, env) });
      const t = s('path', { d: `M${x(p.km).toFixed(1)} ${Y + 5}v8`, class: 'kp-tick' });
      t.append(s('title', {}, `Kilometric post ${kmText(p.km)}`));
      a.append(t);
      svg.append(a);
    }
    // Stops: dots; their names where there is room, the ones either side of the post first.
    const [opBefore, opAfter] = around(ops, km);
    const named: Stop[] = [];
    const room = (k: number) => named.every((n) => Math.abs(x(n.km) - x(k)) > 130);
    for (const o of [opBefore, opAfter, ops[0], ops.at(-1), ...ops].filter((o): o is Stop => !!o)) if (!named.includes(o) && room(o.km) && Math.abs(x(o.km) - x(km)) > 60) named.push(o);
    for (const o of ops) {
      const a = s('a', { href: describeHref(o.iri, env) });
      const dot = s('circle', { cx: x(o.km).toFixed(1), cy: Y, r: 4.5, class: 'kp-stop' });
      dot.append(s('title', {}, `${iriLabel(o.iri, labels)}, ${kmText(o.km)}`));
      a.append(dot);
      if (named.includes(o)) {
        const px = x(o.km), anchor = px < 90 ? 'start' : px > W - 90 ? 'end' : 'middle';
        a.append(s('text', { x: px.toFixed(1), y: Y + 34, class: 'kp-stop-text', 'text-anchor': anchor }, iriLabel(o.iri, labels)));
      }
      svg.append(a);
    }
    const px = x(km);
    svg.append(s('path', { d: `M${px.toFixed(1)} ${Y - 26}V${Y + 10}`, class: 'kp-self-line' }),
      s('circle', { cx: px.toFixed(1), cy: Y, r: 7, class: 'kp-self' }),
      s('text', { x: px.toFixed(1), y: Y - 34, class: 'kp-self-text', 'text-anchor': px < 80 ? 'start' : px > W - 80 ? 'end' : 'middle' }, kmText(km)));
    svg.append(s('text', { x: L, y: H - 4, class: 'al-km-text' }, kmText(lo)), s('text', { x: W - R, y: H - 4, class: 'al-km-text', 'text-anchor': 'end' }, kmText(hi)));

    const [postBefore, postAfter] = around(posts, km, iri);
    const side = (label: string, o: Stop | null, kind: string) => h('div', { class: 'kp-side' },
      h('span', { class: 'muted small' }, label),
      o ? h('span', null, h('a', { class: 'iri-link', href: describeHref(o.iri, env), title: o.iri }, kind === 'post' ? kmText(o.km) : iriLabel(o.iri, labels)),
        h('span', { class: 'muted small mono' }, kind === 'post' ? ` ${formatNumber(Math.round(Math.abs(o.km - km) * 1000))} m away` : ` ${kmText(o.km)}`))
        : h('span', { class: 'muted' }, kind === 'post' ? 'none' : 'line end'));
    return h('figure', { class: 'line-position' },
      h('div', { class: 'profile-wrap' }, svg),
      h('div', { class: 'kp-sides' },
        side('Operational point before', opBefore, 'op'), side('Operational point after', opAfter, 'op'),
        side('Previous post', postBefore, 'post'), side('Next post', postAfter, 'post')),
      h('figcaption', { class: 'muted small' }, `${ops.length ? `${ops.length} operational points from the line's sections` : 'No sections of line are on this line'}${posts.length ? `, ${posts.length} kilometric posts` : ''}. To scale along km; hover for names, click to open.`));
  },
};
