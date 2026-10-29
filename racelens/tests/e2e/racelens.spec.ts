import { expect, test, type Page } from '@playwright/test';
import { savedKeysOnPhone } from './saved-copies';

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

/** True when nothing pokes out past the right edge; otherwise the offending elements, so a failure says what to fix. */
const noHorizontalOverflow = async (page: Page): Promise<true | string> => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return { ok: true, offenders: [] as string[] };
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const b = el.getBoundingClientRect();
      if (!b.width || b.right <= vw + 1) continue;
      // Inside a sideways-scrolling strip (the race tabs) is fine.
      let p: Element | null = el.parentElement;
      let scrolls = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { scrolls = true; break; }
        p = p.parentElement;
      }
      if (scrolls) continue;
      if (Array.from(el.children).some((k) => k.getBoundingClientRect().right >= b.right - 0.5)) continue;
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 3).join('.') : '';
      offenders.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} right=${Math.round(b.right)}px "${(el.textContent || '').trim().slice(0, 50)}"`);
    }
    return { ok: false, offenders: offenders.slice(0, 6) };
  });
  return r.ok ? true : `page is wider than the ${page.viewportSize()?.width}px screen; overflowing: ${r.offenders.join(' | ') || 'unknown'}`;
};

/** Race-day evening, after the demo card (12:25–17:05 AEDT) has run. */
const RACE_DAY_EVENING = '2026-10-24T09:30:00.000Z';

/** The page follows the server's clock (from /api/health), so this makes every race on the demo card look jumped. */
async function pretendRaceDayEvening(page: Page) {
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), time: RACE_DAY_EVENING } });
  });
}

const isPackGet = (url: string, method: string) => method === 'GET' && /^\/api\/packs\/[^/]+$/.test(new URL(url).pathname);
const isPackList = (url: string, method: string) => method === 'GET' && new URL(url).pathname === '/api/packs';
const isResultsPost = (url: string, method: string) => method === 'POST' && /^\/api\/packs\/[^/]+\/results$/.test(new URL(url).pathname);

/**
 * Record every toast the page shows, however briefly (a toast lives 5 s, so a
 * retrying "no toast" assertion would pass once it had gone). Read with seenToasts().
 */
async function recordToasts(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'toast') seen.push(n.textContent ?? '');
        });
    }).observe(document, { childList: true, subtree: true });
  });
}
const seenToasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts?: string[] }).__toasts ?? []);

/** Serve the saved pack with its results and results-watch book-keeping replaced, so a test does not depend on what the server did. */
async function servePackWith(page: Page, patch: (pack: { races: Array<{ number: number }> }) => Record<string, unknown>) {
  await page.route(
    (url) => /^\/api\/packs\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      try {
        const res = await route.fetch();
        const pack = await res.json();
        await route.fulfill({ response: res, json: { ...pack, ...patch(pack) } });
      } catch {
        // The test finished (page closing) while this request was in flight: nothing left to serve.
      }
    },
  );
}

// Requests still in flight when a test ends must not fail it (a mocked handler mid-fetch on a slower machine).
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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

test('the app is installable: manifest link, manifest and service worker are served', async ({ page }) => {
  await page.goto(`/#/?date=${DEMO_DATE}`);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /apple-touch-icon\.png$/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  const m = (await manifest.json()) as { name: string; display: string; start_url: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
  expect(m.name).toBe('RaceLens');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(m.icons.some((i) => i.sizes === '512x512')).toBe(true);
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) {
    const res = await page.request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image\/png/);
  }

  const sw = await page.request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['content-type']).toMatch(/javascript/);
  const body = await sw.text();
  expect(body).toContain('addEventListener');
  expect(body).toContain('/api/');

  // The production build registers the worker; give it a moment and check it took.
  await expect
    .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Once it controls the page, it keeps the shell and the built JavaScript and CSS for opening on a bad signal.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const out: string[] = [];
          for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname.replace(/-[\w-]+\.(js|css)$/, '.$1'));
          return out.sort();
        }),
      { timeout: 15_000 },
    )
    .toEqual(['/assets/index.css', '/assets/index.js', '/index.html']);
});

