// rd:GraphViewer: the neighbourhood of a resource, read from ERA's endpoint, drawn in the
// design system's graph grammar: resources as rings, classes as solid pills, literals
// as square plates, the resource itself highlighted. A click on a resource opens its page.
import type { Edge, Node, Options } from 'vis-network/standalone';
import { api, type Triple } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h } from '../dom.ts';
import { termText } from '../format.ts';
import { describeHref, navigate } from '../nav.ts';
import { RDF_TYPE, iriLabel, prefixed } from '../rdf.ts';
import { offThemeChange, onThemeChange } from '../theme.ts';

const truncate = (t: string, n = 32) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function graphView(iri: string, env: string): HTMLElement {
  const box = h('div', { class: 'graph', role: 'region', 'aria-label': 'Graph of linked resources' });
  const note = h('p', { class: 'muted small' }, 'Loading the graph…');
  const wrap = h('div', { class: 'card graph-card' }, note, box);
  let disposed = false;
  let destroy = () => {};
  onDispose(() => { disposed = true; destroy(); });

  Promise.all([api.graph(iri, env), import('vis-network/standalone')]).then(([g, vis]) => {
    if (disposed) return;
    const nodes = new vis.DataSet<Node & { kind: string; href?: string }>();
    const edges = new vis.DataSet<Edge>();
    const colors = () => ({
      surface: css('--surface'), text: css('--text'), muted: css('--muted'),
      brand: css('--accent-strong'), onBrand: css('--on-accent'), edge: css('--line-strong'), signal: css('--signal'),
    });
    let c = colors();
    const resource = (id: string, root = false) => ({
      shape: 'box', shapeProperties: { borderRadius: 14 }, borderWidth: root ? 3 : 1.5,
      color: { background: c.surface, border: root ? c.signal : c.brand, highlight: { background: c.surface, border: c.signal }, hover: { background: c.surface, border: c.signal } },
      font: { color: c.brand, size: 13, face: 'IBM Plex Sans' }, margin: { top: 6, bottom: 6, left: 10, right: 10 },
      title: id,
    });
    const klass = () => ({
      shape: 'box', shapeProperties: { borderRadius: 14 }, borderWidth: 0,
      color: { background: c.brand, border: c.brand, highlight: { background: c.brand, border: c.signal } },
      font: { color: c.onBrand, size: 12, face: 'IBM Plex Sans' }, margin: { top: 5, bottom: 5, left: 10, right: 10 },
    });
    const literal = () => ({
      shape: 'box', shapeProperties: { borderRadius: 2 }, borderWidth: 1,
      color: { background: c.surface, border: c.text, highlight: { background: c.surface, border: c.signal } },
      font: { color: c.text, size: 12, face: 'IBM Plex Mono' }, margin: { top: 5, bottom: 5, left: 8, right: 8 },
    });
    const addIri = (id: string, root = false) => {
      if (nodes.get(id)) return;
      const isClass = Object.values(g.types).some((ts) => ts.includes(id)) && !g.types[id];
      nodes.add({ id, label: truncate(iriLabel(id, g.labels)), kind: isClass ? 'class' : 'resource', href: describeHref(id, env),
        ...(isClass ? klass() : resource(id, root)) });
    };
    addIri(iri, true);
    const add = (t: Triple, dir: 'out' | 'in') => {
      let target: string;
      if (dir === 'in') { addIri(t.s); target = t.s; }
      else if (t.o_iri) { addIri(t.o); target = t.o; }
      else {
        target = `lit:${t.p}|${t.o}|${t.lang ?? ''}`;
        const text = termText({ value: t.o, datatype: t.datatype ?? undefined, lang: t.lang ?? undefined }, g.labels);
        if (!nodes.get(target)) nodes.add({ id: target, label: truncate(text, 28), title: text, kind: 'literal', ...literal() });
      }
      const [from, to] = dir === 'out' ? [iri, target] : [t.s, iri];
      const id = `${from}|${t.p}|${to}`;
      if (!edges.get(id)) edges.add({ id, from, to, label: t.p === RDF_TYPE ? 'a' : truncate(prefixed(t.p).replace(/^era:/, ''), 26), title: t.p });
    };
    // Literals make the graph unreadable on resources with many parameters: keep the links, and
    // the literals only when there are few.
    const literals = g.out.filter((t) => !t.o_iri);
    for (const t of g.out) if (t.o_iri || literals.length <= 12) add(t, 'out');
    for (const t of g.in) add(t, 'in');
    note.textContent = `${nodes.length - 1} linked nodes${literals.length > 12 ? `; ${literals.length} literal values are in All properties` : ''}. Click a resource to open its page, drag to move, scroll to zoom.`;

    const options: Options = {
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.5 } },
        color: { color: c.edge, highlight: c.signal, hover: c.signal }, width: 1.5,
        font: { size: 11, color: c.muted, face: 'IBM Plex Mono', strokeWidth: 3, strokeColor: c.surface, align: 'middle' },
        smooth: { enabled: true, type: 'continuous', roundness: 0.3 },
      },
      physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -110, springLength: 170, avoidOverlap: 0.8 }, stabilization: { iterations: 300, fit: true } },
      interaction: { hover: true, tooltipDelay: 200 },
    };
    const network = new vis.Network(box, { nodes, edges }, options);
    if (import.meta.env.DEV) (window as unknown as { __graph: unknown }).__graph = network; // for debugging / e2e
    // Lay out once, then stop the simulation so the graph stays where the user drags it.
    network.once('stabilizationIterationsDone', () => { network.setOptions({ physics: { enabled: false } }); network.fit({ animation: false }); });
    network.on('click', (p: { nodes: (string | number)[] }) => {
      const n = p.nodes.length ? nodes.get(String(p.nodes[0])) : null;
      if (n && !Array.isArray(n) && n.href && n.id !== iri) navigate(n.href);
    });
    network.on('hoverNode', () => { box.style.cursor = 'pointer'; });
    network.on('blurNode', () => { box.style.cursor = ''; });
    const recolor = () => {
      c = colors();
      nodes.update(nodes.get().map((n) => ({ id: n.id, ...(n.kind === 'class' ? klass() : n.kind === 'literal' ? literal() : resource(String(n.id), n.id === iri)) })));
      network.setOptions({ edges: { color: { color: c.edge }, font: { color: c.muted, strokeColor: c.surface } } });
    };
    onThemeChange(recolor);
    destroy = () => { offThemeChange(recolor); network.destroy(); };
  }).catch((e) => { note.textContent = `The graph could not be loaded: ${e.message ?? e}`; note.classList.add('error'); });
  return wrap;
}
