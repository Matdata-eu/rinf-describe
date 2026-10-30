// Search box with suggestions: a name finds resources that have a page, an IRI opens directly.
import { api, type SearchHit } from './api.ts';
import { h } from './dom.ts';
import { describeHref, navigate } from './nav.ts';
import { humanize, localName } from './rdf.ts';

const isIri = (q: string) => /^https?:\/\/\S+$/.test(q.trim());

export function attachSearch(form: HTMLFormElement, input: HTMLInputElement, list: HTMLUListElement, env: () => string) {
  let hits: SearchHit[] = [];
  let active = -1;
  let timer = 0;
  let ctrl: AbortController | null = null;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const open = (hit: SearchHit) => { close(); input.blur(); navigate(describeHref(hit.iri, env())); };
  const paint = () => {
    list.replaceChildren(...hits.map((hit, i) => {
      const li = h('li', { role: 'option', id: `${list.id}-${i}`, 'aria-selected': String(i === active), class: i === active ? 'active' : null },
        h('span', { class: 'hit-label' }, hit.label ?? hit.iri),
        hit.class ? h('span', { class: 'hit-class' }, humanize(localName(hit.class))) : null);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); open(hit); });
      return li;
    }));
    if (!hits.length && input.value.trim().length >= 2) list.append(h('li', { class: 'empty' }, 'No resource with a page matches.'));
    list.hidden = !list.childElementCount;
    input.setAttribute('aria-expanded', String(!list.hidden));
    input.setAttribute('aria-activedescendant', active >= 0 ? `${list.id}-${active}` : '');
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2 || isIri(q)) { hits = []; close(); return; }
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        hits = (await api.search(q, env(), ctrl.signal)).results;
        active = -1;
        paint();
      } catch (e) { if ((e as Error).name !== 'AbortError') console.warn(e); }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      paint();
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (isIri(q)) { close(); navigate(describeHref(q, env())); }
    else if (hits.length) open(hits[Math.max(0, active)]);
  });
}
