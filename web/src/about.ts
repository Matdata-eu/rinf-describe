// "About" dialog: what the app is, where the data comes from, credits and the project
// repository (bugs, feature requests, questions).
import { h } from './dom.ts';
import { openHelp } from './help.ts';
import { hasPrivacy, PRIVACY_URL } from './privacy.ts';
import { whatsNewLink } from './whats-new.ts';

const REPO = ((import.meta.env.VITE_REPO_URL as string | undefined) ?? 'https://github.com/Matdata-eu/rinf-describe').replace(/\/$/, '');

let dlg: HTMLDialogElement | null = null;

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

export function openAbout() {
  if (!dlg) {
    dlg = h('dialog', { class: 'dialog about-dialog', 'aria-label': 'About RINF Describe' });
    const privacy = h('div', { hidden: true },
      h('h3', null, 'Privacy'),
      h('p', null, 'Read the ', link(PRIVACY_URL, 'privacy statement'), ' of this instance.'));
    hasPrivacy.then((ok) => { privacy.hidden = !ok; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); });
    dlg.append(
      h('div', { class: 'dlg-head' },
        h('h2', null, 'About RINF Describe'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dlg?.close() }, '×')),
      h('div', { class: 'about-body' },
        h('p', null, 'Readable pages for the resources of the EU Register of Infrastructure (RINF), for PROD and UAT: ',
          'a section of line with its route, its map and the parameters of its tracks summed up, a track with its gradient ',
          'profile and route compatibility parameters, and every other resource with all its properties. The pages are laid out ',
          'by SHACL shapes and built on the spot from ERA\'s SPARQL endpoint; the search box finds names through ',
          link('https://github.com/Matdata-eu/rinf-atlas', 'RINF Atlas'), '.'),
        h('p', null, 'New here? Read the ', h('button', { class: 'link', type: 'button', onclick: () => { dlg?.close(); openHelp(); } }, 'short guide'), '.'),
        h('p', null, whatsNewLink(() => dlg), ': what is new, improved and fixed in each release.'),
        h('h3', null, 'Feedback'),
        h('p', null, 'Found a bug, missing a feature or have a question? Open an issue on ',
          link(`${REPO}/issues/new`, 'GitHub'), '. Source code and documentation: ', link(REPO, REPO.replace(/^https:\/\//, '')), '.'),
        h('p', { class: 'muted small' }, 'Wrong or missing infrastructure data comes from the infrastructure managers through ERA, ',
          'not from this application.'),
        privacy,
        h('h3', null, 'Credits'),
        h('ul', { class: 'credits' },
          h('li', null, 'Data: ', link('https://www.era.europa.eu/domains/registers/rinf_en', 'European Union Agency for Railways (ERA), RINF'),
            '. This application is not affiliated with ERA.'),
          h('li', null, 'Basemap: ', link('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors'),
            '; railway overlay: ', link('https://www.openrailwaymap.org/', 'OpenRailwayMap'), ' (CC-BY-SA)'),
          h('li', null, 'Built with ', link('https://maplibre.org/', 'MapLibre GL JS'), ', ', link('https://visjs.github.io/vis-network/', 'vis-network'),
            ', ', link('https://www.w3.org/TR/shacl/', 'SHACL'), ' and ', link('https://datashapes.org/dash.html', 'DASH'),
            ', ', link('https://www.postgresql.org/', 'PostgreSQL'), ' and ', link('https://fastapi.tiangolo.com/', 'FastAPI'),
            '; type: ', link('https://github.com/IBM/plex', 'IBM Plex'), ' (OFL)'),
          h('li', null, 'Made by ', link('https://matdata.eu', 'Matdata'), ' · MIT licence')),
        h('p', { class: 'muted small' }, `Version ${__APP_VERSION__}`)));
    document.body.append(dlg);
  }
  dlg.showModal();
}
