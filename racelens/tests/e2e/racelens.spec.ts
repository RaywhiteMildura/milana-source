import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests against the demo server (RACELENS_MODE=demo on :4851).
 * The demo meeting is Flemington on 2026-10-24, so every test pins that date
 * via the `#/?date=` hash so it does not depend on when the suite is run.
 */

const DEMO_DATE = '2026-10-24';

test.describe.configure({ mode: 'serial' });

async function gotoHome(page: Page) {
  await page.goto(`/#/?date=${DEMO_DATE}`);
  await expect(page.getByTestId('meeting-card').first()).toBeVisible();
}

/** Open the first meeting's research, running it first if it has not been researched yet. */
async function openFirstMeeting(page: Page) {
  await gotoHome(page);
  const card = page.getByTestId('meeting-card').first();
  const open = card.getByTestId('open-btn');
  if (await open.count()) {
    await open.click();
  } else {
    await card.getByTestId('research-btn').click();
    await expect(page).toHaveURL(/#\/pack\//, { timeout: 80_000 });
  }
  await expect(page.getByTestId('race-tab').first()).toBeVisible();
  await expect(page.getByTestId('race-detail')).toBeVisible();
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('home loads with the demo banner and at least one meeting card', async ({ page }) => {
  const meetingsRequest = page.waitForResponse((r) => r.url().includes(`/api/meetings?date=${DEMO_DATE}`));
  await page.goto(`/#/?date=${DEMO_DATE}`);
  const res = await meetingsRequest;
  expect(res.ok()).toBeTruthy();

  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('demo-banner')).toContainText(/demo mode/i);

  const cards = page.getByTestId('meeting-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText(/Flemington/i);
  await expect(cards.first().getByTestId('meeting-source').first()).toBeVisible();
  await expect(page.getByTestId('source-health')).toBeVisible();
  await expect(page.getByTestId('date-input')).toHaveValue(DEMO_DATE);
});

test('researching a meeting shows progress, then the meeting page with predictions', async ({ page }) => {
  await gotoHome(page);
  const card = page.getByTestId('meeting-card').first();
  const research = card.getByTestId('research-btn');
  if (await research.count()) {
    await research.click();
  } else {
    // Already researched by an earlier run – re-run so we still exercise the job flow.
    await card.getByTestId('rerun-btn').click();
    await page.getByTestId('confirm-ok').click();
  }

  await expect(page).toHaveURL(/#\/job\//);
  await expect(page.getByTestId('job-progress')).toBeVisible();

  await expect(page).toHaveURL(/#\/pack\//, { timeout: 80_000 });
  await expect(page.getByTestId('pack-header')).toBeVisible();
  const raceTabs = page.getByTestId('race-tab');
  await expect(raceTabs.first()).toBeVisible();
  expect(await raceTabs.count()).toBeGreaterThanOrEqual(1);

  const ranked = page.getByTestId('ranked-runner');
  await expect(ranked.first()).toBeVisible();
  const rankedCount = await ranked.count();
  expect(rankedCount).toBeGreaterThanOrEqual(1);
  expect(rankedCount).toBeLessThanOrEqual(6);

  await expect(page.getByTestId('confidence-meter')).toBeVisible();
  await expect(page.getByTestId('betting-plan')).toBeVisible();
  await expect(page.getByTestId('betting-plan')).toContainText('1800 858 858');

  await page.getByTestId('field-tab').click();
  await expect(page.getByTestId('field-table')).toBeVisible();
  expect(await page.getByTestId('field-row').count()).toBeGreaterThan(0);
});

test('switching race tabs changes the selected race', async ({ page }) => {
  await openFirstMeeting(page);
  const tabs = page.getByTestId('race-tab');
  const count = await tabs.count();
  expect(count).toBeGreaterThanOrEqual(1);
  if (count < 2) test.skip(true, 'Demo meeting has a single race');

  const target = tabs.nth(1);
  const targetNo = await target.getAttribute('data-race');
  await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'false');
  await expect(page).toHaveURL(new RegExp(`/race/${targetNo}(\\?|$)`));
  await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', String(targetNo));
});

test('verification tab shows the sources that were compared', async ({ page }) => {
  await openFirstMeeting(page);
  await page.getByTestId('verification-tab').click();
  await expect(page.getByTestId('verification-panel')).toBeVisible();
  await expect(page.getByTestId('verification-source').first()).toBeVisible();
  expect(await page.getByTestId('verification-runner').count()).toBeGreaterThan(0);
});

test('pre-race check runs and the page refreshes with a new history event', async ({ page }) => {
  await openFirstMeeting(page);
  await page.getByTestId('history-toggle').click();
  const before = await page.getByTestId('history-event').count();

  await page.getByTestId('recheck-btn').click();
  const progress = page.getByTestId('job-progress');
  await expect(progress).toBeVisible();

  // The inline panel reports done/error and then hides itself once the pack has been refreshed.
  await expect
    .poll(async () => (await progress.count()) === 0 || ['done', 'error'].includes((await progress.getAttribute('data-status')) ?? ''), { timeout: 80_000, message: 'pre-race check should finish' })
    .toBe(true);
  await expect
    .poll(async () => page.getByTestId('history-event').count(), { timeout: 20_000, message: 'history should gain a recheck event' })
    .toBeGreaterThan(before);
  await expect(page.getByTestId('history-event').first()).toBeVisible();
  await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
});

test('settings save and round-trip after reload', async ({ page }) => {
  await page.goto('/#/settings');
  const unit = page.getByTestId('settings-unit');
  await expect(unit).toBeVisible();

  const current = await unit.inputValue();
  const next = String(current === '15' ? 20 : 15);
  await unit.fill(next);
  await page.getByTestId('risk-balanced').check();
  await page.getByTestId('settings-jurisdiction').selectOption('VIC');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-saved')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('settings-unit')).toHaveValue(next);
  await expect(page.getByTestId('risk-balanced')).toBeChecked();
  await expect(page.getByTestId('settings-jurisdiction')).toHaveValue('VIC');
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('home and meeting page render without horizontal overflow', async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByTestId('source-health')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    await openFirstMeeting(page);
    await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
    await expect(page.getByTestId('confidence-meter')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    await page.getByTestId('field-tab').click();
    await expect(page.getByTestId('field-table')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    await page.getByTestId('verification-tab').click();
    await expect(page.getByTestId('verification-panel')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
