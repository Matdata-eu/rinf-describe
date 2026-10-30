// Display text for values: numbers, dates, booleans, units, kilometre positions, aggregates.
import type { Aggregate, Term } from './api.ts';
import { XSD, iriLabel, isNumeric } from './rdf.ts';

const NUM = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatNumber(v: number | string): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? NUM.format(n) : String(v);
}

/** 9999-12-31 and similar far-future dates mean "no end". */
export const isOpenEnd = (d: string) => /^9{4}-/.test(d) || d.startsWith('9999');

export function formatDate(d: string): string {
  const t = Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d);
  return Number.isFinite(t) ? DATE.format(t) : d;
}

export const isBoolean = (t: Term) => t.datatype === XSD + 'boolean';
export const boolValue = (t: Term) => t.value === 'true' || t.value === '1';

/** Plain text of a term: label for IRIs, formatted literal otherwise (no unit). */
export function termText(t: Term, labels: Record<string, string>): string {
  if (t.iri) return iriLabel(t.iri, labels);
  const v = t.value ?? '';
  if (isBoolean(t)) return boolValue(t) ? 'Yes' : 'No';
  if (isNumeric(t.datatype)) return formatNumber(v);
  if (t.datatype === XSD + 'date' || t.datatype === XSD + 'dateTime') return formatDate(v);
  return v;
}

export const withUnit = (text: string, unit?: string | null) => (unit ? `${text} ${unit}` : text);

/** A railway location written km 53+240: kilometric post and metres from it. */
export function formatKm(km?: string | number | null, offset?: string | number | null): string | null {
  if (km === undefined || km === null || km === '') return null;
  const k = Number(km);
  if (!Number.isFinite(k)) return null;
  const o = offset === undefined || offset === null || offset === '' ? null : Number(offset);
  if (o === null || !Number.isFinite(o)) return `km ${formatNumber(k)}`;
  const whole = Math.floor(k + o / 1000 + 1e-9);
  const metres = Math.round((k + o / 1000 - whole) * 1000);
  return Number.isInteger(k) ? `km ${k}+${String(Math.round(o)).padStart(3, '0')}` : `km ${whole}+${String(metres).padStart(3, '0')}`;
}

/** A range summary: "85–140 km/h", or one value when all children agree. */
export function formatRange(a: Aggregate, unit?: string | null): string | null {
  if (a.min === undefined || a.max === undefined) return null;
  const text = a.min === a.max ? formatNumber(a.min) : `${formatNumber(a.min)}–${formatNumber(a.max)}`;
  return withUnit(text, unit);
}

/** "{count} tracks" with the fields of a summary or a value filled in. */
export function fillTemplate(tpl: string, fields: Record<string, string | number | undefined | null>): string | null {
  let missing = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = fields[k];
    if (v === undefined || v === null || v === '') { missing = true; return ''; }
    return typeof v === 'number' ? formatNumber(v) : v;
  });
  return missing ? null : out;
}

/** A gradient-like profile written value(length),value(length),... */
export interface Step { value: number; length: number }
export function parseSteps(text: string): Step[] {
  const out: Step[] = [];
  for (const m of text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*\)/g)) {
    const value = Number(m[1].replace(',', '.'));
    const length = Number(m[2].replace(',', '.'));
    if (Number.isFinite(value) && Number.isFinite(length) && length > 0) out.push({ value, length });
  }
  return out;
}
