// rd:SymbolViewer: an illustrative, non-dimensioned symbol next to each value's label
// (rd:symbol "loading-gauge" for gauging profiles, "track-gauge" for the track gauge,
// "country" for a country's flag, "platform-height" for a platform beside a rail at its height,
// "direction" for the normal running direction against the kilometres, "energy-supply" for
// the voltage and frequency in OpenRailwayMap's colours).
import type { Term } from '../api.ts';
import { h, s } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import { termText } from '../format.ts';
import { heightMm } from './platform.ts';
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

// EU authority country codes (ISO 3166-1 alpha-3) of the RINF countries and their neighbours.
const ISO2: Record<string, string> = {
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR',
  DEU: 'DE', GRC: 'GR', HUN: 'HU', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL',
  POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE', NOR: 'NO', CHE: 'CH', LIE: 'LI',
  ISL: 'IS', GBR: 'GB', MNE: 'ME', MKD: 'MK', SRB: 'RS', ALB: 'AL', BIH: 'BA', UKR: 'UA', MDA: 'MD', BLR: 'BY',
  RUS: 'RU', TUR: 'TR', AND: 'AD', MCO: 'MC', SMR: 'SM', XKX: 'XK', GEO: 'GE', ARM: 'AM',
};

/** The country's two-letter code from its EU authority IRI (.../country/SWE). */
export function countryCode(iri: string | undefined): string | null {
  const m = iri ? /\/country\/([A-Z]{3})$/.exec(iri) : null;
  return m ? ISO2[m[1]] ?? null : null;
}

function country(v: Term): Node {
  const code = countryCode(v.iri);
  // A flag emoji: two regional indicator letters (systems without flag emoji show the letters).
  const flag = code ? [...code].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('') : '🏳';
  return h('span', { class: 'symbol flag', 'aria-hidden': 'true' }, flag);
}

function platformHeight(v: Term, labels: Record<string, string>): SVGElement {
  // A platform beside a rail end-on, drawn as high as the label says (in mm), up to 1000 mm.
  const mm = heightMm(v.iri ? iriLabel(v.iri, labels) : v.value);
  const top = 58 - Math.min(1000, mm ?? 400) * 0.04;
  return s('svg', { viewBox: '0 0 64 72', class: 'symbol', 'aria-hidden': 'true' },
    s('path', { d: 'M4 62h56', class: 'base' }),
    s('path', { d: 'M42 52h6v6h-6z', class: 'rail-head' }),
    s('path', { d: `M6 62V${top.toFixed(1)}h28V62`, class: mm === null ? 'outline dashed' : 'outline' }));
}

/** The way a track is normally run, against the direction of its kilometres: N(ormal),
 * O(pposite) or B(oth) (era:trackDirection, track-running-directions/10, 20, 30). */
export function directionOf(v: Term, labels: Record<string, string>): 'normal' | 'opposite' | 'both' | null {
  // Also a signal's orientation: orientations/00 Normal, 01 Opposite.
  const l = (v.iri ? labels[v.iri] ?? '' : v.value ?? '').trim().toUpperCase();
  const code = v.iri?.match(/\/(track-running-directions\/(?:TrackRunningDirections\/)?(10|20|30)|orientations\/(00|01))$/);
  const c = code?.[2] ?? code?.[3];
  if (l === 'N' || l === 'NORMAL' || c === '10' || c === '00') return 'normal';
  if (l === 'O' || l === 'OPPOSITE' || c === '20' || c === '01') return 'opposite';
  if (l === 'B' || l === 'BOTH' || c === '30') return 'both';
  return null;
}

function direction(v: Term, labels: Record<string, string>): SVGElement {
  // An arrow along the kilometres (left to right), against them, or both ways.
  const d = directionOf(v, labels);
  const head = (x: number, dir: 1 | -1) => `M${x} 36l${-10 * dir} -8M${x} 36l${-10 * dir} 8`;
  const path = ['M8 36H56', d !== 'opposite' ? head(56, 1) : '', d === 'opposite' || d === 'both' ? head(8, -1) : ''].join('');
  return s('svg', { viewBox: '0 0 64 72', class: 'symbol', 'aria-hidden': 'true' },
    s('path', { d: 'M6 52h52', class: 'base' }),
    s('path', { d: path, class: d ? 'outline' : 'outline dashed' }));
}

/** Current, voltage and frequency of an energy supply system label ("AC 25kV-50Hz", "DC 750V"). */
export function supplyOf(label: string): { ac: boolean; volts: number; hz: number | null } | null {
  const m = /^\s*(AC|DC)\s*([\d.]+)\s*(k?)V(?:\s*-\s*([\d.]+)\s*Hz)?/i.exec(label);
  if (!m) return null;
  return { ac: m[1].toUpperCase() === 'AC', volts: Number(m[2]) * (m[3] ? 1000 : 1), hz: m[4] ? Number(m[4]) : null };
}

/** The colour OpenRailwayMap draws an energy supply system with. */
export function supplyColor(sup: { ac: boolean; volts: number; hz: number | null } | null): string {
  if (!sup) return 'var(--line-strong)';
  if (sup.ac) return sup.hz !== null && sup.hz < 20 ? '#2e8b3e' : '#c4262e';
  if (sup.volts >= 3000) return '#1f5fbf';
  if (sup.volts >= 1500) return '#8a3fb5';
  return '#e07a10';
}

function energySupply(v: Term, labels: Record<string, string>): SVGElement {
  // A bolt in the system's map colour, ~ for alternating current.
  const sup = supplyOf(v.iri ? iriLabel(v.iri, labels) : v.value ?? '');
  return s('svg', { viewBox: '0 0 64 72', class: 'symbol', 'aria-hidden': 'true' },
    s('circle', { cx: 32, cy: 34, r: 24, style: `fill:${supplyColor(sup)}` }),
    s('path', { d: 'M35 14L22 38h10l-4 20 14-26H32z', style: 'fill:#fff' }),
    sup?.ac ? s('path', { d: 'M18 64q4-5 8 0t8 0 8 0 8 0', class: 'outline' }) : s('path', { d: 'M18 64h28', class: 'outline' }));
}

const SYMBOLS: Record<string, (v: Term, labels: Record<string, string>) => Node> = {
  'loading-gauge': loadingGauge, 'track-gauge': trackGauge, country, 'platform-height': platformHeight, direction,
  'energy-supply': energySupply,
};

export const SymbolViewer: Widget = {
  render: ({ entry, env, labels, row }) => {
    const values = entry.values ?? [];
    if (!values.length) return null;
    const draw = SYMBOLS[row.settings.symbol ?? ''] ?? loadingGauge;
    return h('div', { class: 'symbols' }, values.map((v) => h('figure', { class: 'symbol-tile' },
      draw(v, labels),
      h('figcaption', null, v.iri
        ? h('a', { class: 'iri-link', href: describeHref(v.iri, env), title: v.iri }, iriLabel(v.iri, labels))
        : termText(v, labels)))));
  },
};
