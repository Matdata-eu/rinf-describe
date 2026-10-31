// Every page of the sample opens, and every tab of it draws without an error in the console.
import { expect, test, type Page } from '@playwright/test';

const ERA = 'http://data.europa.eu/949/';
const SOL = `${ERA}sectionOfLine/14fd15444d`;

/** Console errors and failed requests to the app itself (map tiles from elsewhere are blocked). */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.host === '127.0.0.1:4173' && r.status() >= 400 && !u.pathname.startsWith('/site/')) errors.push(`${r.status()} ${u.pathname}${u.search}`);
  });
  return errors;
}

// A transparent 1×1 PNG for every map tile: the tests make no requests outside.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function open(page: Page, path: string) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => /\.png$/.test(new URL(route.request().url()).pathname)
    ? route.fulfill({ status: 200, contentType: 'image/png', body: TILE })
    : route.abort());
  // Not a first visit: no tour or "what's new" over the page (src/tour.ts, src/whats-new.ts).
  await page.addInitScript(() => {
    localStorage.setItem('describe-tour', '9999');
    localStorage.setItem('describe-whats-new-seen', '9999');
  });
  await page.goto(path);
}

test('the start page lists an example per class page', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/');
  await expect(page.getByRole('link', { name: /Michelau|Section of line/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('search finds a section of line by name', async ({ page }) => {
  await open(page, '/');
  await page.getByPlaceholder(/Search a name/).first().fill('Michelau');
  await expect(page.getByRole('option').first()).toContainText('Michelau');
});

test('a section of line page draws every tab', async ({ page }) => {
  const errors = watch(page);
  await open(page, `/describe?uri=${encodeURIComponent(SOL)}&env=prod`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Michelau <-> Goebelsmuhle');
  const tabs = page.getByRole('tab');
  const n = await tabs.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    const name = (await tabs.nth(i).innerText()).trim();
    await tabs.nth(i).click();
    await expect(tabs.nth(i), name).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel, name).not.toBeEmpty();
    await expect(panel.locator('.loading, [aria-busy="true"]'), name).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.locator('.error'), name).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('every class page of the sample opens', async ({ page, request }) => {
  const errors = watch(page);
  const { results } = await (await request.get('/api/examples')).json() as { results: { iri: string; label: string | null }[] };
  expect(results.length).toBeGreaterThan(5);
  for (const r of results) {
    await open(page, `/describe?uri=${encodeURIComponent(r.iri)}&env=prod`);
    await expect(page.getByRole('heading', { level: 1 }), r.iri).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }), r.iri).not.toHaveText(/could not be described|not found/);
    await expect(page.getByRole('tab').first(), r.iri).toBeVisible();
  }
  expect(errors).toEqual([]);
});
