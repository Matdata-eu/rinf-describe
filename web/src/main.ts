import './style.css';
import { api, type Config } from './api.ts';
import { disposeAll } from './cleanup.ts';
import { h } from './dom.ts';
import { homePage } from './home.ts';
import { interceptLinks, navigate, setNavigateHandler } from './nav.ts';
import { describePage } from './page.ts';
import { attachSearch } from './search.ts';
import { setTheme, themePref, type ThemePref } from './theme.ts';

const app = document.getElementById('app')!;
const envSelect = document.getElementById('env-select') as HTMLSelectElement;
let cfg: Config = { envs: [{ key: 'prod', label: 'PROD', indexed: false, updatedAt: null }], live: true, atlasUrl: null };

const params = () => new URLSearchParams(location.search);
const currentEnv = () => {
  const e = params().get('env');
  return e && cfg.envs.some((x) => x.key === e) ? e : cfg.envs[0].key;
};

let seq = 0;
async function route() {
  const my = ++seq;
  disposeAll();
  const env = currentEnv();
  envSelect.value = env;
  if (location.pathname === '/describe') {
    const uri = params().get('uri');
    if (!uri) { navigate('/', true); return; }
    app.replaceChildren(h('p', { class: 'loading muted' }, 'Loading…'));
    document.title = 'RINF Describe';
    try {
      const r = await api.describe(uri, env);
      if (my !== seq) return;
      const page = describePage(r, cfg, params().get('tab'), (tab) => {
        const qs = params();
        if (tab === 'overview' || (!r.pages.length && tab === 'properties')) qs.delete('tab'); else qs.set('tab', tab);
        history.replaceState(null, '', `/describe?${qs}`);
      });
      app.replaceChildren(page);
      document.title = `${page.querySelector('h1')?.textContent ?? 'Resource'} · RINF Describe`;
    } catch (e) {
      if (my !== seq) return;
      app.replaceChildren(h('article', { class: 'page' }, h('section', { class: 'card wide' },
        h('h1', null, 'This resource could not be described'), h('p', { class: 'error' }, String((e as Error).message ?? e)),
        h('p', null, h('a', { href: '/', 'data-nav': true }, 'Back to search')))));
    }
  } else if (location.pathname === '/') {
    document.title = 'RINF Describe';
    app.replaceChildren(homePage(cfg, env));
  } else {
    app.replaceChildren(h('article', { class: 'page' }, h('section', { class: 'card wide' },
      h('h1', null, 'Page not found'), h('p', null, h('a', { href: '/', 'data-nav': true }, 'Go to the start page')))));
  }
  window.scrollTo(0, 0);
}

function themeButton() {
  const btn = document.getElementById('theme-btn') as HTMLButtonElement;
  const next: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
  const text: Record<ThemePref, string> = { auto: 'Theme: follows the system', light: 'Theme: light', dark: 'Theme: dark' };
  const icon: Record<ThemePref, string> = {
    auto: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13.5 9.5A5.75 5.75 0 0 1 6.5 2.5a5.75 5.75 0 1 0 7 7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  };
  const paint = () => { const p = themePref(); btn.innerHTML = icon[p]; btn.title = `${text[p]} (click to change)`; btn.setAttribute('aria-label', text[p]); };
  btn.addEventListener('click', () => { setTheme(next[themePref()]); paint(); });
  paint();
}

async function init() {
  themeButton();
  interceptLinks();
  setNavigateHandler(route);
  try { cfg = await api.config(); } catch (e) { console.warn('config', e); }
  envSelect.replaceChildren(...cfg.envs.map((e) => h('option', { value: e.key }, e.label)));
  envSelect.addEventListener('change', () => {
    const qs = params();
    qs.set('env', envSelect.value);
    navigate(`${location.pathname}?${qs}`);
  });
  attachSearch(document.getElementById('search-form') as HTMLFormElement, document.getElementById('q') as HTMLInputElement,
    document.getElementById('q-results') as HTMLUListElement, currentEnv);
  await route();
}

init();
