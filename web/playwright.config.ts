// Browser smoke tests (e2e/): the built app in Chromium against the API with ERA's endpoint
// stood in for by the Luxembourg sample (scripts/sample_api.py). Needs Python with
// api/requirements.txt, and Chromium (npx playwright install chromium).
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'python ../scripts/sample_api.py',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: { VITE_API_PROXY: 'http://127.0.0.1:8000' },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
