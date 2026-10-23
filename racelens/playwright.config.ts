import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Use whatever Chromium is already installed when Playwright's exact build is missing
// (e.g. CI images). Locally `npx playwright install chromium` makes this unnecessary.
const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH || localChromium ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || localChromium } } : {};

/**
 * Two demo servers are started from the built app (run `npm run build` first):
 *   :4851  open (no password)   – tests/e2e/racelens.spec.ts   (project "demo")
 *   :4852  RACELENS_PASSWORD set – tests/e2e/auth.spec.ts       (project "auth")
 * Both projects share one worker because the suites are serial and stateful.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    ...launchOptions,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'demo',
      testMatch: /racelens\.spec\.ts/,
      use: { baseURL: 'http://localhost:4851' },
    },
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      use: { baseURL: 'http://localhost:4852' },
    },
  ],
  webServer: [
    {
      command: 'npx cross-env RACELENS_MODE=demo RACELENS_PORT=4851 RACELENS_DATA_DIR=./data-e2e node dist/server/index.js',
      url: 'http://localhost:4851/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx cross-env RACELENS_MODE=demo RACELENS_PORT=4852 RACELENS_DATA_DIR=./data-e2e-auth RACELENS_PASSWORD=racelens-test node dist/server/index.js',
      url: 'http://localhost:4852/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
