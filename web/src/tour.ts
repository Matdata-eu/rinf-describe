// "How RINF Describe works": a short tour that opens on the first visit. Three pages of three
// items, each with a small drawing. The Help dialog links to it so it can be reopened.
import { h } from './dom.ts';

// Seen is kept in this browser per version of the tour: bump the version when the pages
// change enough that everyone should see them again.
const SEEN_KEY = 'describe-tour';
const VERSION = '2026-10-30';

type Item = { title: string; text: string; art: string };
type Page = { title: string; items: Item[] };

// Drawings on a 64×48 canvas. The classes pick theme colours (style.css, .tour-art).
const svg = (body: string) =>
  `<svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">${body}</svg>`;

const ART = {
  env: svg('<rect class="ta-soft" x="6" y="12" width="52" height="24" rx="12"/>'
    + '<rect class="ta-fill" x="8" y="14" width="26" height="20" rx="10"/>'
    + '<text class="ta-on" x="21" y="27.5" text-anchor="middle">PROD</text>'
    + '<text class="ta-txt" x="45" y="27.5" text-anchor="middle">UAT</text>'),
  search: svg('<rect class="ta-soft" x="4" y="8" width="44" height="14" rx="7"/>'
    + '<path class="ta-muted" d="M11 15h22"/><path class="ta-muted" d="M11 30h28M11 37h20"/>'
    + '<circle class="ta-line" cx="46" cy="28" r="8"/><path class="ta-line ta-thick" d="m52 34 7 7"/>'),
  links: svg('<rect class="ta-card" x="3" y="6" width="26" height="36" rx="3"/>'
    + '<path class="ta-line" d="M8 13h14"/><path class="ta-muted" d="M8 21h16M8 28h12M8 35h14"/>'
    + '<rect class="ta-card" x="35" y="6" width="26" height="36" rx="3"/>'
    + '<path class="ta-line" d="M40 13h14"/><path class="ta-muted" d="M40 21h16M40 28h12"/>'
    + '<path class="ta-line" d="M22 28c6 0 8-7 15-7"/><path class="ta-line" d="m33 18 4 3-4 3"/>'),
  head: svg('<rect class="ta-card" x="6" y="3" width="52" height="42" rx="4"/>'
    + '<rect class="ta-fill" x="12" y="9" width="16" height="5" rx="2.5"/>'
    + '<path class="ta-line ta-thick" d="M12 21h30"/>'
    + '<rect class="ta-soft" x="12" y="29" width="17" height="8" rx="4"/><rect class="ta-soft" x="32" y="29" width="17" height="8" rx="4"/>'),
  route: svg('<path class="ta-rail" d="M8 30h48"/>'
    + '<circle class="ta-dot" cx="8" cy="30" r="4"/><circle class="ta-dot" cx="56" cy="30" r="4"/>'
    + '<path class="ta-muted" d="M8 16v6M56 16v6"/>'
    + '<text class="ta-txt" x="8" y="12" text-anchor="middle">km 12</text><text class="ta-txt" x="56" y="12" text-anchor="middle">km 18</text>'
    + '<text class="ta-txt" x="32" y="44" text-anchor="middle">6.1 km</text>'),
  tabs: svg('<rect class="ta-card" x="4" y="12" width="56" height="32" rx="3"/>'
    + '<path class="ta-muted" d="M8 7h18"/><path class="ta-tab" d="M32 7h24"/>'
    + '<path class="ta-muted" d="M10 21h14M30 21h22M10 28h14M30 28h16M10 35h14M30 35h20"/>'),
  table: svg('<rect class="ta-card" x="4" y="4" width="56" height="40" rx="3"/>'
    + '<path class="ta-line" d="M10 12h14M30 12h24"/>'
    + '<path class="ta-muted" d="M4 18h56M10 25h14M30 25h20M10 32h14M30 32h16M10 39h14M30 39h22"/>'),
  graph: svg('<path class="ta-muted" d="M32 24 12 10M32 24 52 12M32 24 14 38M32 24 50 38"/>'
    + '<circle class="ta-fill" cx="32" cy="24" r="7"/>'
    + '<rect class="ta-soft" x="5" y="5" width="14" height="10" rx="3"/><rect class="ta-soft" x="45" y="7" width="14" height="10" rx="3"/>'
    + '<rect class="ta-soft" x="7" y="33" width="14" height="10" rx="3"/><rect class="ta-soft" x="43" y="33" width="14" height="10" rx="3"/>'),
  share: svg('<rect class="ta-soft" x="4" y="16" width="56" height="16" rx="8"/>'
    + '<path class="ta-line" d="M14 26.5a3.5 3.5 0 0 1 0-5h4m2 0h4a3.5 3.5 0 0 1 0 5h-4"/><path class="ta-line" d="M17 24h6"/>'
    + '<path class="ta-muted" d="M32 24h20"/>'),
};

