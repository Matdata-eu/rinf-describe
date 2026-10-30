// The "Data model" tab: a UML class diagram of the resource's class from ERA's SHACL shapes.
// The class and its superclasses are boxes in the middle, general on top, with their
// attributes (name: type [multiplicity]); associations go out on the right to the classes
// they point at and come in on the left from the classes that point here. Filled dots and
// solid lines are what this resource has; a ringed dot, what its common characteristics
// subset gives it.
import { api, type ClassModelResponse, type ModelBox, type ModelMember, type ModelResponse } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { append, h, s } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { localName, prefixed } from '../rdf.ts';
import { branch, classTree, drawTree, pageTree, type TNode } from './modeltree.ts';
import { naturalSize, panZoom } from './panzoom.ts';
import { classUml, mermaid, pageUml, plantuml } from './umltext.ts';

const LINE = 18, HEAD = 40, PAD = 10, GAP_Y = 48, SLOT_GAP = 14, EDGE_ROOM = 70;
const FONT = '12px "IBM Plex Mono", monospace', HEAD_FONT = '600 13px "IBM Plex Sans", sans-serif';

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** The width of a text in a font, measured on a canvas (an estimate where there is none). */
export function textWidth(text: string, font = FONT): number {
  if (ctx2d === undefined) {
    try { ctx2d = document.createElement('canvas').getContext('2d'); } catch { ctx2d = null; }
  }
  if (ctx2d) { ctx2d.font = font; return ctx2d.measureText(text).width; }
  return text.length * (font === FONT ? 7.2 : 7.4);
}

/** UML multiplicity: [1], [0..1], [0..*], [1..*]. */
export function multiplicity(m: { min: number; max: number | null }): string {
  const hi = m.max === null ? '*' : String(m.max);
  return m.min === m.max ? `[${hi}]` : `[${m.min}..${hi}]`;
}

/** The type of an attribute: a datatype, or the code list (SKOS concept scheme) it takes values from. */
export function typeName(m: ModelMember): string {
  if (m.scheme) return localName(m.scheme);
  return m.type ? localName(m.type) : 'IRI';
}

const attrText = (m: ModelMember) => `${localName(m.p)}: ${typeName(m)} ${multiplicity(m)}`;
const roleText = (m: ModelMember) => `${localName(m.p)} ${multiplicity(m).slice(1, -1)}`;
const tip = (m: ModelMember) => [m.label, m.comment, m.index?.length ? `RINF ${m.index.join(', ')}` : null, prefixed(m.p)].filter(Boolean).join('\n');
const className = (iri: string) => localName(iri);

interface Placed { iri: string; x: number; y: number; w: number; hgt: number }

