// rd:DataStatusViewer: the parameters a resource marks era:notApplicable or
// era:notYetAvailable, as two collapsible lists. Computed for every class page.
import type { ClassPage, TermInfo } from '../api.ts';
import { h } from '../dom.ts';
import { humanize, localName, prefixed } from '../rdf.ts';

export function dataStatus(page: ClassPage, labels: Record<string, string>, terms: Record<string, TermInfo> = {}): HTMLElement | null {
  const propertyLabel = (iri: string, labels: Record<string, string>) => {
    const l = terms[iri]?.label ?? labels[iri];
    return l ? l[0].toUpperCase() + l.slice(1) : humanize(localName(iri));
  };
  const ds = page.doc.dataStatus ?? {};
  const lists: [string, string, string[]][] = [
    ['Not applicable', 'The infrastructure manager states these parameters do not apply here.', ds.notApplicable ?? []],
    ['Not yet available', 'The infrastructure manager has not published these parameters yet.', ds.notYetAvailable ?? []],
  ];
  if (!lists.some(([, , l]) => l.length)) return null;
  return h('section', { class: 'card data-status', 'aria-labelledby': `ds-${page.shape}` },
    h('h2', { id: `ds-${page.shape}` }, 'Data status'),
    lists.filter(([, , l]) => l.length).map(([title, note, list]) => h('details', null,
      h('summary', null, title, h('span', { class: 'count' }, ` (${list.length})`)),
      h('p', { class: 'muted small' }, note),
      h('ul', { class: 'chips' }, [...list]
        .sort((a, b) => propertyLabel(a, labels).localeCompare(propertyLabel(b, labels)))
        .map((iri) => h('li', { class: 'chip', title: [terms[iri]?.comment, prefixed(iri)].filter(Boolean).join('\n') }, propertyLabel(iri, labels)))))));
}
