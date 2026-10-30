// The describe page: header with classes, title, IRI, badges and exports; tabs from the
// class shapes (Overview, Route compatibility, ...) and the generic ones every resource
// has (All properties, Incoming links, Graph).
import { api, type ClassPage, type Config, type DescribeResponse, type RowDef, type Triple, type TriplesResponse } from './api.ts';
import { h, joined } from './dom.ts';
import { formatDate } from './format.ts';
import { badgeText, isEmpty, layout, statusOf, type LaidGroup } from './layout.ts';
import { describeHref } from './nav.ts';
import { RDF_TYPE, helpPredicate, helpText, iriLabel, humanize, localName, prefixed } from './rdf.ts';
import { valueNode } from './widgets/basic.ts';
import { dataStatus } from './widgets/datastatus.ts';
import { dataModelView } from './widgets/datamodel.ts';
import { graphView } from './widgets/graph.ts';
import { widgetFor, type Ctx } from './widgets/index.ts';
import { indexRoots } from './widgets/parameters.ts';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const STATUS_TEXT = { notApplicable: 'Not applicable', notYetAvailable: 'Not yet available' } as const;

interface Tab { key: string; label: string; count?: number; render: () => Node }

/** The row with the ontology's unit where the shape gives none, for itself and its columns. */
function withOntologyUnits(row: RowDef, r: DescribeResponse): RowDef {
  const unit = (x: RowDef) => x.unit ?? (r.terms?.[helpPredicate(x.path) ?? '']?.unit ?? null);
  return { ...row, unit: row.aggregate === 'count' ? row.unit : unit(row), columns: row.columns.map((c) => ({ ...c, unit: unit(c) })) };
}

function ctxFor(row: RowDef, page: ClassPage, r: DescribeResponse): Ctx {
  return { iri: r.iri, env: r.env, labels: r.labels, row: withOntologyUnits(row, r), entry: page.doc.rows[row.settings?.table ?? row.key] ?? {}, page, terms: r.terms, chapters: r.chapters };
}

/** The RINF index roots of the page, for the index shown in the row help. */
function pageRoots(page: ClassPage, r: DescribeResponse): string[] {
  const ps = Object.values(page.doc.rows).flatMap((e) => (e.parameters ?? []).map((x) => x.p));
  return indexRoots(ps, r.terms ?? {});
}

function card(lg: LaidGroup, page: ClassPage, r: DescribeResponse, roots: string[]): HTMLElement | null {
  const parts: Node[] = [];
  let wide = false;
  for (const row of lg.rows) {
    const ctx = ctxFor(row, page, r);
    const entry = ctx.entry;
    const name = row.name ?? humanize(row.key);
    const tip = helpText(r.terms?.[helpPredicate(row.path) ?? ''], row.path, roots);
    if (isEmpty(entry) && !row.settings?.figures) {
      const st = statusOf(row, page);
      if (st) parts.push(h('div', { class: 'row' }, h('dt', { title: tip }, name), h('dd', null, h('span', { class: 'chip status' }, STATUS_TEXT[st]))));
      continue;
    }
    const w = widgetFor(ctx);
    const node = w.render(ctx);
    if (!node) continue;
    if (w.wide) {
      wide = true;
      parts.push(h('div', { class: 'row wide' }, lg.rows.length > 1 || name !== lg.group.label ? h('h3', { class: 'row-title', title: tip }, name) : null, node));
    } else {
      parts.push(h('div', { class: 'row' }, h('dt', { title: tip }, name), h('dd', null, node)));
    }
  }
  if (!parts.length) return null;
  const id = `g-${lg.group.iri || 'other'}`.replace(/[^\w-]+/g, '-');
  return h('section', { class: `card${wide ? ' wide' : ''}`, 'aria-labelledby': id },
    h('h2', { id }, lg.group.label), h('dl', { class: 'rows' }, parts));
}

function hero(page: ClassPage, r: DescribeResponse, rows: ReturnType<typeof layout>['hero']): Node[] {
  return rows.map((row) => {
    const ctx = ctxFor(row, page, r);
    const node = isEmpty(ctx.entry) && !row.settings?.figures ? null : widgetFor(ctx).render(ctx);
    return node ? h('section', { class: `card wide hero hero-${row.key}`, 'aria-label': row.name ?? row.key }, node) : null;
  }).filter((n): n is HTMLElement => !!n);
}

