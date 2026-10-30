// rd:ScaleBarViewer: a length as a bar against reference marks (a 400 m passenger train, a
// 740 m freight train: rd:marks "400 Passenger train; 740 Freight train"), or a min–max
// range on a scale (rd:min, rd:max; rd:scale "4 7" fixes the ends). Not to scale otherwise.
import { h } from '../dom.ts';
import { formatNumber, withUnit } from '../format.ts';
import type { Widget } from './types.ts';

export interface Mark { value: number; label: string }

export function parseMarks(text: string | undefined): Mark[] {
  return (text ?? '').split(';').map((m) => /^\s*([\d.]+)\s*(.*?)\s*$/.exec(m)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ value: Number(m[1]), label: m[2] || m[1] })).filter((m) => Number.isFinite(m.value));
}

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const ScaleBarViewer: Widget = {
  render: ({ row, entry }) => {
    const unit = row.unit;
    const value = num(entry.values?.[0]?.value);
    const lo = num(entry.params?.min?.[0]?.value);
    const hi = num(entry.params?.max?.[0]?.value);
    const marks = parseMarks(row.settings.marks);
    const fixed = (row.settings.scale ?? '').split(/\s+/).map(Number).filter(Number.isFinite);
    const isRange = value === null && (lo !== null || hi !== null);
    if (value === null && !isRange) return null;
    const top = Math.max(value ?? 0, hi ?? lo ?? 0, ...marks.map((m) => m.value));
    const [s0, s1] = fixed.length === 2 ? fixed : [isRange ? Math.min(lo ?? hi!, ...marks.map((m) => m.value)) * 0.9 : 0, top * 1.08 || 1];
    const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - s0) / (s1 - s0)) * 100)).toFixed(2)}%`;
    const text = isRange
      ? withUnit(lo !== null && hi !== null ? `${formatNumber(lo)}–${formatNumber(hi)}` : formatNumber((lo ?? hi)!), unit)
      : withUnit(formatNumber(value!), unit);
    const bar = isRange
      ? h('span', { class: 'scale-fill range', style: `left:${pct(lo ?? hi!)};width:calc(${pct(hi ?? lo!)} - ${pct(lo ?? hi!)} + 3px)` })
      : h('span', { class: 'scale-fill', style: `width:${pct(value!)}` });
    return h('div', { class: 'scalebar' },
      h('span', { class: 'lit scale-value' }, text),
      h('div', { class: 'scale-track', role: 'img', 'aria-label': `${text}${marks.length ? `, against ${marks.map((m) => withUnit(formatNumber(m.value), unit) + ' ' + m.label).join(', ')}` : ''}` },
        bar,
        marks.map((m) => h('span', { class: `scale-mark${(value ?? hi ?? 0) >= m.value ? ' reached' : ''}`, style: `left:${pct(m.value)}`, title: `${withUnit(formatNumber(m.value), unit)} ${m.label}` },
          h('span', { class: 'scale-mark-label small' }, m.label)))));
  },
};
