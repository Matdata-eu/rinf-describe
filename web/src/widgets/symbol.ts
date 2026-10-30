// rd:SymbolViewer: an illustrative, non-dimensioned symbol next to each value's label
// (rd:symbol "loading-gauge" for gauging profiles, "track-gauge" for the track gauge).
import { h, s } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import { termText } from '../format.ts';
import type { Widget } from './types.ts';

function loadingGauge(): SVGElement {
  // A vehicle outline over two rails: the space a gauging profile reserves.
  return s('svg', { viewBox: '0 0 64 72', class: 'symbol', 'aria-hidden': 'true' },
    s('path', { d: 'M14 60V22c0-8 6-14 14-14h8c8 0 14 6 14 14v38', class: 'outline' }),
    s('path', { d: 'M8 60h48', class: 'base' }),
    s('path', { d: 'M18 66h6M40 66h6', class: 'rail' }));
}

function trackGauge(): SVGElement {
  // Two rails seen end-on with the distance between them.
  return s('svg', { viewBox: '0 0 64 72', class: 'symbol', 'aria-hidden': 'true' },
    s('path', { d: 'M6 54h52', class: 'base' }),
    s('path', { d: 'M14 44h6v10h-6zM44 44h6v10h-6z', class: 'rail-head' }),
    s('path', { d: 'M20 30h24M20 30l5-4M20 30l5 4M44 30l-5-4M44 30l-5 4', class: 'measure' }),
    s('path', { d: 'M20 24v16M44 24v16', class: 'tick-line' }));
}

const SYMBOLS: Record<string, () => SVGElement> = { 'loading-gauge': loadingGauge, 'track-gauge': trackGauge };

export const SymbolViewer: Widget = {
  render: ({ entry, env, labels, row }) => {
    const values = entry.values ?? [];
    if (!values.length) return null;
    const draw = SYMBOLS[row.settings.symbol ?? ''] ?? loadingGauge;
    return h('div', { class: 'symbols' }, values.map((v) => h('figure', { class: 'symbol-tile' },
      draw(),
      h('figcaption', null, v.iri
        ? h('a', { class: 'iri-link', href: describeHref(v.iri, env), title: v.iri }, iriLabel(v.iri, labels))
        : termText(v, labels)))));
  },
};