test('settings shows the race day automation card and the auto-results toggle round-trips', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('automation-card')).toBeVisible();
  await expect(page.getByTestId('automation-card')).toContainText(/Race day automation/i);
  await expect(page.getByTestId('automation-timeline')).toContainText(/pre-race check/i);
  await expect(page.getByTestId('automation-timeline')).toContainText(/30 seconds/i);
  await expect(page.getByTestId('automation-timeline')).toContainText(/once an hour from 7:30 am/);
  await expect(page.getByTestId('scheduler-status')).toBeVisible();
  // Its "Last look 1 min ago" ticks, so it must not be a live region that screen readers re-announce.
  expect(await page.getByTestId('scheduler-status').getAttribute('aria-live')).toBeNull();
  await expect(page.getByTestId('phone-card')).toBeVisible();
  await expect(page.getByTestId('settings-auto-recheck')).toBeVisible();

  const toggle = page.getByTestId('settings-auto-results');
  const label = page.getByTestId('settings-auto-results-toggle');
  await expect(toggle).toBeChecked();

  // Off, save, reload: stays off and the server agrees.
  await label.click();
  await expect(toggle).not.toBeChecked();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('settings-auto-results')).not.toBeChecked();
  expect(((await (await page.request.get('/api/settings')).json()) as { autoResults: boolean }).autoResults).toBe(false);

  // Back on so the rest of the suite (and race day) runs with automation.
  await page.getByTestId('settings-auto-results-toggle').click();
  await expect(page.getByTestId('settings-auto-results')).toBeChecked();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('settings-auto-results')).toBeChecked();
  expect(((await (await page.request.get('/api/settings')).json()) as { autoResults: boolean }).autoResults).toBe(true);
});

test('the meeting page shows the Auto chip while the server runs its scheduler', async ({ page }) => {
  await openFirstMeeting(page);
  const chip = page.getByTestId('auto-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('title', /automatically/i);
  // No race has jumped in the demo card yet (it is dated for race day), so no next-race bar or watch line.
  await expect(page.getByTestId('pack-header')).toBeVisible();
});

test('the phone card shows the public address when hosted and the Wi-Fi addresses only on a LAN', async ({ page }) => {
  let extra: Record<string, unknown> = { publicUrl: 'https://racelens-e2e.fly.dev', urls: [] };
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), ...extra } });
  });
  await page.goto('/#/settings');
  const card = page.getByTestId('phone-card');
  await expect(card.getByTestId('phone-public-url')).toContainText('https://racelens-e2e.fly.dev');
  await expect(card).toContainText(/works anywhere/i);
  await expect(card.getByTestId('phone-public-url').getByTestId('phone-qr')).toBeVisible();
  await expect(card.getByTestId('phone-url')).toHaveCount(0);
  await expect(card).not.toContainText(/same wi-fi|npm run start:phone/i);

  extra = { publicUrl: undefined, urls: ['http://192.168.1.20:4851'] };
  await page.reload();
  await expect(card.getByTestId('phone-url')).toContainText('http://192.168.1.20:4851');
  await expect(card).toContainText(/same wi-fi/i);
  await expect(card.getByTestId('phone-public-url')).toHaveCount(0);

  extra = { publicUrl: undefined, urls: [] };
  await page.reload();
  await expect(card).toContainText(/npm run start:phone/);
  await expect(card.getByTestId('phone-qr')).toHaveCount(0);
});

