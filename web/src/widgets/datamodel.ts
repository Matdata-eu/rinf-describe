// The "Data model" tab: a UML class diagram of the resource's class from ERA's SHACL shapes.
// The class and its superclasses are boxes in the middle, general on top, with their
// attributes (name: type [multiplicity]); associations go out on the right to the classes
// they point at and come in on the left from the classes that point here. Filled dots and
// solid lines are what this resource has; a ringed dot, what its common characteristics
// subset gives it.
import { api, type ModelBox, type ModelMember, type ModelResponse } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h, s } from '../dom.ts';
import { describeHref } from '../nav.ts';
import { localName, prefixed } from '../rdf.ts';

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

/** The SVG with its computed colours and fonts written in, for a download that looks the same. */
function standalone(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
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

export function dataModelView(iri: string, env: string): HTMLElement {
  const note = h('p', { class: 'muted small' }, 'Loading the data model…');
  const wrap = h('div', { class: 'card uml-card' }, note);
  let disposed = false;
  onDispose(() => { disposed = true; });
  api.model(iri, env).then((res) => {
    if (disposed) return;
    if (!res.model) { note.textContent = 'ERA’s SHACL shapes say nothing about the classes of this resource.'; return; }
    // Fitted on a wide screen; on a phone the diagram keeps its size and scrolls.
    let all = false, fit = window.innerWidth >= 700;
    const canvas = h('div', { class: `uml-canvas${fit ? ' fit' : ''}` });
    const allBtn = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false' }, 'Show all attributes');
    const fitBtn = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': String(fit) }, 'Fit to width');
    const dl = h('button', { class: 'btn ghost small', type: 'button' }, 'Download SVG');
    const draw = () => {
      canvas.replaceChildren(drawModel(res, all, () => { all = true; draw(); }) ?? '');
      allBtn.textContent = all ? 'Filled and mandatory only' : 'Show all attributes';
      allBtn.setAttribute('aria-pressed', String(all));
    };
    allBtn.addEventListener('click', () => { all = !all; draw(); });
    fitBtn.addEventListener('click', () => { fit = !fit; canvas.classList.toggle('fit', fit); fitBtn.setAttribute('aria-pressed', String(fit)); });
    dl.addEventListener('click', () => {
      const svg = canvas.querySelector('svg');
      if (!svg) return;
      const url = URL.createObjectURL(new Blob([standalone(svg as SVGSVGElement)], { type: 'image/svg+xml' }));
      const a = h('a', { href: url, download: `${localName(res.model!.focus)}-data-model.svg` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const counts = res.model.boxes.reduce((t, b) => t + b.attributes.length + b.associations.length, 0);
    note.replaceWith(
      h('div', { class: 'uml-head' },
        h('p', { class: 'muted small' }, `${className(res.model.focus)} and its superclasses in ERA’s SHACL shapes: ${counts} properties. `,
          h('span', { class: 'uml-key' }, h('span', { class: 'uml-key-dot on' }), ' filled on this resource ',
            Object.keys(res.used.via ?? {}).length ? [h('span', { class: 'uml-key-dot via' }), ' on its common characteristics subset '] : null,
            h('span', { class: 'uml-key-dot' }), ' not filled')),
        h('div', { class: 'uml-tools' }, allBtn, fitBtn, dl)));
    wrap.append(canvas);
    draw();
  }).catch((e: Error) => { if (!disposed) note.textContent = `The data model could not be loaded: ${e.message}`; });
  return wrap;
}
