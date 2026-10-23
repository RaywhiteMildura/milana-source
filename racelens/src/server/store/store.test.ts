import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MeetingPack } from '../../shared/types.js';
import { DEFAULT_SETTINGS, Store } from './store.js';

/**
 * The JSON store on a power cut or a damaged file: writes are fsync'd, the previous good file is kept as .bak, and a
 * pack or settings file that does not parse is read from its .bak (logged as an error) instead of silently vanishing.
 */
describe('Store durability', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-store-'));
    dirs.push(dir);
    const errors: string[] = [];
    const warns: string[] = [];
    const store = new Store(dir, { error: (m) => errors.push(m), warn: (m) => warns.push(m) });
    const file = path.join(dir, 'packs', `${encodeURIComponent('2026-10-24:flemington')}.json`);
    return { dir, store, errors, warns, file };
  }

  const pack = (results: number): MeetingPack =>
    ({
      id: '2026-10-24:flemington',
      createdAt: 't',
      updatedAt: 't',
      meeting: { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] },
      races: [],
      predictions: {},
      news: [],
      sourceStatuses: [],
      dayPatterns: [],
      results: Object.fromEntries(Array.from({ length: results }, (_, i) => [i + 1, { raceNumber: i + 1, placings: [[1]], recordedAt: 't', source: 'a' }])),
      history: [],
      verificationScore: 1,
      settings: DEFAULT_SETTINGS,
    }) as MeetingPack;

  it('fsyncs every write and keeps the previous version as <name>.json.bak', () => {
    const { store, file } = setup();
    const fsync = vi.spyOn(fs, 'fsyncSync');
    store.savePack(pack(1));
    expect(fsync).toHaveBeenCalled();
    expect(fs.existsSync(file + '.bak')).toBe(false); // nothing to keep yet
    store.savePack(pack(2));
    expect(Object.keys(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).results)).toEqual(['1']);
    expect(Object.keys(store.getPack('2026-10-24:flemington')!.results)).toEqual(['1', '2']);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('a damaged pack is read from its backup, logged once as an error, still listed, and replaced (kept aside) on the next save', () => {
    const { store, file, errors } = setup();
    store.savePack(pack(2));
    store.savePack(pack(3));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 40)); // torn write
    const got = store.getPack('2026-10-24:flemington');
    expect(Object.keys(got!.results)).toEqual(['1', '2']); // the previous save
    expect(store.getPack('2026-10-24:flemington')).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/flemington\.json is damaged .* using its backup from the previous save/);
    expect(store.listPacks().map((p) => p.resultedRaces)).toEqual([2]);

    store.savePack(got!);
    expect(Object.keys(store.getPack('2026-10-24:flemington')!.results)).toEqual(['1', '2']);
    expect(fs.readFileSync(file + '.damaged', 'utf8')).toHaveLength(40);
    // The good backup was not replaced by the damaged file.
    expect(Object.keys(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).results)).toEqual(['1', '2']);
    expect(errors).toHaveLength(1);
  });

  it('a damaged pack without a usable backup says so loudly', () => {
    const { store, file, errors } = setup();
    store.savePack(pack(1));
    fs.writeFileSync(file, '');
    expect(store.getPack('2026-10-24:flemington')).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/is damaged .* and has no usable backup/);
  });

  it('deleting a pack deletes its backup too, so a later pack of the meeting never falls back to it', () => {
    const { store, file } = setup();
    store.savePack(pack(1));
    store.savePack(pack(2));
    expect(store.deletePack('2026-10-24:flemington')).toBe(true);
    expect(fs.existsSync(file + '.bak')).toBe(false);
    store.savePack(pack(1));
    fs.writeFileSync(file, '{');
    expect(store.getPack('2026-10-24:flemington')).toBeUndefined();
  });

  it('damaged settings fall back to the backup, not to the defaults', () => {
    const { store, dir, errors } = setup();
    store.saveSettings({ bankroll: 500 });
    store.saveSettings({ unitAmount: 25 });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"bankroll": 5');
    expect(store.getSettings()).toMatchObject({ bankroll: 500, unitAmount: DEFAULT_SETTINGS.unitAmount });
    expect(errors).toHaveLength(1);
  });

  it('a damaged cache entry is just a cache miss', () => {
    const { store, dir, errors } = setup();
    store.cacheSet('meetings:2026-10-24', { a: 1 });
    expect(store.cacheGet('meetings:2026-10-24', 60_000)).toEqual({ a: 1 });
    fs.writeFileSync(path.join(dir, 'cache', `${encodeURIComponent('meetings:2026-10-24')}.json`), '{');
    expect(store.cacheGet('meetings:2026-10-24', 60_000)).toBeUndefined();
    expect(errors).toEqual([]);
  });
});
