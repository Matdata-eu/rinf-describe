// rd:ValidityViewer: the validity period (era:validity, an era:TemporalFeature, which is a
// time:TemporalDuration with time:hasBeginning / time:hasEnd) as a bar on a time axis.
import { h } from '../dom.ts';
import { formatDate, isOpenEnd } from '../format.ts';
import type { Widget } from './types.ts';

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d);

export type ValidityState = 'valid' | 'future' | 'expired';

export function validityState(begin: string | undefined, end: string | undefined, today = Date.now()): ValidityState {
  if (begin && parse(begin) > today) return 'future';
  if (end && !isOpenEnd(end) && parse(end) + DAY <= today) return 'expired';
  return 'valid';
}

const STATE_TEXT: Record<ValidityState, string> = { valid: 'Valid today', future: 'Not valid yet', expired: 'No longer valid' };

export const ValidityViewer: Widget = {
  wide: false,
  render: ({ entry }) => {
    const begin = entry.params?.begin?.[0]?.value;
    const end = entry.params?.end?.[0]?.value;
    if (!begin && !end) return null;
    const today = Date.now();
    const open = !end || isOpenEnd(end);
    const state = validityState(begin, end, today);
    const b = begin ? parse(begin) : today - 365 * DAY;
    let e: number, lo: number, hi: number;
    if (open && b <= today) {
      // Open-ended and in force: today in the middle, the period running off the right, so a
      // long past does not make it look as if the period nears its end.
      lo = b - 180 * DAY;
      hi = today + (today - lo);
      e = hi;
    } else {
      // Axis: half a year either side of the period and of today; an open end runs off the right.
      e = open ? Math.max(today, b) + 2 * 365 * DAY : parse(end!);
      lo = Math.min(b, today) - 180 * DAY;
      hi = Math.max(e, today) + 180 * DAY;
      if (open) e = hi;
    }
    const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`;
    const text = `${begin ? formatDate(begin) : 'Always'} – ${open ? 'open-ended' : formatDate(end!)}`;
    return h('div', { class: 'validity' },
      h('div', { class: 'validity-head' },
        h('span', { class: `signal ${state === 'valid' ? 'ok' : state === 'future' ? 'warn' : 'bad'}` },
          h('span', { class: 'lamp', 'aria-hidden': 'true' }), STATE_TEXT[state]),
        h('span', { class: 'lit' }, text)),
      h('div', { class: 'timeline', 'aria-hidden': 'true' },
        h('span', { class: `period${open ? ' open' : ''}`, style: `left:${pct(b)};width:calc(${pct(e)} - ${pct(b)})` }),
        h('span', { class: 'today', style: `left:${pct(today)}`, title: `Today, ${formatDate(new Date(today).toISOString().slice(0, 10))}` },
          h('span', { class: 'today-label' }, 'Today'))));
  },
};
