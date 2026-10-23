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

/**
 * Load the home page and wait until the first meeting card knows whether saved research exists.
 * The card shows "Research" until /api/packs answers, so we read that response and then wait for
 * the matching button instead of guessing from whichever button happens to be rendered first.
 */
async function gotoHomeSettled(page: Page): Promise<{ card: ReturnType<Page['getByTestId']>; hasPack: boolean }> {
  // A hash-only navigation to a page we are already on would not reload, and so would never re-request the packs.
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  const packsLoaded = page.waitForResponse((r) => r.url().includes('/api/packs') && r.request().method() === 'GET');
  await gotoHome(page);
  const packs = (await (await packsLoaded).json()) as Array<{ id: string; meeting: { date: string } }>;
  const card = page.getByTestId('meeting-card').first();
  const meetingId = await card.getAttribute('data-meeting-id');
  const hasPack = packs.some((p) => p.id === meetingId || p.meeting.date === DEMO_DATE);
  await expect(card.getByTestId(hasPack ? 'open-btn' : 'research-btn')).toBeVisible();
  return { card, hasPack };
}

/** Open the first meeting's research, running it first if it has not been researched yet. */
async function openFirstMeeting(page: Page) {
  const { card, hasPack } = await gotoHomeSettled(page);
  if (hasPack) {
    await card.getByTestId('open-btn').click();
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
  const { card, hasPack } = await gotoHomeSettled(page);
  if (!hasPack) {
    await card.getByTestId('research-btn').click();
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

test('news tab lists stories grouped by runner', async ({ page }) => {
  await openFirstMeeting(page);
  await page.getByTestId('news-tab').click();
  await expect(page.getByTestId('news-panel')).toBeVisible();
  await expect(page.getByTestId('news-tab')).toHaveAttribute('aria-selected', 'true');
  // The demo meeting ships bundled stories, so at least one item must render.
  await expect(page.getByTestId('news-item').first()).toBeVisible();
});

test('field table shows cross-source conflicts for runners the sources disagree on', async ({ page }) => {
  await openFirstMeeting(page);
  await page.getByTestId('field-tab').click();
  await expect(page.getByTestId('field-table')).toBeVisible();
  // The demo data deliberately disagrees between sources, so a conflict list must be visible somewhere in the meeting.
  const tabs = page.getByTestId('race-tab');
  const n = await tabs.count();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    await tabs.nth(i).click();
    await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', (await tabs.nth(i).getAttribute('data-race')) ?? '');
    found = (await page.getByTestId('runner-conflicts').count()) > 0;
  }
  expect(found).toBe(true);
  const details = page.getByTestId('runner-conflicts').first();
  await details.locator('summary').click();
  await expect(details.locator('li').first()).toBeVisible();
});

test('refreshing a deep race link keeps the selected race', async ({ page }) => {
  await openFirstMeeting(page);
  const tabs = page.getByTestId('race-tab');
  if ((await tabs.count()) < 3) test.skip(true, 'Demo meeting has fewer than three races');
  await tabs.nth(2).click();
  const raceNo = await tabs.nth(2).getAttribute('data-race');
  await expect(page).toHaveURL(new RegExp(`/race/${raceNo}(\\?|$)`));
  await page.reload();
  await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', String(raceNo));
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
});

test('entering a result manually asks for confirmation, then scores the prediction', async ({ page }) => {
  await openFirstMeeting(page);
  // Use the last race so the earlier tests (which assume an un-resulted first race) keep working on re-runs.
  const tabs = page.getByTestId('race-tab');
  const last = tabs.nth((await tabs.count()) - 1);
  await last.click();
  const raceNo = await last.getAttribute('data-race');
  await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', String(raceNo));

  await page.getByTestId('result-tab').click();
  await expect(page.getByTestId('result-panel')).toBeVisible();
  if ((await page.getByTestId('placings').count()) > 0) {
    // Already resulted by an earlier run – the scorecard must still be shown.
    await expect(page.getByTestId('scorecard')).toBeVisible();
    return;
  }

  // Pick the first three runners from our own ranked list so the saddlecloth numbers are real.
  await page.getByTestId('prediction-tab').click();
  const ranked = page.getByTestId('ranked-runner');
  await expect(ranked.first()).toBeVisible();
  const numbers: string[] = [];
  for (let i = 0; i < Math.min(3, await ranked.count()); i++) numbers.push((await ranked.nth(i).getAttribute('data-number')) ?? '');
  expect(numbers.every((n) => /^\d+$/.test(n))).toBe(true);

  await page.getByTestId('result-tab').click();
  for (let i = 0; i < numbers.length; i++) await page.getByTestId(`manual-place-${i + 1}`).fill(numbers[i]);
  await page.getByTestId('manual-result-save').click();

  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Race ${raceNo}`);
  await page.getByTestId('confirm-ok').click();

  await expect(page.getByTestId('placings')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('placings')).toContainText('1st');
  await expect(page.getByTestId('scorecard')).toBeVisible();
  // Our top pick "won", so the scorecard's first line must be a hit.
  await expect(page.getByTestId('scorecard').locator('li').first()).toHaveClass(/is-hit/);
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
    const { card, hasPack } = await gotoHomeSettled(page);
    await expect(page.getByTestId('source-health')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    if (hasPack) {
      await card.getByTestId('open-btn').click();
    } else {
      await card.getByTestId('research-btn').click();
      await expect(page).toHaveURL(/#\/pack\//, { timeout: 80_000 });
    }
    await expect(page.getByTestId('race-detail')).toBeVisible();
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

test('deleting saved research removes it from the home page', async ({ page }) => {
  const { hasPack } = await gotoHomeSettled(page);
  expect(hasPack).toBe(true);
  const items = page.getByTestId('pack-item');
  const before = await items.count();
  expect(before).toBeGreaterThan(0);

  await items.first().getByTestId('pack-delete').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/delete research/i);
  await page.getByTestId('confirm-ok').click();

  await expect.poll(async () => page.getByTestId('pack-item').count(), { timeout: 15_000 }).toBeLessThan(before);
  // The meeting card now offers research again instead of "open".
  await expect(page.getByTestId('meeting-card').first().getByTestId('research-btn')).toBeVisible();
});
