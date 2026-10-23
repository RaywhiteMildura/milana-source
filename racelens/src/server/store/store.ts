import crypto from 'node:crypto';
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
  autoResults: true,
};

/**
 * Tiny JSON-file store. One file per meeting pack, plus settings and a cache
 * directory. Atomic writes (tmp + rename) so a crash never corrupts a pack.
 */
type PackListItem = Pick<MeetingPack, 'id' | 'createdAt' | 'updatedAt' | 'meeting' | 'verificationScore'> & { raceCount: number; predictedRaces: number; resultedRaces: number };

export class Store {
  /** Pack summaries keyed by file name with the mtime they were read at – saves re-parsing megabytes of JSON per listing. */
  private listIndex = new Map<string, { mtimeMs: number; item: PackListItem }>();

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

  /** A per-installation random secret (signs login cookies). Created on first use, kept in the data dir. */
  getSecret(): string {
    const file = path.join(this.dir, '.secret');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(existing)) return existing;
    } catch {
      /* first run */
    }
    const fresh = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
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

  listPacks(): PackListItem[] {
    const dir = path.join(this.dir, 'packs');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const live = new Set(files);
    for (const k of this.listIndex.keys()) if (!live.has(k)) this.listIndex.delete(k);
    const items: PackListItem[] = [];
    for (const f of files) {
      const full = path.join(dir, f);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      const cached = this.listIndex.get(f);
      if (cached && cached.mtimeMs === mtimeMs) {
        items.push(cached.item);
        continue;
      }
      const p = this.readJson<MeetingPack>(full);
      if (!p) continue;
      const item: PackListItem = {
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        meeting: p.meeting,
        verificationScore: p.verificationScore,
        raceCount: p.races.length,
        predictedRaces: Object.keys(p.predictions).length,
        resultedRaces: Object.keys(p.results).length,
      };
      this.listIndex.set(f, { mtimeMs, item });
      items.push(item);
    }
    return items.sort((a, b) => (a.meeting.date < b.meeting.date ? 1 : a.meeting.date > b.meeting.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1));
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
