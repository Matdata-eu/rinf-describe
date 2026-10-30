// Pan and zoom for an SVG diagram in a frame: drag to move, Ctrl + wheel (or a plain wheel in
// full screen) and pinch to zoom, + / - / 0 on the keyboard. The view is the SVG's viewBox, so
// the drawing itself keeps its own coordinates for export.

export interface PanZoom {
  /** Put a new diagram in the frame: fitted (or at a legible size around the resource's class
   * when fitting would make the text too small), from the top left (`top`, for trees), or at
   * the view of the previous one (`keep`). */
  show(svg: SVGSVGElement, keep?: boolean, top?: boolean): void;
  /** The whole diagram in the frame. */
  fit(): void;
  zoom(factor: number): void;
  /** The frame changed size (full screen): the view keeps its centre. */
  resized(): void;
}

const MIN = 0.1, MAX = 4;
const LEGIBLE = 0.7;

/** The natural size of a diagram, from its drawing's viewBox. */
export function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const w = Number(svg.dataset.w ?? svg.getAttribute('width')), hgt = Number(svg.dataset.h ?? svg.getAttribute('height'));
  return { w, h: hgt };
}

export function panZoom(frame: HTMLElement, opts: { wheel: () => boolean; onHint?: () => void }): PanZoom {
  let svg: SVGSVGElement | null = null;
  let scale = 1, tx = 0, ty = 0;   // screen = diagram * scale + t
  let W = 0, H = 0;
  const size = () => ({ cw: frame.clientWidth || 1, ch: frame.clientHeight || 1 });
  let last = size();

  const apply = () => {
    if (!svg) return;
    const { cw, ch } = size();
    svg.setAttribute('viewBox', `${-tx / scale} ${-ty / scale} ${cw / scale} ${ch / scale}`);
  };
  // Keep at least some of the diagram in view.
  const clamp = () => {
    const { cw, ch } = size();
    const m = 60;
    tx = Math.min(cw - m, Math.max(m - W * scale, tx));
    ty = Math.min(ch - m, Math.max(m - H * scale, ty));
  };
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const next = Math.min(MAX, Math.max(MIN, scale * factor));
    tx = sx - ((sx - tx) * next) / scale;
    ty = sy - ((sy - ty) * next) / scale;
    scale = next;
    clamp();
    apply();
  };
  const fitScale = () => { const { cw, ch } = size(); return Math.min((cw - 24) / W, (ch - 24) / H, 1); };
  const fit = () => {
    const { cw, ch } = size();
    scale = Math.max(MIN, fitScale());
    tx = (cw - W * scale) / 2;
    ty = (ch - H * scale) / 2;
    apply();
  };

  const show = (next: SVGSVGElement, keep = false, top = false) => {
    const nat = naturalSize(next);
    next.dataset.w = String(nat.w);
    next.dataset.h = String(nat.h);
    next.setAttribute('width', '100%');
    next.setAttribute('height', '100%');
    next.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    frame.querySelector('svg')?.remove();
    frame.prepend(next);
    svg = next;
    W = nat.w; H = nat.h;
    last = size();
    if (keep) { clamp(); apply(); return; }
    const { cw, ch } = size();
    if (top) {
      // A tree reads from its root on the left, at a legible size.
      scale = Math.min(1, Math.max(0.85, fitScale()));
      tx = Math.max(12, (cw - W * scale) / 2);
      ty = H * scale < ch ? (ch - H * scale) / 2 : 12;
      apply();
      return;
    }
    if (fitScale() >= LEGIBLE) { fit(); return; }
    // Too big to read when fitted: at a legible size, around the resource's class.
    scale = LEGIBLE;
    const focus = next.querySelector('.uml-rect.focus');
    if (focus) {
      const n = (k: string) => Number(focus.getAttribute(k)) * scale;
      tx = cw / 2 - (n('x') + n('width') / 2);
      ty = ch / 2 - (n('y') + n('height') / 2);
    } else { tx = 12; ty = 12; }
    clamp();
    apply();
  };

  // Drag (one pointer) and pinch (two).
  const pts = new Map<number, { x: number; y: number }>();
  let moved = false, start: { x: number; y: number } | null = null, pinch = 0;
  const local = (e: PointerEvent) => { const r = frame.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  frame.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.uml-zoom, button')) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) { start = local(e); moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  frame.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (pts.size === 2) {
      pts.set(e.pointerId, p);
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d;
      moved = true;
      return;
    }
    if (!moved && start && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
    if (!moved) { moved = true; frame.setPointerCapture(e.pointerId); frame.classList.add('dragging'); }
    tx += p.x - prev.x;
    ty += p.y - prev.y;
    pts.set(e.pointerId, p);
    clamp();
    apply();
  });
  const end = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (!pts.size) frame.classList.remove('dragging');
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  // A drag is not a click on the link or button under it.
  frame.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  frame.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey || opts.wheel())) { opts.onHint?.(); return; }
    e.preventDefault();
    const r = frame.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  frame.addEventListener('keydown', (e) => {
    const { cw, ch } = size();
    const step = 60;
    const k = e.key;
    if (k === '+' || k === '=') zoomAt(1.25, cw / 2, ch / 2);
    else if (k === '-' || k === '_') zoomAt(0.8, cw / 2, ch / 2);
    else if (k === '0') fit();
    else if (k.startsWith('Arrow')) {
      tx += k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0;
      ty += k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
      clamp(); apply();
    } else return;
    e.preventDefault();
  });

  return {
    show, fit,
    zoom: (f) => { const { cw, ch } = size(); zoomAt(f, cw / 2, ch / 2); },
    resized: () => {
      const now = size();
      tx += (now.cw - last.cw) / 2;
      ty += (now.ch - last.ch) / 2;
      last = now;
      clamp();
      apply();
    },
  };
}
