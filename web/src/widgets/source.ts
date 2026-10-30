// The "RDF" tab: the resource's own triples as Turtle, RDF/XML, JSON-LD or N-Triples, to read,
// copy or download. IRIs in the text open their describe page.
import { api, type ExportFormat } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h } from '../dom.ts';
import { describeHref } from '../nav.ts';

/** The RDF serialisations: format, menu label, file extension. */
export const RDF_FORMATS: [ExportFormat, string, string][] = [
  ['ttl', 'Turtle', 'ttl'], ['rdf', 'RDF/XML', 'rdf'], ['jsonld', 'JSON-LD', 'jsonld'], ['nt', 'N-Triples', 'nt'],
];
const KEY = 'describe.rdfFormat';

type Kind = 'comment' | 'string' | 'iri' | 'keyword' | 'name' | 'tag' | 'attr' | 'key';
type Token = [Kind | null, string];

const TURTLE = /(#[^\n]*)|("(?:[^"\\\n]|\\.)*")|(<[^>\s]*>)|(@prefix|@base|\ba\b(?=\s))|((?:[A-Za-z][\w-]*)?:[\w-]*|\^\^|@[a-zA-Z-]+)/g;
const XML = /(<\?[^?]*\?>)|(<\/?[\w:.-]+|\/?>)|(\s[\w:.-]+=)|("[^"]*")/g;
const JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)?/g;

/** Split a serialisation into highlighted pieces. */
export function tokens(text: string, format: ExportFormat): Token[] {
  const out: Token[] = [];
  let last = 0;
  const re = format === 'rdf' ? XML : format === 'jsonld' ? JSON_RE : TURTLE;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push([null, text.slice(last, m.index)]);
    let kind: Kind;
    if (format === 'rdf') kind = m[1] ? 'comment' : m[2] ? 'tag' : m[3] ? 'attr' : 'string';
    else if (format === 'jsonld') kind = m[2] ? 'key' : 'string';
    else kind = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'iri' : m[4] ? 'keyword' : 'name';
    if (format === 'jsonld' && m[2]) { out.push(['key', m[1]], [null, m[2]]); }
    else out.push([kind, m[0]]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}

/** The IRI a token stands for when it is a whole one: <iri> or "iri". */
function iriOf(kind: Kind | null, text: string): string | null {
  if (kind !== 'iri' && kind !== 'string') return null;
  const inner = text.slice(1, -1);
  return /^https?:\/\/[^\s"<>]+$/.test(inner) ? inner : null;
}

function highlighted(text: string, format: ExportFormat, env: string): Node[] {
  return tokens(text, format).map(([kind, t]) => {
    if (!kind) return document.createTextNode(t);
    const iri = iriOf(kind, t);
    if (iri) return h('a', { class: `tok-${kind}`, href: describeHref(iri, env) }, t);
    return h('span', { class: `tok-${kind}` }, t);
  });
}

export function rdfView(iri: string, env: string): HTMLElement {
  let format: ExportFormat = 'ttl';
  try { const f = localStorage.getItem(KEY); if (RDF_FORMATS.some(([k]) => k === f)) format = f as ExportFormat; } catch { /* private mode */ }
  let disposed = false;
  onDispose(() => { disposed = true; });
  const texts = new Map<ExportFormat, Promise<string>>();
  const code = h('code', { class: 'rdf-code' });
  const pre = h('pre', { class: 'rdf-src', tabindex: 0, 'aria-label': 'RDF of this resource' }, code);
  const note = h('p', { class: 'muted small' });
  const buttons = RDF_FORMATS.map(([f, label]) => {
    const b = h('button', { class: 'seg-btn', type: 'button' }, label);
    b.addEventListener('click', () => { format = f; try { localStorage.setItem(KEY, f); } catch { /* private mode */ } show(); });
    return [f, b] as const;
  });
  const copy = h('button', { class: 'btn ghost small', type: 'button' }, 'Copy');
  const dl = h('a', { class: 'btn ghost small', download: '' }, 'Download');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(await texts.get(format)!); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  const show = () => {
    for (const [f, b] of buttons) b.setAttribute('aria-pressed', String(f === format));
    dl.setAttribute('href', api.exportUrl(iri, env, format));
    if (!texts.has(format)) texts.set(format, api.exportText(iri, env, format));
    const want = format;
    code.replaceChildren('Loading…');
    texts.get(format)!.then((text) => {
      if (disposed || want !== format) return;
      code.replaceChildren(...highlighted(text, format, env));
      const lines = text.split('\n').length;
      note.textContent = `The resource’s own triples, ${lines.toLocaleString('en')} lines. IRIs open their describe page.`;
    }).catch((e: Error) => {
      texts.delete(want);
      if (!disposed && want === format) code.replaceChildren(`Could not load: ${e.message}`);
    });
  };
  show();
  return h('div', { class: 'card wide rdf-card' },
    h('div', { class: 'uml-head' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Format' }, buttons.map(([, b]) => b)),
      h('div', { class: 'uml-tools' }, copy, dl)),
    note, pre);
}
