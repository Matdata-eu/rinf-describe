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
          ['Type in the ', b('search'), ' box to find infrastructure by name, or paste the IRI of any RINF resource and press Enter.'],
          ['The start page has an example page for every class with a layout of its own.'],
          ['Every linked resource opens its own page. Use your browser\'s ', b('Back'), ' button to retrace your steps.']),
        section('Reading a page', false,
          ['At the top: the classes of the resource (filled for those with a page layout of their own), its name and its IRI, with ', b('Copy'), ' to copy the IRI.'],
          ['The badges under the name are the key facts, such as the number of tracks, the speed range or the electrification.'],
          ['The line under the badges says who published the data, in which environment and when it was published.'],
          ['Cards group the parameters by topic. Some pages have more tabs: a running track keeps its ', b('Route compatibility'), ' parameters on their own tab.'],
          ['Every infrastructure element has a page, with its map, identification and validity, even where its class has no layout of its own yet.'],
          [b('RINF parameters'), ': every parameter of the resource in the order of the RINF index, grouped by chapter, with a filter. Parameters of its contact line system, ETCS and train detection systems are included.'],
          ['Hover a parameter\'s name for its definition and RINF index, as ERA\'s ontology gives them.'],
          ['A parameter without a value is left out, unless the infrastructure manager marked it ', b('Not applicable'), ' or ', b('Not yet available'),
            '. The ', b('Data status'), ' card lists those parameters.']),
        section('Diagrams and charts', false,
          [b('Route'), ': the start and end operational points of a section of line with their km positions (', h('code', null, 'km 53+240'), ') and the length.'],
          [b('Map'), ': the resource on OpenStreetMap with the OpenRailwayMap overlay; its start and end points are drawn quieter.'],
          [b('Summaries over tracks'), ': a section of line sums up the parameters of its tracks, as a range (', h('code', null, '85–140 km/h'),
            ') or as values with how many tracks have them.'],
          [b('Gradient profile'), ': the gradient along the track, rising in green and falling in red.'],
          ['Gauge symbols are illustrations, not drawn to scale.'],
          [b('Scale bars'), ': a length against a 400 m passenger train or a 740 m freight train, or a range such as the contact wire height.'],
          [b('Facilities'), ': yes/no parameters as tiles, available ones first.'],
          [b('Documents'), ': the files an infrastructure manager references, with their type and a link to open them.'],
          [b('Validity'), ': the period the data is valid for on a time axis, with today marked.']),
        section('All properties, incoming links, graph and data model', false,
          [b('All properties'), ': every triple about the resource, grouped by property. The number on the tab is how many there are.'],
          [b('Incoming links'), ': the resources that link to this one, for example the section of line a track belongs to.'],
          [b('Graph'), ': the resource and its neighbours as a network. Click a neighbour to open its page.'],
          [b('Data model'), ': a UML class diagram of the resource\'s class from ERA\'s SHACL shapes: its superclasses, its attributes with their type and multiplicity, and the classes it links to and from. A filled dot or a solid line is something this resource has. "What this page shows" draws every class and property the page reads, however many links away; hover a property to see the rows that show it.']),
        section('Where the data comes from', false,
          ['Every page is read from ERA\'s SPARQL endpoint when you open it, in a fraction of a second, so it shows what ERA publishes today.'],
          ['The search box finds names through RINF Atlas; a pasted IRI opens directly.']),
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
