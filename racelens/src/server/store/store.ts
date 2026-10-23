import fs from 'node:fs';
import path from 'node:path';
import type { MeetingPack, Settings } from '../../shared/types.js';

export const DEFAULT_SETTINGS: Settings = {
  bankroll: 200,
  unitAmount: 10,
  riskProfile: 'balanced',
  jurisdiction: 'VIC',
  disabledSources: [],
  autoRecheckMinutesBeforeRace: 10,
};

/**
 * Tiny JSON-file store. One file per meeting pack, plus settings and a cache
 * directory. Atomic writes (tmp + rename) so a crash never corrupts a pack.
 */
export class Store {
  constructor(public readonly dir: string) {
    fs.mkdirSync(path.join(dir, 'packs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  }

  private writeAtomic(file: string, data: unknown): void {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  private readJson<T>(file: string): T | undefined {
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  // Settings -----------------------------------------------------------------
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(this.readJson<Partial<Settings>>(path.join(this.dir, 'settings.json')) || {}) };
  }

  saveSettings(s: Partial<Settings>): Settings {
    const merged = { ...this.getSettings(), ...s };
    this.writeAtomic(path.join(this.dir, 'settings.json'), merged);
    return merged;
  }

  // Packs --------------------------------------------------------------------
  private packFile(id: string): string {
    return path.join(this.dir, 'packs', encodeURIComponent(id) + '.json');
  }

  listPacks(): Array<Pick<MeetingPack, 'id' | 'createdAt' | 'updatedAt' | 'meeting' | 'verificationScore'> & { raceCount: number; predictedRaces: number; resultedRaces: number }> {
    const dir = path.join(this.dir, 'packs');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readJson<MeetingPack>(path.join(dir, f)))
      .filter((p): p is MeetingPack => !!p)
      .map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        meeting: p.meeting,
        verificationScore: p.verificationScore,
        raceCount: p.races.length,
        predictedRaces: Object.keys(p.predictions).length,
        resultedRaces: Object.keys(p.results).length,
      }))
      .sort((a, b) => (a.meeting.date < b.meeting.date ? 1 : a.meeting.date > b.meeting.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1));
  }

  getPack(id: string): MeetingPack | undefined {
    return this.readJson<MeetingPack>(this.packFile(id));
  }

  savePack(pack: MeetingPack): void {
    pack.updatedAt = new Date().toISOString();
    this.writeAtomic(this.packFile(pack.id), pack);
  }

  deletePack(id: string): boolean {
    const f = this.packFile(id);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
  }

  // Cache --------------------------------------------------------------------
  cacheGet<T>(key: string, maxAgeMs: number): T | undefined {
    const f = path.join(this.dir, 'cache', encodeURIComponent(key) + '.json');
    const entry = this.readJson<{ at: number; value: T }>(f);
    if (!entry) return undefined;
    if (Date.now() - entry.at > maxAgeMs) return undefined;
    return entry.value;
  }

  cacheSet<T>(key: string, value: T): void {
    const f = path.join(this.dir, 'cache', encodeURIComponent(key) + '.json');
    this.writeAtomic(f, { at: Date.now(), value });
  }
}
