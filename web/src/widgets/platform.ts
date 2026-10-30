// rd:PlatformViewer: a side-on sketch of a platform edge: its height above the rail against
// the TSI heights of 550 mm and 760 mm, its usable length, and a mark when it is curved.
// Paths: rd:height (a platform height concept, labelled in mm), rd:length (m), rd:curved.
import { h, s } from '../dom.ts';
import { boolValue, formatNumber } from '../format.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

/** Millimetres from a platform height label ("550", "760 mm"); null for ranges and words. */
export function heightMm(label: string | undefined): number | null {
  const m = label ? /^\s*(\d{2,4})\s*(mm)?\s*$/.exec(label) : null;
  return m ? Number(m[1]) : null;
}

export const PlatformViewer: Widget = {
  wide: true,
  render: ({ entry, labels }) => {
    const p = entry.params ?? {};
    const hTerm = p.height?.[0];
    const label = hTerm ? (hTerm.iri ? iriLabel(hTerm.iri, labels) : hTerm.value) : undefined;
    const mm = heightMm(label);
    const length = p.length?.[0]?.value ? Number(p.length[0].value) : null;
    const curved = p.curved?.[0] ? boolValue(p.curved[0]) : null;
    if (mm === null && length === null) return null;
    const W = 640, H = 230, rail = 196, scale = 0.2; // px per mm of height, not to scale with the length
    const top = mm !== null ? rail - Math.min(mm, 950) * scale : rail - 80;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'platform-svg', role: 'img',
      'aria-label': `Platform${mm !== null ? ` ${mm} mm above the rail` : ''}${length ? `, ${formatNumber(length)} m usable` : ''}${curved ? ', curved' : ''}` });
    // Rail and sleepers.
    svg.append(s('path', { d: `M20 ${rail}H${W - 20}`, class: 'pf-rail' }));
    for (let x = 30; x < W - 20; x += 22) svg.append(s('path', { d: `M${x} ${rail + 4}h12`, class: 'pf-sleeper' }));
    // TSI reference heights.
    for (const [ref, name] of [[550, '550 mm'], [760, '760 mm']] as const) {
      const y = rail - ref * scale;
      svg.append(s('path', { d: `M20 ${y}H${W - 20}`, class: `pf-ref${mm === ref ? ' hit' : ''}` }));
      svg.append(s('text', { x: W - 22, y: y - 4, class: 'pf-ref-text', 'text-anchor': 'end' }, `TSI ${name}`));
    }
    // The platform: a block from its height down to the rail, curved edge when it is curved.
    const x0 = 70, x1 = W - 120;
    const edge = curved ? `Q${(x0 + x1) / 2} ${top + 10} ${x1} ${top}` : `L${x1} ${top}`;
    svg.append(s('path', { d: `M${x0} ${rail}L${x0} ${top}${edge}L${x1} ${rail}Z`, class: `pf-block${mm === null ? ' unknown' : ''}` }));
    svg.append(s('text', { x: (x0 + x1) / 2, y: (top + rail) / 2 + 5, class: 'pf-text', 'text-anchor': 'middle' },
      `${mm !== null ? `${mm} mm` : label ?? 'Height unknown'}${length ? ` · ${formatNumber(length)} m usable` : ''}${curved ? ' · curved' : ''}`));
    return h('figure', { class: 'platform-sketch' }, svg,
      h('figcaption', { class: 'muted small' }, 'Side view, height to scale against the TSI platform heights; length not to scale.'));
  },
};
