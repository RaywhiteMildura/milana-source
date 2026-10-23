import { expect, test, type Page } from '@playwright/test';
import { savedKeysOnPhone } from './saved-copies';

/**
 * Password login, against the second demo server (:4852) which is started with
 * RACELENS_PASSWORD=racelens-test. Each test gets a fresh browser context, so
 * it starts signed out unless it logs in itself.
 */

const PASSWORD = 'racelens-test';
const DEMO_DATE = '2026-10-24';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto(`/#/?date=${DEMO_DATE}`);
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('meeting-card').first()).toBeVisible();
}

test('visiting the app signed out shows the login form and nothing else', async ({ page }) => {
  await page.goto(`/#/?date=${DEMO_DATE}`);
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('login-password')).toBeFocused();
  await expect(page.getByTestId('meeting-card')).toHaveCount(0);
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.getByTestId('nav-settings')).toHaveCount(0);
});

test('the API refuses data requests without a session', async ({ page }) => {
  await page.goto('/');
  const res = await page.request.get('/api/packs');
  expect(res.status()).toBe(401);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe('auth');

  const auth = await page.request.get('/api/auth');
  expect(auth.ok()).toBeTruthy();
  expect(await auth.json()).toEqual({ required: true, authenticated: false });

  // Health stays public (deploy checks need it) but says a login is required.
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect(((await health.json()) as { authRequired: boolean }).authRequired).toBe(true);
});

test('a wrong password shows an inline error and stays on the login form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByTestId('login-password').fill('definitely-not-it');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page.getByTestId('login-error')).toContainText(/password/i);
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('meeting-card')).toHaveCount(0);
});

test('the show/hide button reveals the typed password', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('login-password');
  await input.fill('peek');
  await expect(input).toHaveAttribute('type', 'password');
  await page.getByTestId('login-show').click();
  await expect(input).toHaveAttribute('type', 'text');
  await page.getByTestId('login-show').click();
  await expect(input).toHaveAttribute('type', 'password');
});

test('the right password opens the home page with the demo banner', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('login-form')).toHaveCount(0);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('meeting-card').first()).toContainText(/Flemington/i);
  // Data requests now succeed from this browser context (cookie).
  const res = await page.request.get('/api/packs');
  expect(res.ok()).toBeTruthy();
});

test('a reload stays signed in thanks to the session cookie', async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByTestId('meeting-card').first()).toBeVisible();
  await expect(page.getByTestId('login-form')).toHaveCount(0);

  // A brand-new tab in the same browser shares the cookie too.
  const other = await page.context().newPage();
  await other.goto(`/#/?date=${DEMO_DATE}`);
  await expect(other.getByTestId('meeting-card').first()).toBeVisible();
  await other.close();
});

test('settings shows Sign out, and signing out returns to the login form', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-form')).toBeVisible();
  const logout = page.getByTestId('logout-btn');
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('settings-form')).toHaveCount(0);

  // The cookie is gone: the API is locked again and a reload still shows the login.
  const res = await page.request.get('/api/packs');
  expect(res.status()).toBe(401);
  await page.reload();
  await expect(page.getByTestId('login-form')).toBeVisible();
});

test('signing out forgets the research saved on the phone, so a dead connection then shows no copies', async ({ page }) => {
  await signIn(page);
  await expect.poll(() => savedKeysOnPhone(page)).toContain('packs');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('logout-btn').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  expect(await savedKeysOnPhone(page)).toEqual([]);

  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByTestId('cant-reach')).toBeVisible();
  await expect(page.getByTestId('meeting-card')).toHaveCount(0);
  await expect(page.getByTestId('saved-copy-banner')).toHaveCount(0);
});

test('an expired session drops the app back to the login screen', async ({ page }) => {
  await signIn(page);
  // Simulate the cookie disappearing (expiry, server secret rotated, cleared site data).
  await page.context().clearCookies();
  await page.goto('/#/settings');
  await expect(page.getByTestId('login-form')).toBeVisible();
});
