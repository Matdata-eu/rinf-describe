// rd:StepChartViewer: a profile written value(length),value(length),... (the gradient
// profile of a track) as a step chart along the distance: rising green, falling red.
import { h, s } from '../dom.ts';
import { formatNumber, parseSteps, type Step } from '../format.ts';
import type { Widget } from './types.ts';

const W = 960, H = 220, PAD_L = 44, PAD_R = 12, PAD_T = 12, PAD_B = 28;

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
}

export function chart(steps: Step[], unit: string, lengthUnit: string): SVGElement {
  const total = steps.reduce((a, b) => a + b.length, 0);
  const peak = Math.max(1e-9, ...steps.map((st) => Math.abs(st.value)));
  const x = (d: number) => PAD_L + (d / total) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v + peak) / (2 * peak)) * (H - PAD_T - PAD_B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'step-chart', role: 'img',
    'aria-label': `Profile over ${formatNumber(total)} ${lengthUnit}, from ${formatNumber(-peak)} to ${formatNumber(peak)} ${unit}` });
  // Value axis: zero and the extremes.
  for (const v of [peak, 0, -peak]) {
    svg.append(s('line', { x1: PAD_L, x2: W - PAD_R, y1: y(v), y2: y(v), class: v === 0 ? 'axis zero' : 'axis' }));
    svg.append(s('text', { x: PAD_L - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, `${v > 0 ? '+' : ''}${formatNumber(v)}`));
  }
  // Distance axis.
  const km = lengthUnit === 'm' && total >= 2000;
  const span = km ? total / 1000 : total;
  const every = niceStep(span, 6);
  for (let t = 0; t <= span + 1e-9; t += every) {
    const d = km ? t * 1000 : t;
    svg.append(s('line', { x1: x(d), x2: x(d), y1: H - PAD_B, y2: H - PAD_B + 4, class: 'axis' }));
    svg.append(s('text', { x: x(d), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, `${formatNumber(t)}${t === 0 ? ` ${km ? 'km' : lengthUnit}` : ''}`));
  }
  let at = 0;
  for (const st of steps) {
    const x0 = x(at), x1 = x(at + st.length);
    const top = Math.min(y(st.value), y(0)), height = Math.max(1, Math.abs(y(st.value) - y(0)));
    const cls = st.value > 0 ? 'up' : st.value < 0 ? 'down' : 'flat';
    const bar = s('rect', { x: x0, y: st.value === 0 ? y(0) - 0.75 : top, width: Math.max(0.5, x1 - x0), height: st.value === 0 ? 1.5 : height, class: `bar ${cls}` });
    bar.append(s('title', {}, `${st.value > 0 ? '+' : ''}${formatNumber(st.value)} ${unit} over ${formatNumber(st.length)} ${lengthUnit}, from ${formatNumber(at)} ${lengthUnit}`));
    svg.append(bar);
    at += st.length;
  }
  return svg;
}

export const StepChartViewer: Widget = {
  wide: true,
  render: ({ entry, row }) => {
    const text = entry.values?.[0]?.value;
    if (!text) return null;
    const steps = parseSteps(text);
    if (!steps.length) return h('span', { class: 'lit' }, text);
    const unit = row.unit ?? '';
    const lengthUnit = row.settings.lengthUnit ?? 'm';
    const total = steps.reduce((a, b) => a + b.length, 0);
    const up = Math.max(...steps.map((st) => st.value));
    const down = Math.min(...steps.map((st) => st.value));
    return h('figure', { class: 'step-widget' },
      chart(steps, unit, lengthUnit),
      h('figcaption', { class: 'muted small' },
        `${steps.length} steps over ${formatNumber(total)} ${lengthUnit} · steepest rise ${up > 0 ? '+' : ''}${formatNumber(up)} ${unit} · steepest fall ${formatNumber(down)} ${unit}`),
      h('details', { class: 'wkt' }, h('summary', null, 'Value as published'), h('pre', { class: 'mono' }, text)));
  },
};
