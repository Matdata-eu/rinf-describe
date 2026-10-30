// rd:ConceptTreeViewer: SKOS concepts as a tree along skos:broader, each opening its page.
// The table row's columns: broader (skos:broader or ^skos:narrower) and notation. On a
// concept scheme it is the whole scheme; on a concept, the branch down to the concept,
// which is marked, with its broader concepts open. A concept with several broader ones sits
// under each. A filter appears on larger trees.
import type { Item } from '../api.ts';
import { h } from '../dom.ts';
import { formatNumber, termText } from '../format.ts';
import { describeHref } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import type { Widget } from './types.ts';

export interface TreeNode { iri: string; label: string; notation?: string; children: TreeNode[] }

const byNotation = (a: TreeNode, b: TreeNode) =>
  (a.notation ?? '￿').localeCompare(b.notation ?? '￿', 'en', { numeric: true }) || a.label.localeCompare(b.label, 'en', { numeric: true });

/** The roots of the tree: concepts without a broader concept among the items. Cycles are cut. */
export function buildTree(items: Item[], labels: Record<string, string>): TreeNode[] {
  const known = new Map(items.map((it) => [it.iri, it]));
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const it of items) {
    const up = (it.cells.broader ?? []).map((t) => t.iri).filter((i): i is string => !!i && i !== it.iri && known.has(i));
    if (!up.length) roots.push(it.iri);
    for (const b of new Set(up)) kids.set(b, [...(kids.get(b) ?? []), it.iri]);
  }
  const make = (iri: string, path: Set<string>): TreeNode => {
    const it = known.get(iri)!;
    const n = it.cells.notation?.[0];
    const next = new Set(path).add(iri);
    const children = (kids.get(iri) ?? []).filter((c) => !next.has(c)).map((c) => make(c, next)).sort(byNotation);
    return { iri, label: iriLabel(iri, labels), notation: n ? termText(n, labels) : undefined, children };
  };
  // A cycle with no way in from a root: start it at its first concept.
  const top = roots.length ? roots : items.slice(0, 1).map((i) => i.iri);
  return top.map((r) => make(r, new Set())).sort(byNotation);
}

/** Whether `iri` lies in the subtree of `n` (n itself included). */
function contains(n: TreeNode, iri: string): boolean {
  return n.iri === iri || n.children.some((c) => contains(c, iri));
}

function count(nodes: TreeNode[]): number {
  return nodes.reduce((k, n) => k + 1 + count(n.children), 0);
}

export const ConceptTreeViewer: Widget = {
  wide: true,
  render: ({ entry, env, labels, iri }) => {
    const items = entry.items ?? [];
    if (!items.length) return null;
    const roots = buildTree(items, labels);
    const self = items.some((it) => it.iri === iri) ? iri : null;
    const concepts = new Set(items.map((i) => i.iri)).size;
    const levels = (ns: TreeNode[]): number => ns.reduce((d, n) => Math.max(d, 1 + levels(n.children)), 0);
    const flat = levels(roots) <= 1;
    // A small tree is open; a large one shows its first level, or the branch to the concept.
    const openAll = !self && count(roots) <= 60;

    const node = (n: TreeNode, depth: number): HTMLElement => {
      const isSelf = n.iri === self;
      const head = h('span', { class: `ct-head${isSelf ? ' self' : ''}` },
        n.notation ? h('span', { class: 'ct-notation mono' }, n.notation) : null,
        isSelf ? h('strong', { class: 'ct-label', title: n.iri, 'aria-current': 'page' }, n.label)
          : h('a', { class: 'iri-link ct-label', href: describeHref(n.iri, env), title: n.iri }, n.label),
        n.children.length ? h('span', { class: 'ct-count muted small' }, formatNumber(n.children.length)) : null);
      const li = h('li', { class: 'ct-item', 'data-text': `${n.notation ?? ''} ${n.label}`.toLowerCase() });
      if (!n.children.length) {
        li.append(h('span', { class: 'ct-leaf', 'aria-hidden': 'true' }), head);
        return li;
      }
      const open = openAll || (self ? contains(n, self) : depth === 0 && roots.length <= 12);
      const details = h('details', { open },
        h('summary', null, head),
        h('ul', { class: 'ct-list' }, n.children.map((c) => node(c, depth + 1))));
      li.append(details);
      return li;
    };

    const tree = h('ul', { class: `ct-tree${flat ? ' flat' : ''}`, role: 'tree' }, roots.map((r) => node(r, 0)));
    const total = count(roots);
    const note = h('p', { class: 'muted small ct-note' },
      self ? `The branch of the scheme down to this concept, with the concepts beside it at each level.`
        : `${formatNumber(concepts)} ${concepts === 1 ? 'concept' : 'concepts'}${flat ? '' : `, ${formatNumber(roots.length)} at the top`}${total > concepts ? '; a concept with several broader ones appears under each' : ''}.`);

    let filter: HTMLElement | null = null;
    if (concepts > 20) {
      const input = h('input', { type: 'search', class: 'ct-filter', placeholder: 'Filter concepts', 'aria-label': 'Filter concepts' }) as HTMLInputElement;
      const shown = h('span', { class: 'muted small' });
      // A concept is shown when it matches, or one below it does; matches open their branch.
      const apply = () => {
        const q = input.value.trim().toLowerCase();
        let hits = 0;
        const walk = (li: HTMLElement): boolean => {
          const sub = li.querySelector(':scope > details > ul');
          const own = !q || (li.dataset.text ?? '').includes(q);
          let below = false;
          if (sub) for (const c of Array.from(sub.children) as HTMLElement[]) below = walk(c) || below;
          if (q && own) hits++;
          const visible = own || below;
          li.hidden = !visible;
          const d = li.querySelector(':scope > details') as HTMLDetailsElement | null;
          if (d && q && below) d.open = true;
          if (q && own && sub) for (const c of Array.from(sub.children) as HTMLElement[]) unhide(c);
          return visible;
        };
        const unhide = (li: HTMLElement) => { li.hidden = false; li.querySelectorAll('li').forEach((x) => { (x as HTMLElement).hidden = false; }); };
        for (const li of Array.from(tree.children) as HTMLElement[]) walk(li);
        shown.textContent = q ? `${formatNumber(hits)} ${hits === 1 ? 'match' : 'matches'}` : '';
      };
      input.addEventListener('input', apply);
      filter = h('div', { class: 'ct-tools' }, input, shown);
    }
    return h('div', { class: 'concept-tree' }, filter, tree, note);
  },
};
