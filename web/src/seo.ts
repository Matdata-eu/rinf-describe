// Per-page title, description, canonical link and robots tag. The web container writes the
// site-wide tags at start (docker-entrypoint.d/40-describe-seo.sh): a canonical link to the
// public address when search engines may index the instance, a noindex tag otherwise. This
// points the canonical link at the page shown, and keeps pages that are not in the sitemap
// (other environments, resources read live, unknown IRIs) out of search engines.

const SITE = 'RINF Describe';
const DEFAULT_DESCRIPTION = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? '';
const base = (() => {
  const href = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return href ? href.replace(/\/+$/, '') : null;
})();
// The instance itself asks not to be indexed (no public address, or DESCRIBE_INDEXING=off).
const siteNoindex = !!document.querySelector('meta[name="robots"]:not([data-page])');

function meta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]${key === 'robots' ? '[data-page]' : ''}`);
  if (content === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    if (key === 'robots') el.dataset.page = '';
    document.head.append(el);
  }
  el.content = content;
}

export interface PageMeta {
  /** Page title without the site name; null for the start page. */
  title: string | null;
  description?: string;
  /** Path and query of the page's canonical address, e.g. /describe?uri=…&env=prod. */
  path: string;
  /** Whether search engines may index this page (when the instance allows indexing at all). */
  index: boolean;
}

export function setPageMeta(m: PageMeta) {
  const full = m.title ? `${m.title} · ${SITE}` : SITE;
  document.title = full;
  const description = m.description || DEFAULT_DESCRIPTION;
  meta('name', 'description', description);
  meta('property', 'og:title', m.title ?? `${SITE}: readable pages for the EU railway infrastructure register`);
  meta('property', 'og:description', description);
  if (base) {
    const url = `${base}${m.path === '/' ? '/' : m.path}`;
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href = url;
    meta('property', 'og:url', url);
  }
  meta('name', 'robots', !siteNoindex && !m.index ? 'noindex' : null);
}

/** "Section of line Michelau <-> Goebelsmuhle in RINF (PROD): 2 tracks, 95–100 km/h. Data: CFL." */
export function describeDescription(classLabel: string | null, title: string, env: string, badges: string[], provider?: string | null): string {
  const head = `${classLabel ? `${classLabel} ` : ''}${title} in the EU Register of Railway Infrastructure (RINF, ${env})`;
  const facts = badges.length ? `: ${badges.join(', ')}` : '';
  const from = provider ? ` Data: ${provider}.` : '';
  const text = `${head}${facts}.${from}`;
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

/** Canonical path of a describe page: the default tab, uri before env (as in the sitemap). */
export function describePath(iri: string, env: string): string {
  return `/describe?${new URLSearchParams({ uri: iri, env })}`;
}