test('the phone catch-up only asks the server when it is behind, and never with automatic results off or unknown', async ({ page }) => {
  await recordToasts(page);
  await pretendRaceDayEvening(page);
  const catchups: unknown[] = [];
  const jobPolls: string[] = [];
  page.on('request', (r) => {
    if (isResultsPost(r.url(), r.method())) catchups.push(r.postDataJSON());
    if (new URL(r.url()).pathname.startsWith('/api/jobs/')) jobPolls.push(r.url());
  });
  // The server has nothing due: no job to follow.
  await page.route((url) => /^\/api\/packs\/[^/]+\/results$/.test(url.pathname), (route) => route.fulfill({ json: { jobId: null, due: [] } }));

  // 1) Races ran while the server never looked: one quiet, automatic catch-up.
  let watch: (pack: { races: Array<{ number: number }> }) => Record<string, unknown> = () => ({ results: {}, resultWatch: {} });
  await servePackWith(page, (pack) => watch(pack));
  await openFirstMeeting(page);
  await expect.poll(() => catchups.length, { message: 'a catch-up should be requested' }).toBe(1);
  expect(catchups[0]).toEqual({ catchup: true });
  await page.waitForTimeout(2500);
  expect(jobPolls).toEqual([]);
  expect(await seenToasts(page)).toEqual([]);

  // 2) The server gave up on some races and has its next look booked for the others: nothing to catch up.
  // (Both looked a while ago, which used to be enough to fire a catch-up on every open and refocus.)
  const at = (mins: number) => new Date(Date.parse(RACE_DAY_EVENING) + mins * 60_000).toISOString();
  watch = (pack) => ({
    results: {},
    resultWatch: Object.fromEntries(
      pack.races.map((r) => [r.number, r.number % 2 ? { lastCheckedAt: at(-60), attempts: 30, gaveUp: true, note: 'No result published after 4 hours' } : { lastCheckedAt: at(-4), attempts: 20, nextCheckAt: at(1), note: 'Nothing published yet' }]),
    ),
  });
  await page.reload();
  await expect(page.getByTestId('race-detail')).toBeVisible();
  await page.waitForTimeout(4000);
  expect(catchups).toHaveLength(1);

  // 3) Automatic results are off, and the setting arrives after the pack: still nothing, and no promise of a next check.
  watch = () => ({ results: {}, resultWatch: {} });
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const settings = await res.json();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: res, json: { ...settings, autoResults: false } });
  });
  await page.reload();
  await expect(page.getByTestId('race-detail')).toBeVisible();
  const line = page.getByTestId('result-watch');
  await expect(line).toContainText(/automatic results are off/i);
  await expect(line).not.toContainText(/next|any moment/i);
  expect(await line.getAttribute('aria-live')).toBeNull();
  await page.waitForTimeout(3000);
  expect(catchups).toHaveLength(1);
});

test('a catch-up job the server forgot (restart) does not stall the live refresh', async ({ page }) => {
  await page.clock.install();
  await recordToasts(page);
  await pretendRaceDayEvening(page);
  await servePackWith(page, () => ({ results: {}, resultWatch: {} }));
  const catchups: unknown[] = [];
  await page.route(
    (url) => /^\/api\/packs\/[^/]+\/results$/.test(url.pathname),
    async (route) => {
      catchups.push(route.request().postDataJSON());
      await route.fulfill({ json: { jobId: 'job_lost_e2e', due: [1] } });
    },
  );
  let misses = 0;
  await page.route('**/api/jobs/job_lost_e2e', async (route) => {
    misses += 1;
    await route.fulfill({ status: 404, json: { error: 'job not found' } });
  });

  await openFirstMeeting(page);
  await expect.poll(() => catchups.length).toBe(1);
  expect(catchups[0]).toEqual({ catchup: true });
  await expect.poll(() => misses, { timeout: 20_000, message: 'the lost job is polled three times, then given up' }).toBe(3);

  // The 30 s live poll carries on (it used to stay paused behind the lost job for as long as the page was open).
  const livePoll = page.waitForRequest((r) => isPackList(r.url(), r.method()), { timeout: 15_000 });
  await page.clock.fastForward('00:31');
  await livePoll;
  expect(misses).toBe(3);
  expect(catchups).toHaveLength(1);
  expect(await seenToasts(page)).toEqual([]);
});

