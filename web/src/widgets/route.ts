// rd:RouteDiagramViewer: start and end point on a line, with the length and km positions.
// Drawn in the graph grammar of the design system: the two points are hub nodes (ring +
// dot), the section between them is the highlighted route.
import { h } from '../dom.ts';
import { formatKm, formatNumber, withUnit } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

export const RouteDiagramViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels, row }) => {
    const p = entry.params ?? {};
    const start = p.start?.[0]?.iri;
    const end = p.end?.[0]?.iri;
    if (!start && !end) return null;
    const length = p.length?.[0]?.value;
    const end_ = (iri: string | undefined, km: string | null, side: 'start' | 'end') =>
      h('div', { class: `route-end ${side}` },
        h('span', { class: 'hub', 'aria-hidden': 'true' }),
        iri ? h('a', { class: 'route-name iri-link', href: describeHref(iri, env), title: iri }, iriLabel(iri, labels))
          : h('span', { class: 'route-name muted' }, 'Unknown'),
        km ? h('span', { class: 'km' }, km) : null);
    return h('div', { class: 'route', role: 'img', 'aria-label': `From ${start ? iriLabel(start, labels) : 'unknown'} to ${end ? iriLabel(end, labels) : 'unknown'}${length ? `, ${formatNumber(length)} ${row.unit ?? ''}` : ''}` },
      end_(start, formatKm(p.startKm?.[0]?.value, p.startOffset?.[0]?.value), 'start'),
      h('div', { class: 'route-track', 'aria-hidden': 'true' },
        h('span', { class: 'route-line' }),
        length ? h('span', { class: 'route-length' }, withUnit(formatNumber(length), row.unit)) : null),
      end_(end, formatKm(p.endKm?.[0]?.value, p.endOffset?.[0]?.value), 'end'));
  },
};
