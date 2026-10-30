// Page addresses: /describe?uri=<IRI>&env=<env>[&tab=<tab>], and in-app navigation.

export function describeHref(iri: string, env: string, tab?: string): string {
  const qs = new URLSearchParams({ uri: iri, env });
  if (tab) qs.set('tab', tab);
  return `/describe?${qs}`;
}

type Handler = () => void;
let onNavigate: Handler = () => {};

export function setNavigateHandler(fn: Handler) { onNavigate = fn; }

export function navigate(href: string, replace = false) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  onNavigate();
}

/** Links marked data-nav (and every /describe link) open in the app without a page load. */
export function interceptLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.getAttribute('target') || a.hasAttribute('download')) return;
    // An SVG link (a class box of the data model) has no string href.
    const url = new URL(a.getAttribute('href') ?? '', location.href);
    if (url.origin !== location.origin || !(a.hasAttribute('data-nav') || url.pathname === '/describe')) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => onNavigate());
}