test('the live refresh toasts a new result but stays quiet for a routine automatic check', async ({ page }) => {
  await page.clock.install();
  await recordToasts(page);
  let phase: 'load' | 'routine' | 'result' = 'load';
  let target = 0;
  const later = (iso: string, mins: number) => new Date(Date.parse(iso) + mins * 60_000).toISOString();
  await page.route(
    (url) => url.pathname === '/api/packs',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const res = await route.fetch();
      const list = (await res.json()) as Array<{ updatedAt: string; resultedRaces: number }>;
      for (const p of list) {
        if (phase !== 'load') p.updatedAt = later(p.updatedAt, phase === 'routine' ? 5 : 10);
        if (phase === 'result') p.resultedRaces += 1;
      }
      await route.fulfill({ response: res, json: list });
    },
  );
  await servePackWith(page, (pack) => {
    const p = pack as unknown as { updatedAt: string; races: Array<{ number: number; runners: Array<{ number: number }> }>; results?: Record<number, unknown>; resultWatch?: Record<number, unknown> };
    if (phase === 'load') return {};
    const race = p.races.find((r) => !p.results?.[r.number]) ?? p.races[0];
    target = race.number;
    const updatedAt = later(p.updatedAt, phase === 'routine' ? 5 : 10);
    // What an automatic results check that found nothing changes: the watch book-keeping and updatedAt.
    const resultWatch = { ...(p.resultWatch ?? {}), [race.number]: { lastCheckedAt: updatedAt, nextCheckAt: later(updatedAt, 2), attempts: 2, note: 'Nothing published yet' } };
    if (phase === 'routine') return { updatedAt, resultWatch };
    const placings = race.runners.slice(0, 3).map((r) => [r.number]);
    return { updatedAt, resultWatch, results: { ...(p.results ?? {}), [race.number]: { raceNumber: race.number, placings, recordedAt: updatedAt, source: 'racingaustralia', status: 'final' } } };
  });

  await openFirstMeeting(page);
  phase = 'routine';
  const refreshed = page.waitForRequest((r) => isPackGet(r.url(), r.method()), { timeout: 15_000 });
  await page.clock.fastForward('00:31');
  await refreshed;
  await page.waitForTimeout(1500);
  expect(await seenToasts(page)).toEqual([]);

  phase = 'result';
  await page.clock.fastForward('00:31');
  await expect.poll(() => seenToasts(page)).toEqual([expect.stringContaining(`R${target} result in`)]);
});

test('a dead heat is labelled by finishing position: both horses =2nd, the next one 4th', async ({ page }) => {
  let deadHeat: number[] = [];
  await servePackWith(page, (pack) => {
    const p = pack as unknown as { races: Array<{ number: number; runners: Array<{ number: number; scratched?: boolean }> }>; results?: Record<number, unknown> };
    const race = p.races[0];
    deadHeat = race.runners.filter((r) => !r.scratched).slice(0, 4).map((r) => r.number);
    const [a, b, c, d] = deadHeat;
    return { results: { ...(p.results ?? {}), [race.number]: { raceNumber: race.number, placings: [[a], [b, c], [d]], recordedAt: new Date().toISOString(), source: 'racingaustralia', status: 'final' } } };
  });
  await openFirstMeeting(page);
  await page.getByTestId('race-tab').first().click();
  await page.getByTestId('result-tab').click();
  const rows = page.getByTestId('placing');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.placing__pos')).toHaveText('1st');
  await expect(rows.nth(1).locator('.placing__pos')).toHaveText('=2nd');
  await expect(rows.nth(1)).toContainText(String(deadHeat[2]));
  // Not "3rd": two horses finished ahead of it in 2nd.
  await expect(rows.nth(2).locator('.placing__pos')).toHaveText('4th');
  await expect(rows.nth(2)).toHaveAttribute('data-position', '4');
});

