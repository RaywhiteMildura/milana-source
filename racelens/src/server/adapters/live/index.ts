import type { AdapterRegistry } from '../registry.js';
import { RacingAustraliaAdapter } from './racingaustralia.js';
import { TabAdapter } from './tab.js';
import { RacingComAdapter } from './racingcom.js';
import { SportsbetAdapter } from './sportsbet.js';
import { EntainAdapter } from './entain.js';
import { GoogleNewsAdapter } from './googlenews.js';
import { BingNewsAdapter } from './bingnews.js';
import { RedditAdapter } from './reddit.js';
import { RacingRssAdapter } from './racingrss.js';
import { OpenMeteoAdapter } from './openmeteo.js';

/**
 * Live (internet) adapters. Each one is independent; the orchestrator treats a
 * failing source as a warning, never as a failed research run.
 */
export function registerLiveAdapters(registry: AdapterRegistry): void {
  registry
    .register(new RacingAustraliaAdapter())
    .register(new RacingComAdapter())
    .register(new TabAdapter())
    .register(new SportsbetAdapter())
    .register(new EntainAdapter())
    .register(new GoogleNewsAdapter())
    .register(new BingNewsAdapter())
    .register(new RacingRssAdapter())
    .register(new RedditAdapter())
    .register(new OpenMeteoAdapter());
}
