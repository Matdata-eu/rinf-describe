// The content tree of the data model: the class at the root, its properties as boxes to the
// right (dashed when optional, stacked when repeated, the multiplicity under them), and the
// properties of the class a link points at one level further when it is opened. Drawn left to
// right like the content trees of XML editors.
import type { ClassModelResponse, ModelBox, ModelMember, ModelResponse } from '../api.ts';
import { s } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { localName, prefixed } from '../rdf.ts';
import { textWidth, typeName } from './datamodel.ts';
import { mult } from './umltext.ts';

export interface TNode {
  key: string;
  name: string;
  /** The datatype, code list or class of the values. */
  type?: string;
  /** The class the values are, when they are resources: the node opens into its properties. */
  cls?: string;
  min: number;
  max: number | null;
  /** A caption above the node: the superclass its properties come from. */
  note?: string;
  /** Filled on this resource (on), on its common characteristics subset (via), not (off); a step ERA's shapes do not have (missing). */
  state?: 'on' | 'via' | 'off' | 'missing';
  untyped?: boolean;
  root?: boolean;
  tip?: string;
  /** The children, or null while they are not loaded. */
  children: TNode[] | null;
}

const NAME_FONT = '600 13px "IBM Plex Sans", sans-serif', TYPE_FONT = '11px "IBM Plex Mono", monospace', NOTE_FONT = '11px "IBM Plex Sans", sans-serif';
const GAP_X = 34, GAP_Y = 14;

const tipOf = (m: ModelMember) => [m.label, m.comment, m.index?.length ? `RINF ${m.index.join(', ')}` : null, prefixed(m.p)].filter(Boolean).join('\n');

/** The properties of a class and its superclasses, the class's own first, each superclass's
 * under a caption. */
export function memberNodes(boxes: ModelBox[], key: string, keep: (m: ModelMember) => boolean, state?: (m: ModelMember) => TNode['state']): TNode[] {
  const out: TNode[] = [], seen = new Set<string>();
  boxes.forEach((b, i) => {
    // A property a subclass narrows is listed once, as the subclass has it.
    const ms = [...b.attributes, ...b.associations].filter((m) => keep(m) && !seen.has(m.p)).sort((x, y) => localName(x.p).localeCompare(localName(y.p)));
    ms.forEach((m) => seen.add(m.p));
    ms.forEach((m, j) => out.push({
      key: `${key}/${localName(m.p)}`, name: localName(m.p), type: m.class ? localName(m.class) : typeName(m), cls: m.class,
      min: m.min, max: m.max, note: i > 0 && j === 0 ? `from ${localName(b.iri)}` : undefined, state: state?.(m), tip: tipOf(m), children: m.class ? null : [],
    }));
  });
  return out;
}

/** The root of the class view's tree. */
export function classTree(res: ModelResponse, all: boolean): TNode | null {
  const m = res.model;
  if (!m) return null;
  const on = (p: string) => (res.used.out[p] ?? 0) > 0, via = (p: string) => !on(p) && (res.used.via?.[p] ?? 0) > 0;
  const state = (x: ModelMember): TNode['state'] => (on(x.p) ? 'on' : via(x.p) ? 'via' : 'off');
  const keep = (x: ModelMember) => all || on(x.p) || via(x.p) || x.min > 0;
  return { key: 'r', name: localName(m.focus), cls: m.focus, min: 1, max: 1, root: true, tip: prefixed(m.focus), children: memberNodes(m.boxes, 'r', keep, state) };
}

/** The children of a link opened in the class view: every property of the class it points at. */
export function branch(n: TNode, cm: ClassModelResponse): TNode[] {
  return memberNodes(cm.boxes, n.key, () => true);
}

interface PNode { iri: string; hop: number; side: number; members: (ModelMember & { missing?: boolean })[]; untyped?: boolean }
interface PEdge extends ModelMember { from: string; to: string; missing?: boolean }

/** The root of the page view's tree: the properties the page reads, and the links it follows
 * (backwards ones written ^name), each opening into what the page reads further on. */