function header(r: DescribeResponse, cfg: Config, badges: string[]): HTMLElement {
  const classLabel = (c: string) => r.pages.find((p) => p.class === c)?.label ?? r.labels[c] ?? humanize(localName(c));
  const classes = [...r.classes].sort((a, b) => Number(!r.pages.some((p) => p.class === a)) - Number(!r.pages.some((p) => p.class === b)));
  const copy = h('button', { class: 'btn ghost small', type: 'button', title: 'Copy the IRI' }, 'Copy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(r.iri); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  const env = cfg.envs.find((e) => e.key === r.env);
  const ds = r.dataset;
  const meta: Node[] = [];
  if (ds) meta.push(h('span', null, 'Data: ', ds.provider || iriLabel(ds.graph, r.labels), ds.graph ? h('span', { class: 'mono small muted' }, ` ${prefixed(ds.graph)}`) : null));
  if (env) meta.push(h('span', null, env.label));
  if (ds?.modified) meta.push(h('span', null, `published ${formatDate(ds.modified)}`));
  const atlas = cfg.atlasUrl && r.pages.length
    ? h('a', { class: 'btn ghost small', href: `${cfg.atlasUrl}/#env=${encodeURIComponent(r.env)}&sel=${encodeURIComponent(r.iri).replace(/%3A/g, ':').replace(/%2F/g, '/')}`, target: '_blank', rel: 'noopener' }, 'Open in RINF Atlas')
    : null;
  const exports = r.counts.out
    ? h('details', { class: 'menu' },
      h('summary', { class: 'btn ghost small' }, 'Export'),
      h('div', { class: 'menu-items', role: 'menu' },
        ([['ttl', 'Turtle'], ['nt', 'N-Triples'], ['csv', 'CSV']] as const).map(([f, label]) =>
          h('a', { role: 'menuitem', href: api.exportUrl(r.iri, r.env, f), download: '' }, label))))
    : null;
  return h('header', { class: 'page-head' },
    h('div', { class: 'classes' }, classes.map((c) => h('span', { class: `class-pill${r.pages.some((p) => p.class === c) ? '' : ' quiet'}`, title: c }, classLabel(c)))),
    h('h1', null, r.title ?? iriLabel(r.iri, r.labels)),
    h('div', { class: 'iri-line' }, h('a', { class: 'mono iri', href: r.iri, rel: 'noopener', target: '_blank', title: 'Open the IRI' }, r.iri), copy, atlas, exports),
    badges.length ? h('ul', { class: 'badges', 'aria-label': 'Key information' }, badges.map((b) => h('li', { class: 'badge' }, b))) : null,
    meta.length ? h('p', { class: 'meta muted small' }, joined(meta)) : null);
}

function propertyName(p: string, labels: Record<string, string>): string {
  if (p === RDF_TYPE) return 'Type';
  if (p === RDFS_LABEL) return 'Label';
  const l = labels[p];
  return l ? l[0].toUpperCase() + l.slice(1) : humanize(localName(p));
}

function triplesTable(res: TriplesResponse, env: string): Node {
  if (!res.triples.length) return h('p', { class: 'muted' }, res.dir === 'out' ? 'No properties.' : 'No other resource links to this one.');
  const by = new Map<string, Triple[]>();
  for (const t of res.triples) {
    if (!by.has(t.p)) by.set(t.p, []);
    by.get(t.p)!.push(t);
  }
  const order = [...by.keys()].sort((a, b) => Number(b === RDF_TYPE) - Number(a === RDF_TYPE) || Number(b === RDFS_LABEL) - Number(a === RDFS_LABEL)
    || propertyName(a, res.labels).localeCompare(propertyName(b, res.labels)));
  const term = (t: Triple) => res.dir === 'in'
    ? valueNode({ iri: t.s }, env, res.labels)
    : valueNode(t.o_iri ? { iri: t.o } : { value: t.o, datatype: t.datatype ?? undefined, lang: t.lang ?? undefined }, env, res.labels);
  const prop = (p: string) => h('th', { scope: 'row' }, h('span', { class: 'prop' }, propertyName(p, res.labels)), h('span', { class: 'mono small muted curie' }, prefixed(p)));
  const values = (p: string) => h('td', null, h('ul', { class: 'plain' }, by.get(p)!.map((t) => h('li', null, term(t)))));
  // Incoming links read as triples: the resources linking here, then the property.
  const incoming = res.dir === 'in';
  return h('div', { class: 'table-wrap' },
    h('table', { class: `triples${incoming ? ' incoming' : ''}` },
      h('thead', null, h('tr', null, incoming
        ? [h('th', { scope: 'col' }, 'Linked from'), h('th', { scope: 'col' }, 'Property')]
        : [h('th', { scope: 'col' }, 'Property'), h('th', { scope: 'col' }, 'Value')])),
      h('tbody', null, order.map((p) => h('tr', null, incoming ? [values(p), prop(p)] : [prop(p), values(p)])))));
}

function lazyTriples(iri: string, env: string, dir: 'out' | 'in'): Node {
  const box = h('div', { class: 'card wide' }, h('p', { class: 'muted' }, 'Loading…'));
  api.triples(iri, env, dir).then((res) => {
    const parts: Node[] = [];
    parts.push(triplesTable(res, env));
    if (res.truncated) parts.push(h('p', { class: 'muted small' }, `Showing the first ${res.triples.length}. Export for all of them.`));
    box.replaceChildren(...parts);
  }).catch((e) => box.replaceChildren(h('p', { class: 'error' }, `Could not load: ${e.message ?? e}`)));
  return box;
}

export function describePage(r: DescribeResponse, cfg: Config, wantTab: string | null, onTab: (key: string) => void): HTMLElement {
  const tabs: Tab[] = [];
  const badges: string[] = [];
  const overview: Node[] = [];
  for (const page of r.pages) {
    const lay = layout(page);
    for (const b of lay.badges) {
      const t = badgeText(b, page.doc.rows[b.key], r.labels);
      if (t && !badges.includes(t)) badges.push(t);
    }
    for (const t of lay.tabs) {
      const roots = pageRoots(page, r);
      const cards = t.groups.map((g) => card(g, page, r, roots)).filter((c): c is HTMLElement => !!c);
      if (t.key === 'overview') {
        overview.push(...hero(page, r, lay.hero), ...cards);
        const st = dataStatus(page, r.labels, r.terms);
        if (st) overview.push(st);
      } else if (cards.length) {
        const existing = tabs.find((x) => x.key === t.key);
        if (existing) { const prev = existing.render; existing.render = () => h('div', { class: 'cards' }, prev(), cards); }
        else tabs.push({ key: t.key, label: t.label, render: () => h('div', { class: 'cards' }, cards) });
      }
    }
  }
  if (overview.length) tabs.unshift({ key: 'overview', label: 'Overview', render: () => h('div', { class: 'cards' }, overview) });
  tabs.push({ key: 'properties', label: 'All properties', count: r.source !== 'missing' ? r.counts.out : undefined, render: () => lazyTriples(r.iri, r.env, 'out') });
  tabs.push({ key: 'incoming', label: 'Incoming links', count: r.source !== 'missing' ? r.counts.in : undefined, render: () => lazyTriples(r.iri, r.env, 'in') });
  tabs.push({ key: 'graph', label: 'Graph', render: () => graphView(r.iri, r.env) });
  if (r.classes.length) tabs.push({ key: 'model', label: 'Data model', render: () => dataModelView(r.iri, r.env) });

  let current = tabs.find((t) => t.key === wantTab) ?? tabs[0];
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });
  const buttons = tabs.map((t) => {
    const b = h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${t.key}`, 'aria-controls': 'tab-panel' },
      t.label, t.count !== undefined ? h('span', { class: 'tab-count' }, String(t.count)) : null);
    b.addEventListener('click', () => select(t, true));
    b.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) { e.preventDefault(); select(next, true); buttons[tabs.indexOf(next)].focus(); }
    });
    return b;
  });
  bar.append(...buttons);
  panel.id = 'tab-panel';
  const rendered = new Map<string, Node>();
  function select(t: Tab, user: boolean) {
    current = t;
    buttons.forEach((b, i) => { b.setAttribute('aria-selected', String(tabs[i] === t)); b.tabIndex = tabs[i] === t ? 0 : -1; });
    panel.setAttribute('aria-labelledby', `tab-${t.key}`);
    if (!rendered.has(t.key)) rendered.set(t.key, t.render());
    panel.replaceChildren(rendered.get(t.key)!);
    if (user) onTab(t.key);
  }
  select(current, false);

  const notes: Node[] = [];
  if (r.source === 'missing') notes.push(h('p', { class: 'note' }, 'ERA\'s data holds nothing about this IRI in this environment.'));
  else if (!r.pages.length && r.classes.length) notes.push(h('p', { class: 'note muted' }, 'No describe shape for this class yet: All properties lists everything known about it.'));

  return h('article', { class: 'page' }, header(r, cfg, badges), notes, bar, panel);
}

export function backLink(href = '/'): Node {
  return h('a', { class: 'btn ghost small', href, 'data-nav': true }, 'Back to search');
}

export { describeHref };