export function drawModel(res: ModelResponse, all: boolean, onAll: () => void): SVGSVGElement | null {
  const m = res.model;
  if (!m) return null;
  const used = (dir: 'out' | 'in', p: string) => (res.used[dir][p] ?? 0) > 0;
  const via = (p: string) => !used('out', p) && (res.used.via?.[p] ?? 0) > 0;
  const env = res.env;

  // Middle: the class and its superclasses, a row per depth, general on top. An association
  // between two of them (a class pointing at its own superclass) is listed as an attribute.
  const inBoxes = new Set(m.boxes.map((b) => b.iri));
  const attrs = (b: ModelBox): ModelMember[] => [...b.attributes,
    ...b.associations.filter((a) => inBoxes.has(a.class!)).map((a) => ({ ...a, type: a.class }))];
  const shown = (b: ModelBox) => (all ? attrs(b) : attrs(b).filter((a) => used('out', a.p) || via(a.p) || a.min > 0));
  const size = (b: ModelBox) => {
    const lines = shown(b).map(attrText);
    const more = attrs(b).length - shown(b).length;
    const w = Math.max(160, textWidth(className(b.iri), HEAD_FONT) + 2 * PAD,
      ...lines.map((t) => textWidth(t) + 2 * PAD + 14), more ? textWidth(`+ ${more} more`) + 2 * PAD : 0);
    const n = lines.length + (more ? 1 : 0);
    return { w: Math.ceil(w), hgt: HEAD + Math.max(1, n) * LINE + PAD };
  };
  const depths = [...new Set(m.boxes.map((b) => b.depth))].sort((a, b) => a - b);
  const rows = depths.map((d) => m.boxes.filter((b) => b.depth === d));
  const sizes = new Map(m.boxes.map((b) => [b.iri, size(b)]));
  const rowW = rows.map((r) => r.reduce((t, b) => t + sizes.get(b.iri)!.w, 0) + (r.length - 1) * 32);
  const midW = Math.max(...rowW);

  // Right: the classes the boxes point at; left: the classes pointing at the boxes.
  type Edge = { from: string; to: string; m: ModelMember; used: boolean };
  const outE: Edge[] = [], inE: Edge[] = [];
  for (const b of m.boxes) {
    for (const a of b.associations) if (!inBoxes.has(a.class!)) outE.push({ from: b.iri, to: a.class!, m: a, used: used('out', a.p) || via(a.p) });
  }
  for (const a of m.incoming) inE.push({ from: a.source!, to: a.class!, m: a, used: used('in', a.p) });
  const group = (es: Edge[], key: (e: Edge) => string) => {
    const g = new Map<string, Edge[]>();
    for (const e of es) { const k = key(e); if (!g.has(k)) g.set(k, []); g.get(k)!.push(e); }
    return g;
  };
  const order = new Map(m.boxes.map((b, i) => [b.iri, depths.indexOf(b.depth) * 100 + i]));
  const right = [...group(outE, (e) => e.to).entries()]
    .sort((a, b) => Math.min(...a[1].map((e) => order.get(e.from)!)) - Math.min(...b[1].map((e) => order.get(e.from)!)) || className(a[0]).localeCompare(className(b[0])));
  const left = [...group(inE, (e) => e.from).entries()].sort((a, b) => className(a[0]).localeCompare(className(b[0])));
  for (const [, es] of [...right, ...left]) es.sort((a, b) => localName(a.m.p).localeCompare(localName(b.m.p)));
  const sideW = (side: [string, Edge[]][]) => Math.max(0, ...side.map(([c]) => textWidth(className(c), HEAD_FONT) + 2 * PAD));
  const labelW = (side: [string, Edge[]][]) => Math.max(0, ...side.flatMap(([, es]) => es.map((e) => textWidth(roleText(e.m)))));
  const rw = Math.ceil(sideW(right)), lw = Math.ceil(sideW(left));
  const rgap = right.length ? Math.ceil(labelW(right)) + EDGE_ROOM : 0, lgap = left.length ? Math.ceil(labelW(left)) + EDGE_ROOM : 0;
  const x0 = 16 + (left.length ? lw + lgap : 0);

  const placed = new Map<string, Placed>();
  let y = 16;
  rows.forEach((r, i) => {
    let x = x0 + (midW - rowW[i]) / 2;
    const rh = Math.max(...r.map((b) => sizes.get(b.iri)!.hgt));
    for (const b of r) {
      const sz = sizes.get(b.iri)!;
      placed.set(b.iri, { iri: b.iri, x, y, ...sz });
      x += sz.w + 32;
    }
    y += rh + GAP_Y;
  });
  const slot = (n: number) => Math.max(HEAD - 6, n * LINE + 16);
  let midH = y - GAP_Y;
  // When a side is taller than the middle, the middle moves down to face its centre.
  const sideH = (side: [string, Edge[]][]) => side.reduce((t, [, es]) => t + slot(es.length), 0) + Math.max(0, side.length - 1) * SLOT_GAP;
  const shift = Math.max(0, (Math.max(sideH(right), sideH(left)) - (midH - 16)) / 2);
  if (shift) {
    for (const p of placed.values()) p.y += shift;
    midH += shift;
  }
  const stack = (side: [string, Edge[]][], x: number, w: number) => {
    let sy = Math.max(16, (16 + shift + midH) / 2 - sideH(side) / 2);
    for (const [c, es] of side) {
      placed.set(`side:${x}:${c}`, { iri: c, x, y: sy, w, hgt: slot(es.length) });
      sy += slot(es.length) + SLOT_GAP;
    }
    return sy - SLOT_GAP;
  };
  const rx = x0 + midW + rgap;
  const rEnd = right.length ? stack(right, rx, rw) : 0;
  const lEnd = left.length ? stack(left, 16, lw) : 0;
  const W = Math.ceil((right.length ? rx + rw : x0 + midW) + 16);
  const H = Math.ceil(Math.max(midH, rEnd, lEnd) + 16);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'uml-svg', role: 'img',
    'aria-label': `UML class diagram of ${className(m.focus)}` }) as SVGSVGElement;
  const defs = s('defs');
  defs.append(s('marker', { id: 'uml-gen', viewBox: '0 0 12 12', refX: 11, refY: 6, markerWidth: 12, markerHeight: 12, orient: 'auto-start-reverse' },
    s('path', { d: 'M1 1L11 6L1 11Z', class: 'uml-gen-head' })));
  defs.append(s('marker', { id: 'uml-nav', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, orient: 'auto' },
    s('path', { d: 'M1 1L9 5L1 9', class: 'uml-nav-head' })));
  svg.append(defs);
  const edges = s('g', { class: 'uml-edges' });
  svg.append(edges);

  const header = (g: SVGElement, iri: string, x: number, yy: number, w: number, focus = false) => {
    const a = s('a', { href: describeHref(iri, env) });
    a.append(s('title', {}, [res.model!.classes[iri]?.label, res.model!.classes[iri]?.comment, prefixed(iri)].filter(Boolean).join('\n')));
    a.append(s('text', { x: x + w / 2, y: yy + 17, class: `uml-name${focus ? ' focus' : ''}`, 'text-anchor': 'middle' }, className(iri)));
    const label = res.model!.classes[iri]?.label;
    if (label && label.toLowerCase().replace(/\s+/g, '') !== className(iri).toLowerCase()) {
      a.append(s('text', { x: x + w / 2, y: yy + 31, class: 'uml-sub', 'text-anchor': 'middle' }, label.length > 40 ? label.slice(0, 39) + '…' : label));
    }
    g.append(a);
  };

  // The middle boxes and their attributes.
  for (const b of m.boxes) {
    const p = placed.get(b.iri)!;
    const g = s('g', { class: 'uml-box' });
    g.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.hgt, rx: 4, class: `uml-rect${b.iri === m.focus ? ' focus' : ''}` }));
    g.append(s('path', { d: `M${p.x} ${p.y + HEAD - 4}H${p.x + p.w}`, class: 'uml-rule' }));
    header(g, b.iri, p.x, p.y, p.w, b.iri === m.focus);
    let ly = p.y + HEAD - 4 + LINE - 3;
    const list = shown(b);
    const more = attrs(b).length - list.length;
    if (!list.length && !more) {
      g.append(s('text', { x: p.x + PAD, y: ly, class: 'uml-attr muted' }, 'no own attributes'));
    }
    for (const a of list) {
      const on = used('out', a.p), sub = via(a.p);
      const t = s('g', { class: `uml-attr-line${on || sub ? ' used' : ''}` });
      t.append(s('title', {}, tip(a) + (sub ? '\nGiven on the common characteristics subset' : '')));
      t.append(s('circle', { cx: p.x + PAD + 4, cy: ly - 4, r: 3.5, class: on ? 'uml-dot on' : sub ? 'uml-dot via' : 'uml-dot' }));
      t.append(s('text', { x: p.x + PAD + 14, y: ly, class: 'uml-attr' }, attrText(a)));
      g.append(t);
      ly += LINE;
    }
    if (more) {
      const btn = s('text', { x: p.x + PAD + 14, y: ly, class: 'uml-more', role: 'button', tabindex: 0 }, `+ ${more} more`);
      btn.addEventListener('click', onAll);
      btn.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') onAll(); });
      g.append(btn);
    }
    svg.append(g);
    // Generalization: a hollow triangle on the superclass.
    for (const parent of b.parents) {
      const q = placed.get(parent);
      if (!q) continue;
      edges.append(s('path', { d: `M${p.x + p.w / 2} ${p.y}L${q.x + q.w / 2} ${q.y + q.hgt}`, class: 'uml-gen', 'marker-end': 'url(#uml-gen)' }));
    }
  }

  // Side boxes: one edge per association, its role name and multiplicity at the far end.
  const side = (groups: [string, Edge[]][], x: number, out: boolean) => {
    const starts = new Map<string, number>();
    const perBox = group(groups.flatMap(([, es]) => es), (e) => (out ? e.from : e.to));
    for (const [c, es] of groups) {
      const p = placed.get(`side:${x}:${c}`)!;
      const g = s('g', { class: 'uml-box side' });
      g.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.hgt, rx: 4, class: `uml-rect side${es.some((e) => e.used) ? ' used' : ''}` }));
      header(g, c, p.x, p.y + (p.hgt - HEAD) / 2 + 4, p.w);
      svg.append(g);
      es.forEach((e, i) => {
        const box = placed.get(out ? e.from : e.to)!;
        const list = perBox.get(out ? e.from : e.to)!;
        const k = starts.get(box.iri) ?? 0;
        starts.set(box.iri, k + 1);
        const top = box.y + HEAD, span = Math.max(LINE, box.hgt - HEAD - PAD);
        const by = top + span * ((k + 0.5) / list.length);
        const sy = p.y + 8 + LINE * (i + 0.5) + (p.hgt - 16 - LINE * es.length) / 2 + 4;
        const bx = out ? box.x + box.w : box.x, sx = out ? p.x : p.x + p.w;
        // A straight run under the role name at the side box, then a curve to the middle box.
        const run = Math.min(textWidth(roleText(e.m)) + 14, Math.abs(sx - bx) - 30);
        const kx = out ? sx - run : sx + run, mx = (bx + kx) / 2;
        const d = out ? `M${bx} ${by}C${mx} ${by} ${mx} ${sy} ${kx} ${sy}H${sx}` : `M${sx} ${sy}H${kx}C${mx} ${sy} ${mx} ${by} ${bx} ${by}`;
        const path = s('path', { d, class: `uml-assoc${e.used ? ' used' : ''}`, 'marker-end': 'url(#uml-nav)' });
        path.append(s('title', {}, tip(e.m)));
        edges.append(path);
        const lx = out ? sx - 8 : sx + 8;
        const t = s('text', { x: lx, y: sy - 4, class: `uml-role${e.used ? ' used' : ''}`, 'text-anchor': out ? 'end' : 'start' }, roleText(e.m));
        t.append(s('title', {}, tip(e.m)));
        svg.append(t);
      });
    }
  };
  side(right, rx, true);
  side(left, 16, false);
  return svg;
}

