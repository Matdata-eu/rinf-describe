// A small element builder: h('div', { class: 'x' }, 'text', child).
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** Whether a URL may go into an href or src: not javascript:, vbscript: or data:. Values come
 * from ERA's data and from the address bar, so a link never runs script. Browsers ignore
 * tabs, newlines and leading spaces in a scheme, so those are dropped before the check. */
export function safeUrl(url: string): boolean {
  return !/^(javascript|vbscript|data):/.test(url.replace(/[\u0000-\u0020]/g, '').toLowerCase());
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
      else if ((k === 'href' || k === 'src') && !safeUrl(String(v))) continue;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'number' ? String(c) : c);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs: Record<string, string | number | null | undefined> = {}, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

/** Elements joined with a separator ("a · b · c"). */
export function joined(items: Node[], sep = ' · '): Node[] {
  const out: Node[] = [];
  items.forEach((n, i) => { if (i) out.push(h('span', { class: 'sep', 'aria-hidden': 'true' }, sep)); out.push(n); });
  return out;
}
