// IRIs, prefixes and the display text of RDF terms.
import type { Term, TermInfo } from './api.ts';

export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const DASH = 'http://datashapes.org/dash#';
export const RD = 'https://rinf-describe.matdata.eu/ns#';

export const PREFIXES: Record<string, string> = {
  era: 'http://data.europa.eu/949/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  gsp: 'http://www.opengis.net/ont/geosparql#',
  time: 'http://www.w3.org/2006/time#',
  dcterms: 'http://purl.org/dc/terms/',
  xsd: XSD,
  owl: 'http://www.w3.org/2002/07/owl#',
  country: 'http://publications.europa.eu/resource/authority/country/',
};

// Longest namespace first so era: does not shadow a more specific one.
const ORDERED = Object.entries(PREFIXES).sort((a, b) => b[1].length - a[1].length);

/** prefix:local (local may contain '/'), else the IRI unchanged. */
export function prefixed(iri: string): string {
  for (const [p, ns] of ORDERED) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (/^[\w./-]*$/.test(local)) return `${p}:${local}`;
    }
  }
  return iri;
}

/** Last segment of an IRI. */
export function localName(iri: string): string {
  const m = iri.replace(/[/#]+$/, '').match(/[^/#]+$/);
  return m ? m[0] : iri;
}

/** "maximumAltitude" -> "Maximum altitude": a readable name for a property without a label. */
export function humanize(local: string): string {
  const words = local
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1).replace(/\b([A-Z])([a-z]+)\b/g, (_, a: string, b: string) => a.toLowerCase() + b) : local;
}

/** The label to show for an IRI: its label when known, else a readable form of the IRI. */
export function iriLabel(iri: string, labels: Record<string, string>): string {
  const l = labels[iri];
  if (l) return stripValidity(l);
  const p = prefixed(iri);
  // A concept without its label: scheme and code ("nominal-track-gauges 30") beat a bare number.
  const concept = /^era:concepts\/([^/]+)\/(.+)$/.exec(p);
  if (concept) return `${concept[1].replace(/-/g, ' ')} ${concept[2]}`;
  return p !== iri && !p.slice(p.indexOf(':') + 1).includes('/') ? p : localName(iri);
}

/** Some providers append "(from YYYY-MM-DD until YYYY-MM-DD)" to labels; the validity widget shows it. */
export function stripValidity(label: string): string {
  return label.replace(/\s*\(from \d{4}-\d{2}-\d{2} until \d{4}-\d{2}-\d{2}\)$/, '');
}

export const isNumeric = (dt?: string | null) =>
  !!dt && /#(integer|int|long|short|byte|decimal|double|float|nonNegativeInteger|positiveInteger|unsignedInt)$/.test(dt);

export const termKey = (t: Term) => t.iri ?? `${t.value}|${t.datatype ?? ''}|${t.lang ?? ''}`;

/** A SPARQL property path with its IRIs as prefixed names. */
export function pathText(p: string): string {
  return p.replace(/<([^>]+)>/g, (_, iri: string) => prefixed(iri));
}

/** The predicate of a one-step path ("<http://...>"), else null. */
export function simplePredicate(path: string | null): string | null {
  const m = path ? /^<([^>]+)>$/.exec(path.trim()) : null;
  return m ? m[1] : null;
}

/** The property a row is about, for its help text: the predicate of a one-step path, or the
 * last one of a plain sequence (( era:contactLineSystem era:contactLineSystemType )). */
export function helpPredicate(path: string | null): string | null {
  if (!path) return null;
  const p = path.trim().replace(/^\((.*)\)$/, '$1');
  const m = /^(?:<[^>]+>\/)*<([^>]+)>$/.exec(p);
  return m ? m[1] : null;
}

/** RINF index of a property under one of the roots ("1.1.1"), else its first. */
export function indexUnder(index: string[] | undefined, roots: string[]): string | null {
  if (!index?.length) return null;
  for (const r of roots) {
    const hit = index.find((ix) => ix.startsWith(r + '.'));
    if (hit) return hit;
  }
  return index[0];
}

/** Tooltip of a row: the property's definition and RINF index, then its path. */
export function helpText(info: TermInfo | undefined, path: string | null, roots: string[] = []): string | null {
  const parts: string[] = [];
  if (info?.comment) parts.push(info.comment);
  const ix = indexUnder(info?.index, roots);
  if (ix) parts.push(`RINF ${ix}`);
  if (path) parts.push(pathText(path));
  return parts.length ? parts.join('\n') : null;
}
