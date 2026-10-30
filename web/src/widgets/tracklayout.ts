// rd:TrackLayoutViewer: a schematic of an operational point: its tracks as parallel bars,
// the platform edges along the tracks they serve, and the sidings below, with ids and
// lengths. Not to scale. The row lists the tracks (column id); rd:platforms and rd:sidings
// name the table rows of the page that list the platforms (columns track, length, height)
// and the sidings (column length).
import type { Item } from '../api.ts';
import { h } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

/** The start all strings share, cut back to a separator so no word is split. */
export function commonPrefix(xs: string[]): string {
  if (xs.length < 2) return '';
  let p = xs[0];
  for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1);
  const cut = Math.max(p.lastIndexOf(' - '), -1);
  return cut > 0 ? p.slice(0, cut + 3) : '';
}

const num = (it: Item, k: string) => { const v = Number(it.cells[k]?.[0]?.value); return Number.isFinite(v) && v > 0 ? v : null; };

export const TrackLayoutViewer: Widget = {
  wide: true,
  render: ({ entry, page, row, env, labels }) => {
    const tracks = entry.items ?? [];
    const platforms = page.doc.rows[row.settings.platforms ?? '']?.items ?? [];
    const sidings = page.doc.rows[row.settings.sidings ?? '']?.items ?? [];
    if (!tracks.length && !sidings.length) return null;
    const name = (it: Item, col = 'id') => (it.cells[col]?.[0] ? termText(it.cells[col][0], labels) : iriLabel(it.iri, labels));
    const byTrack = new Map<string, Item[]>();
    for (const p of platforms) {
      const t = p.cells.track?.find((v) => v.iri)?.iri;
      if (t) { if (!byTrack.has(t)) byTrack.set(t, []); byTrack.get(t)!.push(p); }
    }
    const longest = Math.max(1, ...platforms.map((p) => num(p, 'length') ?? 0), ...sidings.map((x) => num(x, 'length') ?? 0));
    // Track ids often repeat the operational point's name ("Leuven - Voie A"): drop what they all share.
    const prefix = commonPrefix(tracks.map((it) => name(it)));
    const short = (it: Item) => name(it).slice(prefix.length) || name(it);
    const sorted = [...tracks].sort((a, b) => short(a).localeCompare(short(b), 'en', { numeric: true }));
    const lane = (it: Item) => {
      const pfs = byTrack.get(it.iri) ?? [];
      return h('li', { class: 'tl-track' },
        h('a', { class: 'tl-id iri-link', href: describeHref(it.iri, env), title: name(it) }, short(it)),
        h('div', { class: 'tl-lane' },
          h('span', { class: 'tl-rail', 'aria-hidden': 'true' }),
          pfs.map((p) => {
            const len = num(p, 'length');
            const height = p.cells.height?.[0] ? termText(p.cells.height[0], labels) : null;
            return h('a', { class: 'tl-platform', href: describeHref(p.iri, env), style: `width:${Math.max(12, ((len ?? longest * 0.3) / longest) * 100).toFixed(1)}%`,
              title: `${iriLabel(p.iri, labels)}${len ? `, ${formatNumber(len)} m` : ''}${height ? `, ${height} mm` : ''}` },
            [len ? `${formatNumber(len)} m` : name(p, 'platform'), height ? ` · ${height} mm` : ''].join(''));
          })));
    };
    const parts: Node[] = [];
    if (sorted.length) parts.push(h('ol', { class: 'tl-tracks', 'aria-label': 'Tracks' }, sorted.map(lane)));
    if (sidings.length) {
      parts.push(h('p', { class: 'tl-head muted small' }, `${sidings.length} ${sidings.length === 1 ? 'siding' : 'sidings'}`));
      parts.push(h('ul', { class: 'tl-sidings' }, [...sidings].sort((a, b) => (num(b, 'length') ?? 0) - (num(a, 'length') ?? 0)).map((x) => {
        const len = num(x, 'length');
        return h('li', { class: 'tl-siding' },
          h('a', { class: 'tl-id iri-link', href: describeHref(x.iri, env), title: x.iri }, iriLabel(x.iri, labels)),
          h('span', { class: 'tl-bar', style: `width:${Math.max(4, ((len ?? 0) / longest) * 100).toFixed(1)}%` }),
          h('span', { class: 'muted small' }, len ? `${formatNumber(len)} m` : 'length unknown'));
      })));
    }
    return h('div', { class: 'track-layout' }, parts,
      h('p', { class: 'muted small tl-note' }, `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}, ${platforms.length} ${platforms.length === 1 ? 'platform edge' : 'platform edges'}. Schematic: platforms and sidings are drawn to their usable length relative to the longest; tracks are not to scale.`));
  },
};