export function pageTree(res: ModelResponse): TNode | null {
  const pm = res.model?.page;
  if (!pm?.nodes.length) return null;
  const nodes = new Map((pm.nodes as PNode[]).map((n) => [n.iri, n]));
  const edges = (pm.edges as PEdge[]).filter((e) => e.from !== e.to);
  const used = new Set<PEdge>();
  const nameOf = (iri: string) => localName(nodes.get(iri)?.untyped ? iri.replace(/^untyped:\^?/, '') : iri);
  const build = (iri: string, key: string): TNode[] => {
    const n = nodes.get(iri);
    const out: TNode[] = (n?.members ?? []).map((m) => ({
      key: `${key}/${localName(m.p)}`, name: localName(m.p), type: m.missing ? '?' : typeName(m), min: m.min, max: m.max,
      state: m.missing ? 'missing' : 'on', tip: tipOf(m) + (m.missing ? '\nNot in ERA’s SHACL shapes' : ''), children: [],
    }));
    const mine = edges.filter((e) => !used.has(e) && (e.from === iri || e.to === iri));
    mine.forEach((e) => used.add(e));
    for (const e of mine) {
      const fwd = e.from === iri, other = fwd ? e.to : e.from;
      const k = `${key}/${fwd ? '' : '^'}${localName(e.p)}`;
      out.push({
        key: k, name: `${fwd ? '' : '^'}${localName(e.p)}`, type: nameOf(other), cls: nodes.get(other)?.untyped ? undefined : other,
        min: fwd ? e.min : 0, max: fwd ? e.max : null, state: e.missing ? 'missing' : 'on', untyped: nodes.get(other)?.untyped,
        tip: (fwd ? '' : `Followed backwards: the ${nameOf(other)} that points here\n`) + tipOf(e) + (e.missing ? '\nNot in ERA’s SHACL shapes' : ''),
        children: [],
      });
    }
    // Children after the links of this level are taken, so a link followed twice opens once.
    for (const c of out) if (c.cls) c.children = build(c.cls, c.key);
    return out;
  };
  const focus = res.model!.focus;
  return { key: 'r', name: localName(focus), cls: focus, min: 1, max: 1, root: true, tip: prefixed(focus), children: build(focus, 'r') };
}

interface Placed { n: TNode; x: number; y: number; w: number; h: number; open: boolean; kids: Placed[]; total: number }

function boxSize(n: TNode): { w: number; h: number } {
  const w = Math.max(textWidth(n.name, NAME_FONT), n.type ? textWidth(n.type, TYPE_FONT) : 0) + 24 + (expandable(n) ? 10 : 0);
  return { w: Math.max(80, Math.ceil(w)), h: n.type ? 40 : 28 };
}
const expandable = (n: TNode) => !n.root && (n.children === null || n.children.length > 0);

function place(n: TNode, x: number, y: number, open: Set<string>): Placed {
  const { w, h } = boxSize(n);
  const note = n.note ? 14 : 0, occ = n.root ? 0 : n.max === null || n.max > 1 ? 16 : 12;
  const isOpen = (n.root || open.has(n.key)) && !!n.children?.length;
  const p: Placed = { n, x, y: y + note, w, h, open: isOpen, kids: [], total: h + note + occ };
  if (!isOpen) return p;
  const span = Math.max(w, n.note ? Math.ceil(textWidth(n.note, NOTE_FONT)) : 0);
  let cy = y;
  for (const c of n.children!) {
    const k = place(c, x + span + GAP_X, cy, open);
    p.kids.push(k);
    cy += k.total + GAP_Y;
  }
  const kidsH = Math.max(0, cy - y - GAP_Y), own = h + note + occ;
  if (kidsH > own) p.y = y + note + (kidsH - own) / 2;   // centred on its children
  p.total = Math.max(own, kidsH);
  return p;
}

