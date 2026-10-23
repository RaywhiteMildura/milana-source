import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Use whatever Chromium is already installed when Playwright's exact build is missing
// (e.g. CI images). Locally `npx playwright install chromium` makes this unnecessary.
const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: 'http://localhost:4851',
    headless: true,
    viewport: { width: 1280, height: 900 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH || localChromium ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || localChromium } } : {}),
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'RACELENS_MODE=demo RACELENS_PORT=4851 RACELENS_DATA_DIR=./data-e2e node dist/server/index.js',
    url: 'http://localhost:4851/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
