import { describe, expect, it } from 'vitest';
import type { NewsItem, MeetingPack } from '../../shared/types.js';
import { createRegistry } from '../adapters/index.js';
import { DEMO_DATE, DEMO_VENUE_SLUG } from '../adapters/demo/index.js';
import type { FetchContext, SourceAdapter } from '../adapters/types.js';
import { HttpClient } from '../core/http.js';
import { DEFAULT_SETTINGS } from '../store/store.js';
import { JobManager } from './manager.js';
import { discoverMeetings, researchMeeting, type ResearchDeps } from './research.js';

/** A news source that refuses every search, like Reddit does for many servers (live check, 24 Oct 2026). */
class RefusingNews implements SourceAdapter {
  id = 'refusing-news';
  name = 'Refusing News';
  kind = 'news' as const;
  capabilities = ['news' as const];
  calls = 0;
  async searchNews(): Promise<NewsItem[]> {
    this.calls++;
    throw new Error('HTTP 403 for https://example.invalid/search.json');
  }
}

describe('news step', () => {
  it('stops asking a news source that refused its first three searches, and the research still completes', async () => {
    const registry = createRegistry('demo');
    const refusing = new RefusingNews();
    registry.register(refusing);
    const now = new Date(`${DEMO_DATE}T00:30:00.000+11:00`);
    const ctx: FetchContext = { http: new HttpClient({}), log: { debug() {}, info() {}, warn() {}, error() {} } as never, now: () => now, jurisdiction: 'VIC' };
    const deps: ResearchDeps = { registry, ctx, settings: DEFAULT_SETTINGS, now: () => now };
    const { meetings } = await discoverMeetings(deps, DEMO_DATE);
    const meeting = meetings.find((m) => m.venueSlug === DEMO_VENUE_SLUG)!;
    const jobs = new JobManager();
    let pack: MeetingPack | undefined;
    const job = jobs.start('research', { meetingId: meeting.id }, async (h) => {
      pack = await researchMeeting(deps, meeting, h);
    });
    expect((await jobs.wait(job.id, 60_000)).status).toBe('done');
    expect(refusing.calls).toBe(3);
    const status = pack!.sourceStatuses.find((s) => s.source === 'refusing-news')!;
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/^3\/3 queries failed \(stopped early; .*HTTP 403/);
    expect(pack!.news.length).toBeGreaterThan(0); // the other news sources still contributed
  }, 60_000);
});
