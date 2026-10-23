import type { SourceAdapter } from './types.js';

/**
 * Central registry of source adapters. Adapters register themselves via
 * `registerAdapter`; `createAdapters(mode)` in ./index.ts wires the set for the
 * current mode.
 */
export class AdapterRegistry {
  private adapters = new Map<string, SourceAdapter>();

  register(a: SourceAdapter): this {
    this.adapters.set(a.id, a);
    return this;
  }

  get(id: string): SourceAdapter | undefined {
    return this.adapters.get(id);
  }

  all(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  enabled(disabled: string[] = []): SourceAdapter[] {
    return this.all().filter((a) => !disabled.includes(a.id));
  }

  withCapability(cap: SourceAdapter['capabilities'][number], disabled: string[] = []): SourceAdapter[] {
    return this.enabled(disabled).filter((a) => a.capabilities.includes(cap));
  }
}