/** The tree as an SVG; `onToggle` opens or closes a node. */
export function drawTree(root: TNode, open: Set<string>, env: string, onToggle: (n: TNode, open: boolean) => void, loading?: string): SVGSVGElement {
  const laid = place(root, 16, 16, open);
  let W = 0, H = 0;
  const edges = s('g', { class: 'uml-edges' }), boxes = s('g');
  const draw = (p: Placed) => {
    const n = p.n;
    W = Math.max(W, p.x + p.w + 24);
    H = Math.max(H, p.y + p.h + 28);
    const many = n.max === null || n.max > 1;
    const g = s('g', { class: `tn${n.root ? ' root' : ''}${n.min === 0 && !n.root ? ' optional' : ''} ${n.state ?? ''}` });
    if (n.note) g.append(s('text', { x: p.x, y: p.y - 6, class: 'tn-note' }, n.note));
    if (many && !n.root) g.append(s('rect', { x: p.x + 4, y: p.y + 4, width: p.w, height: p.h, rx: 4, class: 'tn-box stack' }));
    g.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 4, class: `tn-box${n.root ? ' uml-rect focus' : ''}` }));
    if (n.tip) g.append(s('title', {}, n.tip));
    const nameY = n.type ? p.y + 16 : p.y + p.h / 2 + 4;
    const name = s('text', { x: p.x + 10, y: nameY, class: 'tn-name' }, n.name);
    if (n.root && n.cls) {
      const a = s('a', { href: describeHref(n.cls, env) });
      a.append(name);
      g.append(a);
    } else g.append(name);
    if (n.type) {
      const t = s('text', { x: p.x + 10, y: p.y + 31, class: 'tn-type' }, n.type);
      if (n.cls) {
        const a = s('a', { href: describeHref(n.cls, env) });
        a.append(s('title', {}, prefixed(n.cls)), t);
        g.append(a);
      } else g.append(t);
    }
    if (!n.root) g.append(s('text', { x: p.x + p.w + (many ? 4 : 0), y: p.y + p.h + (many ? 15 : 11), class: 'tn-occ', 'text-anchor': 'end' }, mult(n)));
    if (expandable(n)) {
      const ex = s('g', { class: 'tn-expander', role: 'button', tabindex: 0, 'aria-label': `${p.open ? 'Close' : 'Open'} ${n.name}` });
      ex.append(s('circle', { cx: p.x + p.w, cy: p.y + p.h / 2, r: 7 }));
      const cx = p.x + p.w, cy = p.y + p.h / 2;
      const busy = loading === n.key;
      ex.append(s('path', { d: busy ? `M${cx - 3} ${cy}h1M${cx} ${cy}h1M${cx + 3} ${cy}h1` : p.open ? `M${cx - 3.5} ${cy}H${cx + 3.5}` : `M${cx - 3.5} ${cy}H${cx + 3.5}M${cx} ${cy - 3.5}V${cy + 3.5}` }));
      ex.append(s('title', {}, p.open ? 'Close' : `Open the properties of ${n.type}`));
      const toggle = (e: Event) => { e.stopPropagation(); onToggle(n, !p.open); };
      ex.addEventListener('click', toggle);
      ex.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); toggle(e); } });
      g.append(ex);
    }
    boxes.append(g);
    if (!p.kids.length) return;
    const sx = p.x + p.w + (expandable(p.n) ? 7 : 0), sy = p.y + p.h / 2;
    const bx = p.kids[0].x - GAP_X / 2;
    const ys = p.kids.map((k) => k.y + k.h / 2);
    edges.append(s('path', { d: `M${sx} ${sy}H${bx}M${bx} ${Math.min(...ys, sy)}V${Math.max(...ys, sy)}` }));
    for (const k of p.kids) edges.append(s('path', { d: `M${bx} ${k.y + k.h / 2}H${k.x}` }));
    p.kids.forEach(draw);
  };
  draw(laid);
  const svg = s('svg', { viewBox: `0 0 ${Math.ceil(W)} ${Math.ceil(H)}`, width: Math.ceil(W), height: Math.ceil(H), class: 'uml-svg tree-svg', role: 'img',
    'aria-label': `Content tree of ${root.name}` }) as SVGSVGElement;
  svg.append(edges, boxes);
  return svg;
}