const PAGES: Page[] = [
  { title: 'Find a resource', items: [
    { art: ART.env, title: 'Choose the data',
      text: 'RINF Describe shows the EU Register of Infrastructure. Pick PROD for the published data or UAT for the test register in the top bar.' },
    { art: ART.search, title: 'Search or paste an IRI',
      text: 'Type the name of a section of line or a track, or paste the IRI of any RINF resource.' },
    { art: ART.links, title: 'Follow links',
      text: 'Every linked resource opens its own page: an operational point, a track, its contact line. Your browser\'s Back button retraces your steps.' },
  ] },
  { title: 'Read a page', items: [
    { art: ART.head, title: 'What it is at a glance',
      text: 'The class, the name, the IRI and badges with the key facts, such as the number of tracks or the speed.' },
    { art: ART.route, title: 'Route and map',
      text: 'A section of line shows where it starts and ends, with km positions, and the line on a map.' },
    { art: ART.tabs, title: 'Tabs for each topic',
      text: 'A track keeps its route compatibility parameters on their own tab. Parameters marked not applicable or not yet available say so.' },
  ] },
  { title: 'Everything about it', items: [
    { art: ART.table, title: 'All properties and incoming links',
      text: 'Every triple about the resource, and every resource that links to it.' },
    { art: ART.graph, title: 'Graph',
      text: 'The resource and its neighbours as a network. Click a neighbour to open its page.' },
    { art: ART.share, title: 'Export and share',
      text: 'Download the triples as Turtle, RDF/XML, JSON-LD, N-Triples or CSV. Share copies a link to the page and tab you are on.' },
  ] },
];

let dlg: HTMLDialogElement | null = null;
let page = 0;
let go: (i: number) => void = () => {};
let seenNow = false; // when storage is blocked, the tour stays closed for this visit

export function tourSeen(): boolean {
  if (seenNow) return true;
  try { return (localStorage.getItem(SEEN_KEY) ?? '') >= VERSION; } catch { return false; }
}

function markSeen() {
  seenNow = true;
  try { localStorage.setItem(SEEN_KEY, VERSION); } catch { /* not persisted; closed for this visit */ }
}

function build(): HTMLDialogElement {
  const d = h('dialog', { class: 'dialog tour-dialog', 'aria-label': 'How RINF Describe works' });
  const heading = h('h2', null, '');
  const step = h('span', { class: 'tour-step muted' });
  const body = h('div', { class: 'tour-body', 'aria-live': 'polite' });
  const dots = h('div', { class: 'tour-dots' });
  const back = h('button', { class: 'btn', type: 'button', onclick: () => go(page - 1) }, 'Back');
  const next = h('button', { class: 'btn primary tour-next', type: 'button',
    onclick: () => (page < PAGES.length - 1 ? go(page + 1) : d.close()) }, 'Next');
  const skip = h('button', { class: 'link tour-skip', type: 'button', onclick: () => d.close() }, 'Skip the tour');

  go = (i: number) => {
    page = Math.max(0, Math.min(PAGES.length - 1, i));
    const p = PAGES[page];
    heading.textContent = p.title;
    step.textContent = `${page + 1} of ${PAGES.length}`;
    body.replaceChildren(...p.items.map((it) => {
      const art = h('div', { class: 'tour-art' });
      art.innerHTML = it.art;
      return h('div', { class: 'tour-item' }, art, h('div', null, h('h3', null, it.title), h('p', null, it.text)));
    }));
    dots.replaceChildren(...PAGES.map((pg, j) => h('button', {
      class: 'tour-dot', type: 'button', 'aria-current': j === page ? 'step' : undefined,
      'aria-label': `Page ${j + 1}: ${pg.title}`, onclick: () => go(j),
    })));
    back.hidden = page === 0;
    skip.hidden = page === PAGES.length - 1;
    next.textContent = page < PAGES.length - 1 ? 'Next' : 'Start exploring';
  };

  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', markSeen);
  d.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') { go(page + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(page - 1); e.preventDefault(); }
  });
  d.append(
    h('div', { class: 'dlg-head' },
      h('div', { class: 'tour-title' }, h('span', { class: 'tour-kicker' }, 'How RINF Describe works'), heading),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, '×')),
    body,
    h('div', { class: 'tour-foot' }, h('div', { class: 'tour-nav-left' }, dots, step),
      h('div', { class: 'tour-nav' }, skip, back, next)));
  return d;
}

/** Open the tour at its first page. */
export function openTour() {
  if (!dlg) { dlg = build(); document.body.append(dlg); }
  go(0);
  dlg.showModal();
  dlg.querySelector<HTMLButtonElement>('.tour-next')?.focus();
}

/** Open the tour unless this browser has seen it. */
export function maybeOpenTour() {
  if (!tourSeen()) openTour();
}
