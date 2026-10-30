// rd:FacilitiesViewer: a group of yes/no parameters as tiles (rd:facility, one per
// property): yes, no, not applicable or not yet available. Names come from the ontology.
import { h } from '../dom.ts';
import { boolValue } from '../format.ts';
import { humanize, localName, simplePredicate } from '../rdf.ts';
import type { Widget } from './types.ts';

type State = 'yes' | 'no' | 'na' | 'nya';
const TEXT: Record<State, string> = { yes: 'Yes', no: 'No', na: 'Not applicable', nya: 'Not yet available' };
const MARK: Record<State, string> = { yes: '✓', no: '✕', na: '–', nya: '?' };

export const FacilitiesViewer: Widget = {
  wide: true,
  render: ({ row, entry, page, terms }) => {
    const ds = page.doc.dataStatus ?? {};
    const tiles: HTMLElement[] = [];
    const keys = Object.keys(row.params).filter((k) => k === 'facility' || k.startsWith('facility.'));
    for (const k of keys) {
      const p = simplePredicate(row.params[k]);
      const v = entry.params?.[k]?.[0];
      const state: State | null = v ? (boolValue(v) ? 'yes' : 'no')
        : p && ds.notApplicable?.includes(p) ? 'na' : p && ds.notYetAvailable?.includes(p) ? 'nya' : null;
      if (!state) continue;
      const info = p ? terms?.[p] : undefined;
      const label = info?.label ? info.label[0].toUpperCase() + info.label.slice(1) : humanize(localName(p ?? k));
      tiles.push(h('li', { class: `facility ${state}`, title: info?.comment ?? null },
        h('span', { class: 'facility-mark', 'aria-hidden': 'true' }, MARK[state]),
        h('span', { class: 'facility-label' }, label),
        h('span', { class: 'sr-only' }, `: ${TEXT[state]}`)));
    }
    if (!tiles.some((t) => t.classList.contains('yes') || t.classList.contains('no'))) return null;
    // Available first, then the rest in shape order.
    const rank = (t: HTMLElement) => (t.classList.contains('yes') ? 0 : t.classList.contains('no') ? 1 : 2);
    return h('ul', { class: 'facilities' }, tiles.sort((a, b) => rank(a) - rank(b)));
  },
};