/** One class (or an untyped hop) of the page view, with the properties the page reads on it. */
interface PageNode { iri: string; hop: number; side: number; members: (ModelMember & { rows: string[]; missing?: boolean })[]; untyped?: boolean; narrowedFrom?: string; label?: string; comment?: string }
interface PageEdge extends ModelMember { from: string; to: string; rows: string[]; missing?: boolean }

const rowsTip = (rows: string[]) => (rows.length ? `\nShown in: ${rows.slice(0, 6).join('; ')}${rows.length > 6 ? ` and ${rows.length - 6} more` : ''}` : '');
const untypedName = (iri: string) => localName(iri.replace(/^untyped:\^?/, ''));

/** The page view: every class the page's rows pass through, in columns by the number of hops
 * from the resource's class (links followed forwards on the right, backwards on the left),
 * each with the properties the page reads on it. Steps ERA's shapes do not define are marked. */
export function drawPage(res: ModelResponse): SVGSVGElement | null {
  const pm = res.model?.page;
  if (!pm?.nodes.length) return null;
  const env = res.env;
  const nodes = pm.nodes as PageNode[];
  const edges = (pm.edges as PageEdge[]).filter((e) => e.from !== e.to);
  const col = (n: PageNode) => n.side * n.hop;
  const byIri = new Map(nodes.map((n) => [n.iri, n]));
  const memberText = (m: PageNode['members'][number]) => (m.missing ? `${localName(m.p)}: ?` : attrText(m));

  // Which end of an edge is the outer one (farther from the resource's class): its label goes there.
  const outer = (e: PageEdge) => {
    const a = byIri.get(e.from)!, b = byIri.get(e.to)!;
    return Math.abs(col(b)) >= Math.abs(col(a)) ? e.to : e.from;
  };
  const sideOf = (iri: string, other: string): 'l' | 'r' => {
    const a = col(byIri.get(iri)!), b = col(byIri.get(other)!);
    // Two boxes in one column link on the side facing the middle.
    return b > a || (b === a && a <= 0) ? 'r' : 'l';
  };
  const degree = new Map<string, number>();
  for (const e of edges) for (const [x, y] of [[e.from, e.to], [e.to, e.from]]) {
    const k = `${x}|${sideOf(x, y)}`;
    degree.set(k, (degree.get(k) ?? 0) + 1);
  }
  const size = (n: PageNode) => {
    const name = n.untyped ? untypedName(n.iri) : className(n.iri);
    const w = Math.max(150, textWidth(name, HEAD_FONT) + 2 * PAD, ...n.members.map((m) => textWidth(memberText(m)) + 2 * PAD));
    const content = HEAD + Math.max(0, n.members.length) * LINE + (n.members.length ? PAD : -6);
    const ports = Math.max(degree.get(`${n.iri}|l`) ?? 0, degree.get(`${n.iri}|r`) ?? 0) * LINE + 16;
    return { w: Math.ceil(w), hgt: Math.max(content, ports) };
  };
  const sizes = new Map(nodes.map((n) => [n.iri, size(n)]));
  const cols = [...new Set(nodes.map(col))].sort((a, b) => a - b);

  // Order each column by where its neighbours nearer the middle sit, working outwards.
  const yOf = new Map<string, number>();
  const columns = new Map<number, PageNode[]>();
  const place = (c: number) => {
    const list = nodes.filter((n) => col(n) === c);
    const inner = (n: PageNode) => {
      const ys = edges.flatMap((e) => (e.from === n.iri ? [e.to] : e.to === n.iri ? [e.from] : []))
        .filter((o) => Math.abs(col(byIri.get(o)!)) < Math.abs(c) && yOf.has(o)).map((o) => yOf.get(o)!);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
    };
    list.sort((a, b) => inner(a) - inner(b) || className(a.iri).localeCompare(className(b.iri)));
    let y = 0;
    for (const n of list) { yOf.set(n.iri, y); y += sizes.get(n.iri)!.hgt + SLOT_GAP; }
    columns.set(c, list);
  };
  place(0);
  for (let d = 1; d <= Math.max(...cols.map(Math.abs)); d++) { if (cols.includes(d)) place(d); if (cols.includes(-d)) place(-d); }
  const colH = (c: number) => (columns.get(c) ?? []).reduce((t, n) => t + sizes.get(n.iri)!.hgt, 0) + Math.max(0, (columns.get(c)?.length ?? 1) - 1) * SLOT_GAP;
  const H0 = Math.max(...cols.map(colH));

  // Column x positions: a gap before each outer column wide enough for the labels ending there.
  const colW = (c: number) => Math.max(...(columns.get(c) ?? []).map((n) => sizes.get(n.iri)!.w));
  const gapFor = (c: number) => Math.max(40, ...edges.filter((e) => col(byIri.get(outer(e))!) === c).map((e) => textWidth(roleText(e)))) + EDGE_ROOM;
  const xs = new Map<number, number>();
  let x = 16;
  for (const c of cols) {
    if (c > 0) x += gapFor(c);   // the labels of a column sit on its side facing the middle
    xs.set(c, x);
    x += colW(c) + (c < 0 ? gapFor(c) : 0);
  }
  const W = Math.ceil(x + 16), H = Math.ceil(H0 + 32);
  const placed = new Map<string, Placed>();
  for (const c of cols) {
    let y = 16 + (H0 - colH(c)) / 2;
    for (const n of columns.get(c)!) {
      const sz = sizes.get(n.iri)!;
      const cx = xs.get(c)! + (colW(c) - sz.w) / 2;
      placed.set(n.iri, { iri: n.iri, x: cx, y, ...sz });
      y += sz.hgt + SLOT_GAP;
    }
  }

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'uml-svg', role: 'img',
    'aria-label': `What the page of this ${className(res.model!.focus)} shows, as a UML class diagram` }) as SVGSVGElement;
  svg.append(s('defs', {}, s('marker', { id: 'uml-nav-p', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, orient: 'auto' },
    s('path', { d: 'M1 1L9 5L1 9', class: 'uml-nav-head' }))));
  const edgeLayer = s('g', { class: 'uml-edges' });
  svg.append(edgeLayer);

  // Ports: the edges on each side of a box, spread over its height in the order of their other ends.
  const ports = new Map<string, string[]>();
  edges.forEach((e, i) => {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      const k = `${a}|${sideOf(a, b)}`;
      if (!ports.has(k)) ports.set(k, []);
      ports.get(k)!.push(`${i}|${b}`);
    }
  });
  for (const list of ports.values()) list.sort((p, q) => placed.get(p.split('|').slice(1).join('|'))!.y - placed.get(q.split('|').slice(1).join('|'))!.y);
  const port = (a: string, b: string, i: number) => {
    const sd = sideOf(a, b), p = placed.get(a)!, list = ports.get(`${a}|${sd}`)!;
    const k = list.indexOf(`${i}|${b}`);
    const y = p.y + 8 + (p.hgt - 16) * ((k + 0.5) / list.length);
    return { x: sd === 'r' ? p.x + p.w : p.x, y, sd };
  };

  edges.forEach((e, i) => {
    const a = port(e.from, e.to, i), b = port(e.to, e.from, i);
    const out = outer(e), o = out === e.to ? b : a, n = out === e.to ? a : b;
    const label = roleText(e);
    const run = Math.min(textWidth(label) + 14, Math.max(0, Math.abs(o.x - n.x) - 30));
    const kx = o.sd === 'l' ? o.x - run : o.x + run;
    const mx = (kx + n.x) / 2;
    // Drawn from the inner end to the outer one, then reversed when the edge points inwards.
    const fwd = out === e.to;
    let d = fwd ? `M${n.x} ${n.y}C${mx} ${n.y} ${mx} ${o.y} ${kx} ${o.y}H${o.x}` : `M${o.x} ${o.y}H${kx}C${mx} ${o.y} ${mx} ${n.y} ${n.x} ${n.y}`;
    if (a.sd === b.sd && Math.abs(a.x - b.x) < 2) {   // same column: a loop out into the gap
      const bx = a.sd === 'r' ? Math.max(a.x, b.x) + 50 : Math.min(a.x, b.x) - 50;
      d = `M${a.x} ${a.y}C${bx} ${a.y} ${bx} ${b.y} ${b.x} ${b.y}`;
    }
    const path = s('path', { d, class: `uml-assoc used${e.missing ? ' missing' : ''}`, 'marker-end': 'url(#uml-nav-p)' });
    path.append(s('title', {}, tip(e) + (e.missing ? '\nNot in ERA’s SHACL shapes' : '') + rowsTip(e.rows)));
    edgeLayer.append(path);
    const t = s('text', { x: o.sd === 'l' ? o.x - 8 : o.x + 8, y: o.y - 4, class: `uml-role used${e.missing ? ' missing' : ''}`, 'text-anchor': o.sd === 'l' ? 'end' : 'start' }, label);
    t.append(s('title', {}, tip(e) + rowsTip(e.rows)));
    svg.append(t);
  });

  for (const n of nodes) {
    const p = placed.get(n.iri)!;
    const g = s('g', { class: 'uml-box' });
    const focus = n.hop === 0;
    g.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.hgt, rx: 4, class: `uml-rect${focus ? ' focus' : ''}${n.untyped ? ' untyped' : ''}` }));
    if (n.untyped) {
      g.append(s('text', { x: p.x + p.w / 2, y: p.y + 15, class: 'uml-sub', 'text-anchor': 'middle' }, '«untyped»'));
      const name = s('text', { x: p.x + p.w / 2, y: p.y + 30, class: 'uml-name untyped', 'text-anchor': 'middle' }, untypedName(n.iri));
      name.append(s('title', {}, 'ERA’s SHACL shapes give this link no class, so the page’s path cannot be followed further in the model.'));
      g.append(name);
    } else {
      const a = s('a', { href: describeHref(n.iri, env) });
      a.append(s('title', {}, [n.label, n.comment, prefixed(n.iri), n.narrowedFrom ? `A ${className(n.narrowedFrom)} that is a ${className(n.iri)}` : null].filter(Boolean).join('\n')));
      a.append(s('text', { x: p.x + p.w / 2, y: p.y + 17, class: `uml-name${focus ? ' focus' : ''}`, 'text-anchor': 'middle' }, className(n.iri)));
      const sub = n.narrowedFrom ? `a ${className(n.narrowedFrom)}` : n.label && n.label.toLowerCase().replace(/\s+/g, '') !== className(n.iri).toLowerCase() ? n.label : null;
      if (sub) a.append(s('text', { x: p.x + p.w / 2, y: p.y + 31, class: 'uml-sub', 'text-anchor': 'middle' }, sub.length > 40 ? sub.slice(0, 39) + '…' : sub));
      g.append(a);
    }
    if (n.members.length) {
      g.append(s('path', { d: `M${p.x} ${p.y + HEAD - 4}H${p.x + p.w}`, class: 'uml-rule' }));
      let ly = p.y + HEAD - 4 + LINE - 3;
      for (const m of n.members) {
        const line = s('text', { x: p.x + PAD, y: ly, class: `uml-attr page${m.missing ? ' missing' : ''}` }, memberText(m));
        line.append(s('title', {}, tip(m) + (m.missing ? `\nNot in ERA’s SHACL shapes for ${className(n.iri)}` : '') + rowsTip(m.rows)));
        g.append(line);
        ly += LINE;
      }
    }
    svg.append(g);
  }
  return svg;
}

