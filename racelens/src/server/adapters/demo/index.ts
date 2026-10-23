/**
 * Bundled DEMO sources: deterministic, offline adapters that read the fixture
 * pack in fixtures/demo and present it as six different sources (official,
 * form, two bookmakers, news, weather) with deliberate disagreements.
 *
 *   RACELENS_DEMO_RESULTS_READY=all   publish results for races 1–3 regardless of ctx.now()
 *   RACELENS_DEMO_LATENCY_MS=<ms>     add a small simulated latency to every call (default 0)
 *   RACELENS_DEMO_FAIL=demo-odds-b    make the named source throw a transport error
 *   RACELENS_DEMO_FIXTURES_DIR=<dir>  override the fixture directory
 */
import type { AdapterRegistry } from '../registry.js';
import type { SourceAdapter } from '../types.js';
import { demoFormAdapter, DEMO_FORM_ID } from './form.js';
import { demoNewsAdapter, DEMO_NEWS_ID } from './news.js';
import { demoOddsAAdapter, demoOddsBAdapter, DEMO_ODDS_A_ID, DEMO_ODDS_B_ID } from './odds.js';
import { demoOfficialAdapter, DEMO_OFFICIAL_ID } from './official.js';
import { demoWeatherAdapter, DEMO_WEATHER_ID } from './weather.js';

export {
  DEMO_DATE,
  DEMO_VENUE_SLUG,
  DEMO_MEETING_ID,
  DemoTransportError,
  loadDemoPack,
  loadDemoResults,
  loadDemoNews,
  loadDemoWeather,
  clearDemoFixtureCache,
  resolveDemoFixtureDir,
  demoLatencyMs,
  demoShouldFail,
} from './pack.js';
export type {
  DemoPack,
  DemoRace,
  DemoRunner,
  DemoFormLine,
  DemoOddsQuote,
  DemoVariants,
  DemoRunnerOverride,
  DemoResult,
  DemoResultsFile,
  DemoNewsRaw,
  DemoNewsFile,
  DemoWeatherFile,
} from './pack.js';

export { demoOfficialAdapter, DEMO_OFFICIAL_ID, demoResultAvailable, resultsReadyForAll } from './official.js';
export { demoFormAdapter, DEMO_FORM_ID } from './form.js';
export { demoOddsAAdapter, demoOddsBAdapter, DEMO_ODDS_A_ID, DEMO_ODDS_B_ID, createDemoOddsAdapter } from './odds.js';
export { demoNewsAdapter, DEMO_NEWS_ID } from './news.js';
export { demoWeatherAdapter, DEMO_WEATHER_ID, buildWeatherSummary } from './weather.js';

export const DEMO_ADAPTER_IDS = [
  DEMO_OFFICIAL_ID,
  DEMO_FORM_ID,
  DEMO_ODDS_A_ID,
  DEMO_ODDS_B_ID,
  DEMO_NEWS_ID,
  DEMO_WEATHER_ID,
] as const;

/** All demo adapters in registration order. */
export function createDemoAdapters(): SourceAdapter[] {
  return [demoOfficialAdapter, demoFormAdapter, demoOddsAAdapter, demoOddsBAdapter, demoNewsAdapter, demoWeatherAdapter];
}

/** Register every demo adapter on the given registry (used by RACELENS_MODE=demo and tests). */
export function registerDemoAdapters(registry: AdapterRegistry): void {
  for (const adapter of createDemoAdapters()) registry.register(adapter);
}