test('a race first rated after the jump says so and is not scored', async ({ page }) => {
  await servePackWith(page, (pack) => {
    const p = pack as unknown as { races: Array<{ number: number; runners: Array<{ number: number; scratched?: boolean }> }>; predictions: Record<number, Record<string, unknown>>; results?: Record<number, unknown> };
    const race = p.races[0];
    const placings = race.runners.filter((r) => !r.scratched).slice(0, 3).map((r) => [r.number]);
    return {
      predictions: { ...p.predictions, [race.number]: { ...p.predictions[race.number], postJump: true } },
      results: { ...(p.results ?? {}), [race.number]: { raceNumber: race.number, placings, recordedAt: new Date().toISOString(), source: 'racingaustralia', status: 'final' } },
    };
  });
  await openFirstMeeting(page);
  await page.getByTestId('race-tab').first().click();
  await expect(page.getByTestId('post-jump-chip')).toHaveText('Rated after the jump');
  await page.getByTestId('result-tab').click();
  await expect(page.getByTestId('not-scored')).toContainText('Not scored – RaceLens first rated this race after it had started.');
  await expect(page.getByTestId('scorecard')).toHaveCount(0);
  // Races rated before the jump show no such chip.
  await page.getByTestId('race-tab').nth(1).click();
  await page.getByTestId('prediction-tab').click();
  await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
  await expect(page.getByTestId('post-jump-chip')).toHaveCount(0);
});

