import { AdapterRegistry } from './registry.js';
import { registerDemoAdapters } from './demo/index.js';
import { registerLiveAdapters } from './live/index.js';

export type Mode = 'live' | 'demo';

export function createRegistry(mode: Mode): AdapterRegistry {
  const registry = new AdapterRegistry();
  if (mode === 'demo') registerDemoAdapters(registry);
  else registerLiveAdapters(registry);
  return registry;
}