/** The SVG with its computed colours and fonts written in, for a download that looks the same. */
function standalone(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { w, h: hgt } = naturalSize(svg);
  clone.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(hgt));
  clone.removeAttribute('data-w');
  clone.removeAttribute('data-h');
  const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const style = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'opacity']
      .map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';');
    dst[i].setAttribute('style', style);
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('style', `background:${getComputedStyle(svg.parentElement ?? svg).backgroundColor}`);
  return new XMLSerializer().serializeToString(clone);
}

function save(body: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dataModelView(iri: string, env: string): HTMLElement {
  const note = h('p', { class: 'muted small' }, 'Loading the data model…');
  const wrap = h('div', { class: 'card uml-card' }, note);
  let disposed = false;
  onDispose(() => { disposed = true; if (document.fullscreenElement === wrap) void document.exitFullscreen?.(); });
  api.model(iri, env).then((res) => {
    if (disposed) return;
    if (!res.model) { note.textContent = 'ERA’s SHACL shapes say nothing about the classes of this resource.'; return; }
    const model = res.model;
    const hasPage = !!model.page?.nodes.length;
    let all = false, view: 'page' | 'class' = hasPage ? 'page' : 'class', shape: 'diagram' | 'tree' = 'diagram';
    // The content trees: which nodes are open, and the branches loaded for the class view.
    const pageRoot = pageTree(res);
    const open = { page: new Set<string>(), class: new Set<string>() };
    const loaded = new Map<string, TNode[]>();
    const classModels = new Map<string, Promise<ClassModelResponse>>();
    let loading: string | undefined;

    const frame = h('div', { class: 'uml-canvas', tabindex: 0, 'aria-label': 'Diagram: drag to move, Ctrl + scroll or + and − to zoom' });
    const hint = h('div', { class: 'uml-hint', 'aria-hidden': 'true' }, 'Ctrl + scroll to zoom');
    let hintTimer = 0;
    const isFull = () => wrap.classList.contains('is-full');
    const pz = panZoom(frame, {
      wheel: isFull,
      onHint: () => { hint.classList.add('show'); clearTimeout(hintTimer); hintTimer = window.setTimeout(() => hint.classList.remove('show'), 1200); },
    });
    const zoomBtn = (label: string, title: string, fn: () => void) => {
      const b = h('button', { class: 'btn ghost small', type: 'button', title, 'aria-label': title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const fullBtn = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false' }, 'Full screen');
    frame.append(hint, h('div', { class: 'uml-zoom' },
      zoomBtn('+', 'Zoom in', () => pz.zoom(1.25)), zoomBtn('−', 'Zoom out', () => pz.zoom(0.8)), zoomBtn('Fit', 'Fit the diagram in the frame', () => pz.fit())));

    const pageBtn = h('button', { class: 'seg-btn', type: 'button' }, 'What this page shows');
    const classBtn = h('button', { class: 'seg-btn', type: 'button' }, `${className(model.focus)} in ERA’s model`);
    const diagramBtn = h('button', { class: 'seg-btn', type: 'button' }, 'Diagram');
    const treeBtn = h('button', { class: 'seg-btn', type: 'button' }, 'Content tree');
    const allBtn = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false' }, 'Show all attributes');
    const menu = h('details', { class: 'menu' });
    const item = (label: string, fn: () => void) => {
      const b = h('button', { type: 'button', role: 'menuitem' }, label);
      b.addEventListener('click', () => { menu.open = false; fn(); });
      return b;
    };
    const fileBase = () => `${localName(model.focus)}-${view === 'page' ? 'page' : 'data'}-model`;
    const uml = () => (view === 'page' ? pageUml(res) : classUml(res, all));
    menu.append(h('summary', { class: 'btn ghost small' }, 'Export'), h('div', { class: 'menu-items', role: 'menu' },
      item('SVG image', () => {
        const svg = frame.querySelector('svg');
        if (svg) save(standalone(svg as SVGSVGElement), `${fileBase()}${shape === 'tree' ? '-tree' : ''}.svg`, 'image/svg+xml');
      }),
      item('PlantUML', () => { const u = uml(); if (u) save(plantuml(u), `${fileBase()}.puml`, 'text/plain'); }),
      item('Mermaid', () => { const u = uml(); if (u) save(mermaid(u), `${fileBase()}.mmd`, 'text/plain'); })));

    const counts = model.boxes.reduce((t, b) => t + b.attributes.length + b.associations.length, 0);
    const pageNodes = (model.page?.nodes ?? []) as PageNode[];
    const missing = pageNodes.reduce((t, n) => t + n.members.filter((m) => m.missing).length + (n.untyped ? 1 : 0), 0);
    const about = h('p', { class: 'muted small' });

    const graft = (n: TNode): TNode => {
      if (n.children === null && loaded.has(n.key)) n.children = loaded.get(n.key)!;
      n.children?.forEach(graft);
      return n;
    };
    const toggle = (n: TNode, want: boolean) => {
      const set = open[view];
      if (!want) { set.delete(n.key); draw(true); return; }
      if (n.children !== null) { set.add(n.key); draw(true); return; }
      const cls = n.cls!;
      if (!classModels.has(cls)) classModels.set(cls, api.classModel(cls, env));
      loading = n.key;
      draw(true);
      classModels.get(cls)!.then((cm) => {
        loaded.set(n.key, branch(n, cm));
        set.add(n.key);
      }).catch(() => {
        classModels.delete(cls);
        loaded.set(n.key, []);
      }).finally(() => { loading = undefined; if (!disposed) draw(true); });
    };

    const draw = (keep = false) => {
      let svg: SVGSVGElement | null;
      if (shape === 'tree') {
        const root = view === 'page' ? pageRoot : classTree(res, all);
        svg = root ? drawTree(graft(root), open[view], env, toggle, loading) : null;
      } else {
        svg = view === 'page' ? drawPage(res) : drawModel(res, all, () => { all = true; draw(); });
      }
      if (!svg) { frame.querySelector('svg')?.remove(); return; }
      // The frame is as tall as the diagram fitted to its width, within the window.
      if (!keep && !isFull()) {
        const { w, h: hgt } = naturalSize(svg);
        const cw = frame.clientWidth || wrap.clientWidth || 800;
        const fitted = hgt * Math.min(1, (cw - 24) / w) + 24;
        frame.style.height = `${Math.round(Math.min(Math.max(fitted, 280), window.innerHeight * 0.75))}px`;
      }
      pz.show(svg, keep, shape === 'tree');
      allBtn.textContent = all ? 'Filled and mandatory only' : 'Show all attributes';
      allBtn.setAttribute('aria-pressed', String(all));
      allBtn.hidden = view === 'page';
      pageBtn.setAttribute('aria-pressed', String(view === 'page'));
      classBtn.setAttribute('aria-pressed', String(view === 'class'));
      diagramBtn.setAttribute('aria-pressed', String(shape === 'diagram'));
      treeBtn.setAttribute('aria-pressed', String(shape === 'tree'));
      const treeKey = [h('span', { class: 'uml-key' }, h('span', { class: 'tn-key' }), ' mandatory ', h('span', { class: 'tn-key optional' }), ' optional ',
        h('span', { class: 'tn-key many' }), ' repeated')];
      about.replaceChildren();
      append(about, [view === 'page'
        ? [shape === 'tree'
          ? 'What this page reads, as a tree from its class: links followed backwards are written ^name. '
          : `Every class and property this page reads, ${pageNodes.length - 1} classes away from ${className(model.focus)} at most ${Math.max(...pageNodes.map((n) => n.hop))} links. Links followed forwards are on the right, backwards on the left. Hover a property for the rows that show it.`,
        missing ? h('span', { class: 'uml-warn' }, ` ${missing} step${missing === 1 ? '' : 's'} not in ERA’s SHACL shapes, marked with ?. `) : '',
        shape === 'tree' ? treeKey : '']
        : [shape === 'tree'
          ? `${className(model.focus)} and the properties ERA’s SHACL shapes give it; open a link with + for the properties of the class it points at. `
          : `${className(model.focus)} and its superclasses in ERA’s SHACL shapes: ${counts} properties. `,
        h('span', { class: 'uml-key' }, h('span', { class: 'uml-key-dot on' }), ' filled on this resource ',
          Object.keys(res.used.via ?? {}).length ? [h('span', { class: 'uml-key-dot via' }), ' on its common characteristics subset '] : null,
          h('span', { class: 'uml-key-dot' }), ' not filled'),
        shape === 'tree' ? [' ', treeKey] : '']]);
    };
    pageBtn.addEventListener('click', () => { view = 'page'; draw(); });
    classBtn.addEventListener('click', () => { view = 'class'; draw(); });
    diagramBtn.addEventListener('click', () => { shape = 'diagram'; draw(); });
    treeBtn.addEventListener('click', () => { shape = 'tree'; draw(); });
    allBtn.addEventListener('click', () => { all = !all; draw(); });

    // Full screen: the browser's where it can, else the card over the whole window.
    const setFull = (on: boolean) => {
      wrap.classList.toggle('is-full', on);
      document.body.classList.toggle('uml-full-open', on);
      fullBtn.setAttribute('aria-pressed', String(on));
      fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
      requestAnimationFrame(() => { pz.resized(); if (on) pz.fit(); });
    };
    fullBtn.addEventListener('click', () => {
      const on = !isFull();
      if (wrap.requestFullscreen && document.fullscreenEnabled) {
        if (on) wrap.requestFullscreen().catch(() => setFull(true));
        else if (document.fullscreenElement) void document.exitFullscreen();
        else setFull(false);
      } else setFull(on);
    });
    const onFs = () => setFull(document.fullscreenElement === wrap);
    document.addEventListener('fullscreenchange', onFs);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isFull() && !document.fullscreenElement) setFull(false); };
    document.addEventListener('keydown', onKey);
    const ro = new ResizeObserver(() => pz.resized());
    ro.observe(frame);
    onDispose(() => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('uml-full-open');
      ro.disconnect();
    });

    note.replaceWith(
      h('div', { class: 'uml-head' },
        h('div', { class: 'uml-segs' },
          hasPage ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Diagram' }, pageBtn, classBtn) : null,
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Shown as' }, diagramBtn, treeBtn)),
        h('div', { class: 'uml-tools' }, allBtn, menu, fullBtn)),
      about);
    wrap.append(frame);
    draw();
  }).catch((e: Error) => { if (!disposed) note.textContent = `The data model could not be loaded: ${e.message}`; });
  return wrap;
}
