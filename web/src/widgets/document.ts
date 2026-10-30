// rd:DocumentViewer: era:Document resources as cards, each with its file type, a link to
// open the file and a link to the document's own page. The fields come from sh:node
// (shape:document-card in common.ttl: url, name).
import { h } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Item } from '../api.ts';
import type { Widget } from './types.ts';

/** "PDF", "XLSX"... from the address, or null. */
export function fileType(url: string): string | null {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(url.trim());
  return m ? m[1].toUpperCase() : null;
}

const fileName = (url: string) => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? url); } catch { return url; }
};
const isWeb = (url: string) => /^https?:\/\//i.test(url.trim());

export const DocumentViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels }) => {
    const items: Item[] = entry.items ?? (entry.values ?? []).filter((v) => v.iri).map((v) => ({ iri: v.iri!, cells: {} }));
    if (!items.length) return null;
    return h('ul', { class: 'documents' }, items.map((it) => {
      const url = it.cells.url?.[0]?.value?.trim() ?? (isWeb(labels[it.iri] ?? '') ? labels[it.iri] : '');
      const name = it.cells.name?.[0]?.value?.trim();
      const type = url ? fileType(url) : null;
      const title = name && name.length > 2 ? name : url ? fileName(url) : iriLabel(it.iri, labels);
      return h('li', { class: 'doc-card' },
        h('span', { class: 'doc-type', 'aria-hidden': 'true' }, type ?? 'DOC'),
        h('span', { class: 'doc-body' },
          h('a', { class: 'doc-title iri-link', href: describeHref(it.iri, env), title: it.iri }, title),
          url ? h('span', { class: 'doc-url mono small muted' }, url) : null),
        url && isWeb(url) ? h('a', { class: 'btn ghost small', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open') : null);
    }));
  },
};