test.describe('phone at the track', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('with no connection the phone shows its saved copy of the meeting, says so, and goes live again by itself', async ({ page }) => {
    await openFirstMeeting(page);
    const packId = decodeURIComponent(new URL(page.url()).hash.split('/')[2]);
    // Opening it live kept a copy on the phone (the list too).
    await expect.poll(() => savedKeysOnPhone(page)).toEqual(expect.arrayContaining(['packs', `pack:${packId}`]));

    // Tailscale off, or no signal: nothing under /api answers. Reopening the app still shows the picks.
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await page.reload();
    const banner = page.getByTestId('saved-copy-banner');
    await expect(banner).toContainText(/Saved copy from \S+ – not live\. Retrying…/);
    await expect(page.getByTestId('race-detail')).toBeVisible();
    await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    // The home page lists the saved research too.
    await page.goto(`/#/?date=${DEMO_DATE}`);
    await expect(page.getByTestId('today-research').getByTestId('pack-open')).toBeVisible();
    await expect(banner).toBeVisible();

    // Tailscale Serve answering 502 while the Mac restarts RaceLens is no different.
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }));
    await page.getByTestId('today-research').getByTestId('pack-open').click();
    await expect(page.getByTestId('race-detail')).toBeVisible();
    await expect(banner).toBeVisible();

    // Back in range: the page notices by itself and drops the banner.
    await page.unroute('**/api/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('race-detail')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toBeVisible();
  });

  test('on a stalled connection the saved copy shows within seconds, not after a minute of spinner', async ({ page }) => {
    await page.clock.install();
    await openFirstMeeting(page);
    const packId = decodeURIComponent(new URL(page.url()).hash.split('/')[2]);
    await expect.poll(() => savedKeysOnPhone(page)).toContain(`pack:${packId}`);

    // Congested 4G: requests go out and nothing ever comes back.
    await page.route('**/api/**', () => undefined);
    await page.reload();
    await expect(page.getByTestId('startup-skeleton')).toBeVisible();
    await page.clock.fastForward('00:05');
    await expect(page.locator('.page--pack[aria-busy="true"]')).toBeVisible();
    await page.clock.fastForward('00:05');
    await expect(page.getByTestId('saved-copy-banner')).toContainText(/Saved copy from .+ – not live/);
    await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
  });

  test('with nothing saved, a dead connection shows a friendly "can\'t reach RaceLens" with Try again', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await page.goto(`/#/?date=${DEMO_DATE}`);
    const state = page.getByTestId('cant-reach');
    await expect(state).toContainText("Can't reach RaceLens");
    await expect(state).toContainText(/Mac mini is not answering/);
    await page.unroute('**/api/**');
    await state.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('meeting-card').first()).toBeVisible();
  });

  test('on an iPhone 13 the bets for the race come within two screens of the race, and jump to the full structure', async ({ page }) => {
    await openFirstMeeting(page);
    const raceTop = (await page.getByTestId('race-detail').boundingBox())!.y;
    const summary = page.getByTestId('bet-summary');
    await expect(summary).toBeVisible();
    const box = (await summary.boundingBox())!;
    expect(box.y + box.height - raceTop).toBeLessThan(2 * 844);
    // The stance reads as one word, never "Wat/ch".
    const stance = summary.locator('.stance');
    expect((await stance.boundingBox())!.height).toBeLessThan(40);
    expect(await noHorizontalOverflow(page)).toBe(true);

    // Runner cards keep two reasons and two concerns until asked for more.
    const withMore = page.getByTestId('ranked-runner').filter({ has: page.getByTestId('chips-more') }).first();
    if (await withMore.count()) {
      const card = page.locator(`[data-testid="ranked-runner"][data-number="${await withMore.getAttribute('data-number')}"]`);
      const chips = await card.locator('.chip').count();
      await card.getByTestId('chips-more').click();
      await expect(card.getByTestId('chips-more')).toHaveCount(0);
      expect(await card.locator('.chip').count()).toBeGreaterThanOrEqual(chips);
    }

    await summary.getByTestId('bet-summary-more').click();
    await expect(page.getByTestId('betting-plan')).toBeInViewport();
    expect((await page.getByTestId('stance-badge').boundingBox())!.height).toBeLessThan(40);
  });

  test('the race strip keeps the selected race in view', async ({ page }) => {
    await openFirstMeeting(page);
    const tabs = page.getByTestId('race-tab');
    const last = tabs.last();
    const lastNo = await last.getAttribute('data-race');
    const deepLink = `${page.url().replace(/\/race\/\d+$/, '')}/race/${lastNo}`;
    await page.goto('about:blank');
    await page.goto(deepLink);
    await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', String(lastNo));
    await expect(last).toHaveAttribute('aria-selected', 'true');
    // Within the strip's visible width: the selected race yes, R1 no.
    const shown = (tab: ReturnType<Page['getByTestId']>) =>
      tab.evaluate((el) => {
        const s = el.parentElement!.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        return t.left >= s.left - 1 && t.right <= s.right + 1;
      });
    await expect.poll(() => shown(last)).toBe(true);
    expect(await shown(tabs.first())).toBe(false);
    // Sideways only: the page itself did not scroll.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('"Next" from a race result opens the next race on its picks, not its empty result form', async ({ page }) => {
    await servePackWith(page, (pack) => {
      const p = pack as unknown as { races: Array<{ number: number; runners: Array<{ number: number; scratched?: boolean }> }>; results?: Record<number, unknown> };
      const race = p.races[0];
      const placings = race.runners.filter((r) => !r.scratched).slice(0, 3).map((r) => [r.number]);
      return { results: { ...(p.results ?? {}), [race.number]: { raceNumber: race.number, placings, recordedAt: new Date().toISOString(), source: 'racingaustralia', status: 'final' } } };
    });
    await openFirstMeeting(page);
    const tabs = page.getByTestId('race-tab');
    await tabs.first().click();
    await page.getByTestId('result-tab').click();
    await expect(page.getByTestId('placings')).toBeVisible();

    const next = page.getByTestId('next-race-bar');
    const nextNo = await next.getAttribute('data-race');
    await next.click();
    await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', String(nextNo));
    await expect(page.getByTestId('prediction-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
    await expect(page.getByTestId('manual-result-form')).toHaveCount(0);

    // From the race strip: Result stays open only for a race that has one.
    await page.getByTestId('result-tab').click();
    await tabs.first().click();
    await expect(page.getByTestId('result-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('placings')).toBeVisible();
    await tabs.nth(2).click();
    await expect(page.getByTestId('race-detail')).toHaveAttribute('data-race', (await tabs.nth(2).getAttribute('data-race')) ?? '');
    await expect(page.getByTestId('prediction-tab')).toHaveAttribute('aria-selected', 'true');
  });

  test('a failed refresh keeps the meeting on screen with a small notice instead of an error page', async ({ page }) => {
    await openFirstMeeting(page);
    let refuse = true;
    await page.route(
      (url) => /^\/api\/packs\/[^/]+$/.test(url.pathname),
      (route) => (route.request().method() === 'GET' && refuse ? route.fulfill({ status: 429, json: { error: 'Too many requests – wait a moment.' } }) : route.fallback()),
    );
    await page.getByTestId('refresh-btn').click();
    const notice = page.getByTestId('refresh-failed');
    await expect(notice).toContainText(/Couldn't refresh – showing what you had from \S+\./);
    await expect(notice).toContainText('Too many requests');
    await expect(page.getByTestId('race-detail')).toBeVisible();
    await expect(page.getByTestId('ranked-runner').first()).toBeVisible();
    await expect(page.getByTestId('error-state')).toHaveCount(0);

    refuse = false;
    await page.getByTestId('refresh-btn').click();
    await expect(notice).toHaveCount(0);
  });

  test('losing the Mac mid-session shows the not-live banner after two missed checks, and clears it when it answers', async ({ page }) => {
    await page.clock.install();
    await openFirstMeeting(page);
    const banner = page.getByTestId('saved-copy-banner');
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    for (let i = 0; i < 2; i++) {
      await expect(banner).toHaveCount(0); // one missed check is not news
      const missed = page.waitForEvent('requestfailed', (r) => isPackList(r.url(), r.method()));
      await page.clock.fastForward('00:31');
      await missed;
    }
    await expect(banner).toContainText(/Saved copy from \S+ – not live\. Retrying…/);
    await expect(page.getByTestId('race-detail')).toBeVisible();
    // It stays in sight while the picks scroll.
    await page.getByTestId('ranked-runner').last().scrollIntoViewIfNeeded();
    await expect(banner).toBeInViewport();

    await page.unroute('**/api/**');
    await page.clock.fastForward('00:16');
    await expect(banner).toHaveCount(0);
  });

  test('coming back from the lock screen updates the countdown and checks for news at once', async ({ page }) => {
    await page.clock.install();
    // Two hours after the server's own clock (the app counts down on server time; the test server runs on demo time).
    const serverNow = Date.parse((await (await page.request.get('/api/health')).json()).time);
    const start = new Date(serverNow + 2 * 3600_000).toISOString();
    await servePackWith(page, (pack) => ({ races: pack.races.map((r) => ({ ...r, startTime: start })) }));
    await openFirstMeeting(page);
    const countdown = page.getByTestId('countdown').locator('strong');
    await expect(countdown).toHaveText(/Jumps in (2 h 0|1 h 59) min/);

    // Locked for 20 minutes: the phone froze every timer, so nothing ticked meanwhile.
    await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 20 * 60_000);
    const checked = page.waitForRequest((r) => isPackList(r.url(), r.method()), { timeout: 5_000 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await checked;
    await expect(countdown).toHaveText(/Jumps in 1 h (40|39) min/);
  });

  const VERSION = { commit: 'a1b2c3d4e5f6a7b8', branch: 'main', installedAt: '2026-10-23T21:00:00.000Z' };

  test('Settings updates RaceLens from the phone: confirm, progress every 5 s through the restart, then Reload', async ({ page }) => {
    await page.clock.install();
    let state: 'idle' | 'requested' | 'running' | 'done' = 'idle';
    let down = false;
    let gets = 0;
    let downGets = 0;
    const posts: unknown[] = [];
    await page.route('**/api/update', async (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        state = 'requested';
        return route.fulfill({ status: 202, json: { requested: true, message: 'Update started – about 3–5 minutes.' } });
      }
      gets += 1;
      if (down) {
        downGets += 1;
        return route.abort('connectionrefused');
      }
      const done = state === 'done';
      await route.fulfill({
        json: {
          supported: true,
          state,
          version: done ? { ...VERSION, commit: 'f00dfacecafe', installedAt: '2026-10-24T01:00:00.000Z' } : VERSION,
          last: done ? { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), ok: true, from: 'a1b2c3d', to: 'f00dfacecafe' } : undefined,
        },
      });
    });

    await page.goto('/#/settings');
    const card = page.getByTestId('update-card');
    await expect(card.getByTestId('update-version')).toContainText('a1b2c3d');
    await expect(card.getByTestId('update-version')).not.toContainText('a1b2c3d4');
    await expect(card.getByTestId('update-version')).toContainText(/installed/);
    expect(await noHorizontalOverflow(page)).toBe(true);

    await card.getByTestId('update-btn').click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toContainText('about 3–5 minutes');
    await expect(dialog).toContainText('goes back to this one by itself');
    await page.getByTestId('confirm-ok').click();
    await expect(card.getByTestId('update-progress')).toContainText(/waiting for the Mac mini/);
    expect(posts).toHaveLength(1);

    state = 'running';
    await page.clock.fastForward('00:06');
    await expect(card.getByTestId('update-progress')).toContainText(/downloading and building/);

    // RaceLens restarts for a few seconds at the end: unanswered polls change nothing.
    down = true;
    await page.clock.fastForward('00:06');
    await expect.poll(() => downGets).toBeGreaterThan(0);
    await expect(card.getByTestId('update-progress')).toBeVisible();

    down = false;
    state = 'done';
    await page.clock.fastForward('00:06');
    await expect(card.getByTestId('update-done')).toContainText('f00dfac');
    await expect(card.getByTestId('update-version')).toContainText('f00dfac');
    const polls = gets;
    await page.clock.fastForward('00:11');
    expect(gets).toBe(polls); // stopped asking once done

    const reloaded = page.waitForEvent('load');
    await card.getByTestId('update-reload').click();
    await reloaded;
    await expect(page.getByTestId('settings-form')).toBeVisible();
  });

  test('Settings shows only the version where there is no updater, and no card at all on a server without /api/update', async ({ page }) => {
    let reply: { status: number; json: unknown } = { status: 200, json: { supported: false, state: 'idle', version: VERSION } };
    await page.route('**/api/update', (route) => route.fulfill(reply));
    await page.goto('/#/settings');
    const card = page.getByTestId('update-card');
    await expect(card.getByTestId('update-version')).toContainText('a1b2c3d');
    await expect(card.getByTestId('update-btn')).toHaveCount(0);

    // Supported, but the server then says it cannot (501): say so and drop the button.
    reply = { status: 200, json: { supported: true, state: 'idle', version: VERSION } };
    await page.unroute('**/api/update');
    await page.route('**/api/update', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 501, json: { error: 'Updating is only available on the Mac mini.' } }) : route.fulfill(reply),
    );
    await page.reload();
    await card.getByTestId('update-btn').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'only available on the Mac mini' })).toBeVisible();
    await expect(card.getByTestId('update-btn')).toHaveCount(0);
    await expect(card.getByTestId('update-version')).toContainText('a1b2c3d');

    reply = { status: 404, json: { error: 'Not found' } };
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/update');
    await page.reload();
    await answered;
    await expect(page.getByTestId('settings-form')).toBeVisible();
    await expect(page.getByTestId('update-card')).toHaveCount(0);
  });
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

