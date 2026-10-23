import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MeetingPack, Settings } from '../../shared/types.js';
import type { Logger } from '../adapters/types.js';
import { logger } from '../core/logger.js';

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
 * directory. Durable atomic writes: the new content goes to a temp file that is
 * fsync'd, the previous good file is kept as <name>.json.bak, then the temp file
 * is renamed over it and the directory fsync'd – a crash or power cut leaves the
 * old or the new file, never a torn one. A pack or settings file that does not
 * parse anyway is read from its .bak, with an error in the log, instead of
 * silently vanishing (research would then treat the meeting as new and lose the
 * day's results); the damaged file is kept as <name>.json.damaged on the next save.
 */
type PackListItem = Pick<MeetingPack, 'id' | 'createdAt' | 'updatedAt' | 'meeting' | 'verificationScore'> & { raceCount: number; predictedRaces: number; resultedRaces: number };

export class Store {
  /** Pack summaries keyed by file name with the mtime they were read at – saves re-parsing megabytes of JSON per listing. */
  private listIndex = new Map<string, { mtimeMs: number; item: PackListItem }>();
  /** Files found damaged on reading: their .bak is the last good copy and must not be replaced by them. */
  private damaged = new Set<string>();
  /** The mtime of each damaged file already reported, so a pack polled every few seconds is logged once, not on every read. */
  private reported = new Map<string, number>();

  constructor(
    public readonly dir: string,
    private readonly log: Pick<Logger, 'warn' | 'error'> = logger,
  ) {
    fs.mkdirSync(path.join(dir, 'packs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  }

  /** Write via temp file + fsync + rename (+ directory fsync). `backup` keeps the file being replaced as <file>.bak. */
  private writeAtomic(file: string, data: unknown, opts: { backup?: boolean } = {}): void {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (opts.backup) this.keepPrevious(file);
    fs.renameSync(tmp, file);
    this.damaged.delete(file);
    fsyncDir(path.dirname(file));
  }

  /** Keep the file about to be replaced: a good one as <file>.bak (a hard link costs nothing; copied where links fail), a damaged one as <file>.damaged. */
  private keepPrevious(file: string): void {
    if (!fs.existsSync(file)) return;
    try {
      if (this.damaged.has(file)) {
        fs.renameSync(file, file + '.damaged');
        return;
      }
      const bak = file + '.bak';
      fs.rmSync(bak, { force: true });
      try {
        fs.linkSync(file, bak);
      } catch {
        fs.copyFileSync(file, bak);
      }
    } catch (err) {
      this.log.warn(`Could not keep a backup of ${path.basename(file)}: ${errorText(err)}`);
    }
  }

  /** Parse a JSON file. With `backup`, a damaged file falls back to its .bak (logged as an error); a damaged cache file is simply ignored. */
  private readJson<T>(file: string, opts: { backup?: boolean } = {}): T | undefined {
    if (!fs.existsSync(file)) return undefined;
    let problem: unknown;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch (err) {
      problem = err;
    }
    if (!opts.backup) return undefined;
    this.damaged.add(file);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      /* gone meanwhile */
    }
    const report = this.reported.get(file) !== mtimeMs;
    this.reported.set(file, mtimeMs);
    try {
      const value = JSON.parse(fs.readFileSync(file + '.bak', 'utf8')) as T;
      if (report) this.log.error(`${file} is damaged (${errorText(problem)}) - using its backup from the previous save; the next save replaces it`);
      return value;
    } catch (err) {
      if (report) this.log.error(`${file} is damaged (${errorText(problem)}) and has no usable backup (${errorText(err)})`);
      return undefined;
    }
  }

  // Settings -----------------------------------------------------------------
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(this.readJson<Partial<Settings>>(path.join(this.dir, 'settings.json'), { backup: true }) || {}) };
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
    this.writeAtomic(path.join(this.dir, 'settings.json'), merged, { backup: true });
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
      const p = this.readJson<MeetingPack>(full, { backup: true });
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
    return this.readJson<MeetingPack>(this.packFile(id), { backup: true });
  }

  savePack(pack: MeetingPack): void {
    pack.updatedAt = new Date().toISOString();
    this.writeAtomic(this.packFile(pack.id), pack, { backup: true });
  }

  deletePack(id: string): boolean {
    const f = this.packFile(id);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    // Its backup too: a later pack of the same meeting must never fall back to the deleted one.
    for (const extra of ['.bak', '.tmp', '.damaged']) fs.rmSync(f + extra, { force: true });
    this.damaged.delete(f);
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

/** Make a rename durable by fsyncing the directory that holds the file. Best effort: not every platform allows it (Windows). */
function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* not supported here */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
