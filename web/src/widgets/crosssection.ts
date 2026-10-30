// rd:CrossSectionViewer: a track seen end-on, not to scale: the rails at their gauge, the
// gauging profile as an outline above them, the contact wire between its lowest and highest
// height, and the rail inclination. Paths: rd:gauge, rd:loadingGauge, rd:wireMin, rd:wireMax
// (m), rd:inclination.
import type { Term } from '../api.ts';
import { h, s } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import type { Widget } from './types.ts';

export const CrossSectionViewer: Widget = {
  wide: true,
  render: ({ entry, labels }) => {
    const p = entry.params ?? {};
    const text = (t: Term[] | undefined) => (t?.length ? t.map((v) => termText(v, labels)).join(' · ') : null);
    const gauge = text(p.gauge), profile = text(p.loadingGauge), incl = text(p.inclination);
    const wmin = Number(p.wireMin?.[0]?.value), wmax = Number(p.wireMax?.[0]?.value);
    const wire = Number.isFinite(wmin) || Number.isFinite(wmax);
    if (!gauge && !profile && !wire && !incl) return null;
    const W = 420, H = 300, cx = 210, rail = 262;
    const y0 = wire ? 0 : 66; // without a contact wire, no room above the profile
    const svg = s('svg', { viewBox: `0 ${y0} ${W} ${H - y0}`, class: 'xs-svg', role: 'img', 'aria-label': 'Cross-section of the track, not to scale' });
    // Ballast, sleeper and rails.
    svg.append(s('path', { d: `M60 ${rail + 26}L100 ${rail + 6}H320L360 ${rail + 26}Z`, class: 'xs-ballast' }));
    svg.append(s('rect', { x: 110, y: rail - 2, width: 200, height: 8, class: 'xs-sleeper' }));
    for (const rx of [150, 270]) svg.append(s('rect', { x: rx - 6, y: rail - 14, width: 12, height: 12, class: 'xs-rail' }));
    if (gauge) {
      svg.append(s('path', { d: `M150 ${rail - 22}H270M150 ${rail - 26}v8M270 ${rail - 26}v8`, class: 'xs-measure' }));
      svg.append(s('text', { x: cx, y: rail - 28, class: 'xs-text', 'text-anchor': 'middle' }, gauge));
    }
    // The gauging profile: the space vehicles may take.
    svg.append(s('path', { d: `M112 ${rail - 40}V120Q112 86 146 80H274Q308 86 308 120V${rail - 40}`, class: profile ? 'xs-profile' : 'xs-profile unknown' }));
    if (profile) svg.append(s('text', { x: cx, y: 150, class: 'xs-text strong', 'text-anchor': 'middle' }, profile));
    if (wire) {
      const lo = Number.isFinite(wmin) ? wmin : wmax, hi = Number.isFinite(wmax) ? wmax : wmin;
      svg.append(s('rect', { x: 120, y: 34, width: 180, height: 22, class: 'xs-wire-band' }));
      svg.append(s('path', { d: 'M120 45H300', class: 'xs-wire' }));
      svg.append(s('text', { x: 312, y: 50, class: 'xs-text' }, lo === hi ? `${formatNumber(lo)} m` : `${formatNumber(lo)}–${formatNumber(hi)} m`));
      svg.append(s('text', { x: 312, y: 36, class: 'xs-text muted' }, 'contact wire'));
    }
    if (incl) svg.append(s('text', { x: 300, y: rail - 2, class: 'xs-text muted' }, `rails ${incl}`));
    return h('figure', { class: 'cross-section' }, svg,
      h('figcaption', { class: 'muted small' }, 'Not to scale.'));
  },
};
