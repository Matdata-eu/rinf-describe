// Start page: what RINF Describe is, a search box and one example page per class.
import { api, type Config } from './api.ts';
import { h } from './dom.ts';
import { describeHref } from './nav.ts';
import { attachSearch } from './search.ts';

export function homePage(cfg: Config, env: string): HTMLElement {
  const input = h('input', { type: 'search', id: 'home-q', placeholder: cfg.atlasUrl ? 'Section of line, track, or an IRI…' : 'The IRI of a resource…', autocomplete: 'off',
    'aria-label': 'Search a resource', 'aria-controls': 'home-q-results', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('ul', { id: 'home-q-results', class: 'suggest', role: 'listbox', hidden: true });
  const form = h('form', { class: 'search big', role: 'search' }, input, list, h('button', { class: 'btn primary', type: 'submit' }, 'Describe'));
  attachSearch(form, input, list, () => env);
  const examples = h('ul', { class: 'examples' }, h('li', { class: 'muted' }, 'Loading examples…'));
  api.examples(env).then(({ results }) => {
    examples.replaceChildren(...(results.length ? results.map((x) => h('li', null,
      h('a', { class: 'example', href: describeHref(x.iri, env) },
        h('span', { class: 'class-pill' }, x.classLabel ?? x.class),
        h('span', { class: 'example-label' }, x.label ?? x.iri))))
      : [h('li', { class: 'muted' }, 'No resource of a class with a page layout in this environment.')]));
  }).catch(() => examples.replaceChildren(h('li', { class: 'error' }, 'The API did not answer.')));
  return h('article', { class: 'home' },
    h('section', { class: 'card wide intro' },
      h('h1', null, 'Describe a RINF resource'),
      h('p', { class: 'lead' }, 'Every section of line, track and the other resources of the EU Register of Railway Infrastructure as a readable page: the route, the map, the parameters of the tracks summed up, and everything else that is published about it.'),
      form),
    h('section', { class: 'card wide' }, h('h2', null, 'Examples'), examples),
    h('section', { class: 'card wide about' },
      h('h2', null, 'How it works'),
      h('p', null, 'Pages are laid out by SHACL shapes with DASH viewers: which properties a class shows, in which group and order, and which widget draws them. Each page is built on the spot from ERA\'s SPARQL endpoint, so it always shows the data ERA publishes today.'),
      h('p', null, 'Shapes and source: ', h('a', { href: 'https://github.com/Matdata-eu/rinf-describe' }, 'github.com/Matdata-eu/rinf-describe'),
        '. Data: ', h('a', { href: 'https://www.era.europa.eu/domains/registers/rinf_en' }, 'ERA RINF'), '.')));
}