test.describe('phone (touch) viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the add-to-home-screen hint shows on a phone and can be dismissed for good', async ({ page }) => {
    await gotoHome(page);
    const hint = page.getByTestId('install-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/home screen/i);
    // Neither an Android nor an iOS browser: no platform-specific steps.
    await expect(hint).not.toContainText(/Android|iPhone/);
    expect(await noHorizontalOverflow(page)).toBe(true);

    await page.getByTestId('install-dismiss').click();
    await expect(hint).toHaveCount(0);

    // Dismissal is remembered on the device.
    await page.reload();
    await expect(page.getByTestId('meeting-card').first()).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('racelens.installHintDismissed'))).toBe('1');
  });

  test.describe('on Android', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
    test('the hint gives the Android steps', async ({ page }) => {
      await gotoHome(page);
      await expect(page.getByTestId('install-hint')).toContainText(/Android: open the browser menu/);
    });
  });

  test.describe('on an iPhone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    test('the hint gives the iPhone steps', async ({ page }) => {
      await gotoHome(page);
      await expect(page.getByTestId('install-hint')).toContainText(/Add to Home Screen/);
      await expect(page.getByTestId('install-hint')).not.toContainText(/Android/);
    });
  });
});

test.describe('touch-screen laptop', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' });

  test('no add-to-home-screen hint when the touch screen is not the main pointer', async ({ page }) => {
    // A Windows laptop with a touch digitiser: touch points, but a mouse/trackpad as the primary (fine) pointer.
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 10 }));
    await gotoHome(page);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBe(10);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(false);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
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
