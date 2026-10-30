// rd:TopologyViewer: the topology around a linear element, two net relations out: the
// elements as nodes (the element itself marked, the next ones quieter by distance), the net
// relations as edges with their navigability: arrows the way a train can pass, dashed when
// it cannot. Nodes start where the elements lie on the map and settle from there; drag to
// move, scroll to zoom, click an element to open its page. The table row's columns: a, b,
// navigability, origin-a, origin-b; rd:elements names the row with the elements (wkt,
// length).
import type { Edge, Node, Options } from 'vis-network/standalone';
import type { Item } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h } from '../dom.ts';
import { formatNumber } from '../format.ts';
import { describeHref, navigate } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import { parseWkt } from '../wkt.ts';
import type { Widget } from './types.ts';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const local = (iri: string | undefined) => (iri ?? '').replace(/.*[/#]/, '');

export type Way = 'both' | 'ab' | 'ba' | 'none' | 'unknown';

/** The navigability concept of a net relation (navigabilities/Both, AB, BA, None). */
export function way(iri: string | undefined): Way {
  const k = local(iri).toLowerCase();
  return k === 'both' ? 'both' : k === 'ab' ? 'ab' : k === 'ba' ? 'ba' : k === 'none' ? 'none' : 'unknown';
}

export interface Relation { iri: string; a: string; b: string; way: Way; endA: 'start' | 'end' | null; endB: 'start' | 'end' | null }

export function relations(items: Item[]): Relation[] {
  const end = (t: { value?: string }[] | undefined) => (t?.[0]?.value === 'true' ? 'start' : t?.[0]?.value === 'false' ? 'end' : null);
  return items.flatMap((it) => {
    const a = it.cells.a?.[0]?.iri, b = it.cells.b?.[0]?.iri;
    if (!a || !b) return [];
    return [{ iri: it.iri, a, b, way: way(it.cells.navigability?.[0]?.iri), endA: end(it.cells['origin-a']), endB: end(it.cells['origin-b']) }];
  });
}

/** Steps from `from` to every element over the relations. */
export function depths(from: string, rels: Relation[]): Map<string, number> {
  const d = new Map([[from, 0]]);
  let front = [from];
  while (front.length) {
    const next: string[] = [];
    for (const x of front) for (const r of rels) {
      const y = r.a === x ? r.b : r.b === x ? r.a : null;
      if (y && !d.has(y)) { d.set(y, d.get(x)! + 1); next.push(y); }
    }
    front = next;
  }
  return d;
}

function middle(wkt: string | undefined): [number, number] | null {
  const g = wkt ? parseWkt(wkt) : null;
  const pts = !g ? [] : g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : g.type === 'Point' ? [g.coordinates] : [];
  if (!pts.length) return null;
  const p = pts[Math.floor(pts.length / 2)];
  return [p[0], p[1]];
}

const WAY_TEXT: Record<Way, string> = {
  both: 'Navigable both ways', ab: 'Navigable from A to B', ba: 'Navigable from B to A', none: 'Not navigable', unknown: 'Navigability not given',
};

export const TopologyViewer: Widget = {
  wide: true,
  render: ({ entry, row, page, iri, env, labels }) => {
    const rels = relations(entry.items ?? []);
    if (!rels.length) return null;
    const elements = new Map((page.doc.rows[row.settings.elements ?? '']?.items ?? []).map((it) => [it.iri, it]));
    const depth = depths(iri, rels);
    const ids = [...depth.keys()];

    const box = h('div', { class: 'topo-graph', role: 'region', 'aria-label': `Topology around the element: ${ids.length} elements, ${rels.length} net relations` });
    const full = h('button', { type: 'button', class: 'btn small' }, 'Full screen');
    const fit = h('button', { type: 'button', class: 'btn small' }, 'Fit');
    const counts = (w: Way) => rels.filter((r) => r.way === w).length;
    const legend = h('div', { class: 'topo-legend small' },
      h('span', { class: 'topo-key' }, h('span', { class: 'topo-swatch self' }), 'This element'),
      h('span', { class: 'topo-key' }, h('span', { class: 'topo-swatch near' }), 'One relation away'),
      h('span', { class: 'topo-key' }, h('span', { class: 'topo-swatch far' }), 'Two away'),
      (['both', 'ab', 'ba', 'none', 'unknown'] as Way[]).filter(counts).map((w) =>
        h('span', { class: 'topo-key' }, h('span', { class: `topo-edge ${w}` }), `${WAY_TEXT[w]} (${counts(w)})`)));
    const wrap = h('figure', { class: 'topology' },
      h('div', { class: 'topo-tools' }, legend, h('span', { class: 'topo-buttons' }, fit, full)),
      box,
      h('figcaption', { class: 'muted small' }, 'Elements start where they lie on the map. Hover a connection for the ends that meet; drag to move, scroll to zoom, click an element to open it.'));
    full.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void wrap.requestFullscreen?.();
    });

    let disposed = false;
    let destroy = () => {};
    onDispose(() => { disposed = true; destroy(); });
    // theme.ts reads the window: loaded with the graph, so the pure helpers above test in Node.
    Promise.all([import('vis-network/standalone'), import('../theme.ts')]).then(([vis, { onThemeChange, offThemeChange }]) => {
      if (disposed) return;
      const colors = () => ({ surface: css('--surface'), text: css('--text'), muted: css('--muted'), brand: css('--accent-strong'),
        signal: css('--signal'), edge: css('--line-strong'), border: css('--border'), danger: css('--danger'), ok: css('--ok') });
      let c = colors();
      // Where the elements lie: the middle of each geometry, projected and scaled to ~700 px.
      const geo = new Map(ids.map((id) => [id, middle(elements.get(id)?.cells.wkt?.[0]?.value)] as const).filter((x): x is [string, [number, number]] => !!x[1]));
      const pos = new Map<string, { x: number; y: number }>();
      if (geo.size >= 2) {
        const lat = [...geo.values()].reduce((s, p) => s + p[1], 0) / geo.size;
        const k = Math.cos((lat * Math.PI) / 180);
        const xy = [...geo].map(([id, p]) => [id, p[0] * k, -p[1]] as const);
        const xs = xy.map((p) => p[1]), ys = xy.map((p) => p[2]);
        const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        for (const [id, x, y] of xy) pos.set(id, { x: ((x - cx) / span) * 700, y: ((y - cy) / span) * 700 });
      }
      const style = (id: string) => {
        const d = depth.get(id) ?? 2;
        const ring = d === 0 ? c.signal : d === 1 ? c.brand : c.edge;
        return {
          shape: 'box', shapeProperties: { borderRadius: 14 }, borderWidth: d === 0 ? 3 : 1.5,
          color: { background: c.surface, border: ring, highlight: { background: c.surface, border: c.signal }, hover: { background: c.surface, border: c.signal } },
          font: { color: d === 2 ? c.muted : c.brand, size: d === 0 ? 14 : 12, face: 'IBM Plex Sans', multi: 'md' as const },
          margin: { top: 6, bottom: 6, left: 10, right: 10 },
        };
      };
      const nodeLabel = (id: string) => {
        const name = iriLabel(id, labels);
        const len = Number(elements.get(id)?.cells.length?.[0]?.value);
        const short = name.length > 26 ? name.slice(0, 12) + '…' + name.slice(-10) : name;
        return Number.isFinite(len) && len > 0 ? `${short}\n_${len >= 1000 ? `${formatNumber(Math.round(len / 10) / 100)} km` : `${formatNumber(Math.round(len))} m`}_` : short;
      };
      const nodes = new vis.DataSet<Node & { href: string }>(ids.map((id) => ({
        id, label: nodeLabel(id), title: id, href: describeHref(id, env), ...pos.get(id), ...style(id),
      })));
      const edgeStyle = (r: Relation) => ({
        arrows: { to: { enabled: r.way === 'both' || r.way === 'ab', scaleFactor: 0.6 }, from: { enabled: r.way === 'both' || r.way === 'ba', scaleFactor: 0.6 } },
        dashes: r.way === 'none' ? [6, 5] : r.way === 'unknown' ? [2, 4] : false,
        color: { color: r.way === 'none' ? c.danger : r.way === 'unknown' ? c.edge : c.brand, highlight: c.signal, hover: c.signal },
        width: r.way === 'none' ? 1.5 : 2,
      });
      const ends = (r: Relation) => `${r.endA ? `${r.endA} of A` : 'A'} meets ${r.endB ? `${r.endB} of B` : 'B'}`;
      const edges = new vis.DataSet<Edge>(rels.map((r) => ({
        id: r.iri, from: r.a, to: r.b, title: `${WAY_TEXT[r.way]}: ${ends(r)}\nA: ${iriLabel(r.a, labels)}\nB: ${iriLabel(r.b, labels)}`, ...edgeStyle(r),
      })));
      const options: Options = {
        edges: { smooth: { enabled: true, type: 'continuous', roundness: 0.25 } },
        physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -90, springLength: 150, avoidOverlap: 0.9 }, stabilization: { iterations: pos.size ? 120 : 300, fit: true } },
        interaction: { hover: true, tooltipDelay: 150, navigationButtons: false, keyboard: false },
      };
      const network = new vis.Network(box, { nodes, edges }, options);
      network.once('stabilizationIterationsDone', () => { network.setOptions({ physics: { enabled: false } }); network.fit({ animation: false }); });
      network.on('click', (p: { nodes: (string | number)[] }) => {
        const n = p.nodes.length ? nodes.get(String(p.nodes[0])) : null;
        if (n && !Array.isArray(n) && n.id !== iri) navigate(n.href);
      });
      network.on('hoverNode', () => { box.style.cursor = 'pointer'; });
      network.on('blurNode', () => { box.style.cursor = ''; });
      fit.addEventListener('click', () => network.fit({ animation: true }));
      const resize = () => setTimeout(() => network.fit({ animation: false }), 50);
      document.addEventListener('fullscreenchange', resize);
      const recolor = () => {
        c = colors();
        nodes.update(ids.map((id) => ({ id, ...style(id) })));
        edges.update(rels.map((r) => ({ id: r.iri, ...edgeStyle(r) })));
      };
      onThemeChange(recolor);
      destroy = () => { offThemeChange(recolor); document.removeEventListener('fullscreenchange', resize); network.destroy(); };
    }).catch((e) => { box.textContent = `The topology could not be drawn: ${e.message ?? e}`; });
    return wrap;
  },
};
