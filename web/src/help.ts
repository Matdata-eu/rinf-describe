// "Help" dialog: a short user guide, one foldable section per topic. Controls are named by
// their label, not by where they sit on screen, so the guide survives layout changes.
import { h } from './dom.ts';
import { openTour } from './tour.ts';
import { whatsNewLink } from './whats-new.ts';

const REPO = ((import.meta.env.VITE_REPO_URL as string | undefined) ?? 'https://github.com/Matdata-eu/rinf-describe').replace(/\/$/, '');

let dlg: HTMLDialogElement | null = null;

const b = (text: string) => h('strong', null, text);
const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

type Part = string | Node;
const section = (title: string, open: boolean, ...items: Part[][]) =>
  h('details', { class: 'help-sec', open },
    h('summary', null, title),
    h('ul', null, items.map((parts) => h('li', null, parts))));

export function openHelp() {
  if (!dlg) {
    dlg = h('dialog', { class: 'dialog about-dialog help-dialog', 'aria-label': 'Help' });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); });
    dlg.append(
      h('div', { class: 'dlg-head' },
        h('h2', null, 'How to use RINF Describe'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dlg?.close() }, '×')),
      h('div', { class: 'about-body help-body' },
        h('p', { class: 'muted' }, 'Read any resource of the EU Register of Infrastructure (RINF) as a page: what it is, ',
          'where it is, its parameters, and everything else that is published about it. Open a topic below.'),
        h('p', { class: 'muted' }, 'Recent changes: ', whatsNewLink(() => dlg), '.'),
        h('p', { class: 'help-tour' }, 'New here? Take the short tour: ',
          h('button', { class: 'link', type: 'button', onclick: () => { dlg?.close(); openTour(); } }, 'How RINF Describe works'), '.'),
        section('Getting started', true,
          ['Pick ', b('PROD'), ' or ', b('UAT'), ' in the environment list in the top bar.'],
          ['Type in the ', b('search'), ' box to find sections of line and tracks by name, or paste the IRI of any RINF resource and press Enter.'],
          ['The start page has an example page for every class with a layout of its own.'],
          ['Every linked resource opens its own page. Use your browser\'s ', b('Back'), ' button to retrace your steps.']),
        section('Reading a page', false,
          ['At the top: the classes of the resource (filled for those with a page layout of their own), its name and its IRI, with ', b('Copy'), ' to copy the IRI.'],
          ['The badges under the name are the key facts, such as the number of tracks, the speed range or the electrification.'],
          ['The line under the badges says who published the data, in which environment, when it was published and when the index last read it.'],
          ['Cards group the parameters by topic. Some pages have more tabs: a running track keeps its ', b('Route compatibility'), ' parameters on their own tab.'],
          ['A parameter without a value is left out, unless the infrastructure manager marked it ', b('Not applicable'), ' or ', b('Not yet available'),
            '. The ', b('Data status'), ' card lists those parameters.']),
        section('Diagrams and charts', false,
          [b('Route'), ': the start and end operational points of a section of line with their km positions (', h('code', null, 'km 53+240'), ') and the length.'],
          [b('Map'), ': the resource on OpenStreetMap with the OpenRailwayMap overlay; its start and end points are drawn quieter.'],
          [b('Summaries over tracks'), ': a section of line sums up the parameters of its tracks, as a range (', h('code', null, '85–140 km/h'),
            ') or as values with how many tracks have them.'],
          [b('Gradient profile'), ': the gradient along the track, rising in green and falling in red.'],
          ['Gauge symbols are illustrations, not drawn to scale.'],
          [b('Validity'), ': the period the data is valid for on a time axis, with today marked.']),
        section('All properties, incoming links and graph', false,
          [b('All properties'), ': every triple about the resource, grouped by property. The number on the tab is how many there are.'],
          [b('Incoming links'), ': the resources that link to this one, for example the section of line a track belongs to.'],
          [b('Graph'), ': the resource and its neighbours as a network. Click a neighbour to open its page.']),
        section('Indexed and live pages', false,
          ['Pages come from an index that RINF Atlas refreshes when ERA publishes new datasets, so they open quickly.'],
          ['A resource that is not in the index yet is read live from ERA\'s SPARQL endpoint: the same page, built on the spot in a fraction of a second, ',
            '"read live from ERA" under the title says so.']),
        section('Export, share and display', false,
          [b('Export'), ' downloads the triples of the resource as Turtle, N-Triples or CSV.'],
          [b('Open in RINF Atlas'), ' shows the resource on the map of RINF Atlas, with its filters and the vehicle check.'],
          [b('Share'), ' copies a link to the page and the tab you are on. On a phone it opens the share sheet.'],
          ['The theme button switches between system, light and dark.']),
        section('How pages are made', false,
          ['What a page shows, in which card, tab and order, and which diagram draws each value is set in SHACL shapes with DASH viewers, ',
            'not in code. Adding a class is a Turtle file.'],
          ['Whoever runs this site may change the shapes, so pages can differ between instances. The shapes of this project: ',
            link(`${REPO}/tree/main/shapes`, 'shapes'), ', explained in ', link(`${REPO}/blob/main/docs/shapes.md`, 'docs/shapes.md'), '.'])));
    document.body.append(dlg);
  }
  dlg.showModal();
}
