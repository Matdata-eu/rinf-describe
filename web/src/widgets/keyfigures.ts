// rd:KeyFiguresViewer: stat tiles for the rows named in rd:figures (hidden summary rows of
// the page): a number for a count, a sum or a range, and for a distinct count the shares
// of its values as a bar. The row itself needs no path.
import type { Aggregate } from '../api.ts';
import { h } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import { aggregateText } from './basic.ts';
import type { Widget } from './types.ts';

const SHARE = ['--lane-0', '--lane-1', '--lane-2', '--lane-3', '--lane-4', '--lane-5'];

const share = (n: number, total: number) => { const p = (n / total) * 100; return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`; };

/** The headline number of a summary, or null for a distinct count. */
export function figureOf(a: Aggregate): number | null {
  return a.count ?? a.sum ?? a.max ?? null;
}

export const KeyFiguresViewer: Widget = {
  wide: true,
  render: ({ row, page, labels }) => {
    const tiles: Node[] = [];
    for (const key of (row.settings.figures ?? '').split(/\s+/).filter(Boolean)) {
      const def = page.rows.find((r) => r.key === key);
      const a = page.doc.rows[key]?.aggregate;
      if (!def || !a) continue;
      const name = def.name ?? key;
      const n = figureOf(a);
      if (n !== null) {
        const text = a.sum !== undefined ? formatNumber(Math.round(a.sum)) : a.max !== undefined ? aggregateText(a, labels, null) ?? '' : formatNumber(n);
        tiles.push(h('div', { class: 'kf-tile' }, h('span', { class: 'kf-value' }, text, def.unit ? h('span', { class: 'kf-unit' }, ` ${def.unit}`) : null), h('span', { class: 'kf-name muted small' }, name)));
        continue;
      }
      // Shares by weight (track-km, rd:weight) when the row has one, else by count.
      const weighted = a.weight !== undefined && a.weight > 0;
      const total = weighted ? a.weight! : a.children ?? 0;
      if (!total || !a.values) continue;
      const without = weighted ? a.withoutValueWeight ?? 0 : a.withoutValue ?? 0;
      const parts = [...a.values.map((v, i) => ({ text: termText(v, labels), n: weighted ? v.weight ?? 0 : v.count, color: `var(${SHARE[i % SHARE.length]})` })),
        ...(without ? [{ text: 'none', n: without, color: 'var(--border)' }] : [])];
      const unit = weighted ? def.settings.weightUnit ?? '' : '';
      const amount = (n: number) => `${formatNumber(weighted ? Math.round(n) : n)}${unit ? ` ${unit}` : ''}`;
      tiles.push(h('div', { class: 'kf-tile wide' },
        h('span', { class: 'kf-name muted small' }, `${name} (${weighted ? amount(total) : formatNumber(total)})`),
        h('div', { class: 'kf-bar', role: 'img', 'aria-label': parts.map((p) => `${p.text} ${Math.round((p.n / total) * 100)}%`).join(', ') },
          parts.map((p) => h('span', { style: `width:${((p.n / total) * 100).toFixed(2)}%;background:${p.color}`, title: `${p.text}: ${amount(p.n)}` }))),
        h('div', { class: 'pr-legend small' }, parts.slice(0, 6).map((p) =>
          h('span', { class: 'pr-key' }, h('span', { class: 'pr-swatch', style: `background:${p.color}` }), `${p.text} ${share(p.n, total)}`)))));
    }
    return tiles.length ? h('div', { class: 'key-figures' }, tiles) : null;
  },
};
