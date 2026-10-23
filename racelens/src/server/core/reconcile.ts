import type {
  FieldAgreement,
  FormLine,
  MeetingRaw,
  OddsQuote,
  Race,
  RaceRaw,
  RaceStatus,
  Runner,
  RunnerRaw,
  SourceId,
  SourceKind,
  Verification,
} from '../../shared/types.js';
import { normaliseName, normalisePerson, round } from '../../shared/util.js';

/**
 * Reconciliation engine: merges the same meeting as seen by many sources into a
 * single verified view, recording for every important fact which sources agree
 * and which disagree. This is what lets RaceLens never depend on one source.
 */

export interface SourceMeta {
  id: SourceId;
  kind: SourceKind;
}

const KIND_WEIGHT: Record<SourceKind, number> = {
  official: 1.0,
  form: 0.85,
  odds: 0.65,
  demo: 0.7,
  news: 0.1,
  weather: 0.1,
};

const STATUS_RANK: Record<RaceStatus, number> = {
  unknown: 0,
  open: 1,
  closed: 2,
  interim: 3,
  final: 4,
  abandoned: 5,
};

export interface ReconcileOptions {
  /** Source kinds, used to weight votes. Unknown sources get weight 0.6. */
  sources: SourceMeta[];
  /** Minimum name similarity (0..1) to merge runners whose names differ. */
  nameSimilarity?: number;
}

export interface ReconciledMeeting {
  races: Race[];
  verification: Verification;
  /** Sources that contributed at least one race */
  sources: SourceId[];
}

/** Bigram Dice coefficient between two normalised strings. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) || 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

interface Vote<T> {
  source: SourceId;
  value: T;
  weight: number;
}

function agree<T>(votes: Vote<T>[], keyFn: (v: T) => string = (v) => String(v)): FieldAgreement<T> {
  const valid = votes.filter((v) => v.value !== undefined && v.value !== null && !(typeof v.value === 'number' && Number.isNaN(v.value)) && String(v.value) !== '');
  if (!valid.length) return { value: undefined, agree: [], disagree: [], confidence: 0 };
  const groups = new Map<string, { weight: number; votes: Vote<T>[] }>();
  for (const v of valid) {
    const k = keyFn(v.value);
    const g = groups.get(k) || { weight: 0, votes: [] };
    g.weight += v.weight;
    g.votes.push(v);
    groups.set(k, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const winner = ranked[0];
  const totalWeight = valid.reduce((a, v) => a + v.weight, 0);
  const share = winner.weight / totalWeight;
  // Prefer the most informative representation (longest string) from the heaviest source.
  const best = [...winner.votes].sort((a, b) => b.weight - a.weight || String(b.value).length - String(a.value).length)[0];
  const n = valid.length;
  // Base confidence grows with corroboration: 1 source 0.55, 2 agreeing 0.8, 3+ 0.95; scaled by the agreeing share.
  const base = n === 1 ? 0.55 : n === 2 ? 0.8 : 0.95;
  const confidence = round(Math.max(0.15, base * share * (ranked.length > 1 ? 0.9 : 1)), 3);
  return {
    value: best.value,
    agree: winner.votes.map((v) => v.source),
    disagree: ranked.slice(1).flatMap((g) => g.votes.map((v) => ({ source: v.source, value: v.value }))),
    confidence,
  };
}

interface Cluster {
  key: string;
  members: Array<{ source: SourceId; weight: number; runner: RunnerRaw }>;
}

/** Group runners of the same race across sources into clusters by name (fuzzy) and number. */
export function clusterRunners(entries: Array<{ source: SourceId; weight: number; runners: RunnerRaw[] }>, threshold = 0.82): Cluster[] {
  const clusters: Cluster[] = [];
  // Highest-weight source first so its naming anchors the clusters.
  const ordered = [...entries].sort((a, b) => b.weight - a.weight);
  for (const entry of ordered) {
    for (const runner of entry.runners) {
      if (!runner.name) continue;
      const key = normaliseName(runner.name);
      let target = clusters.find((c) => c.key === key && !c.members.some((m) => m.source === entry.source));
      if (!target) {
        // Fuzzy: same number and similar name, or very similar name alone
        let best: { c: Cluster; s: number } | undefined;
        for (const c of clusters) {
          if (c.members.some((m) => m.source === entry.source)) continue;
          const s = similarity(c.key, key);
          const anchorNumber = c.members[0].runner.number;
          const sameNumber = runner.number != null && anchorNumber != null && runner.number === anchorNumber;
          const ok = s >= threshold || (sameNumber && s >= 0.5) || (sameNumber && key.split(' ')[0] === c.key.split(' ')[0]);
          if (ok && (!best || s > best.s)) best = { c, s };
        }
        target = best?.c;
      }
      if (!target) {
        target = { key, members: [] };
        clusters.push(target);
      }
      target.members.push({ source: entry.source, weight: entry.weight, runner });
    }
  }
  return clusters;
}

function pick<T>(members: Cluster['members'], get: (r: RunnerRaw) => T | undefined): T | undefined {
  for (const m of [...members].sort((a, b) => b.weight - a.weight)) {
    const v = get(m.runner);
    if (v !== undefined && v !== null && !(typeof v === 'string' && v === '')) return v;
  }
  return undefined;
}

function mergeForm(members: Cluster['members']): FormLine[] {
  const seen = new Map<string, FormLine>();
  for (const m of [...members].sort((a, b) => b.weight - a.weight)) {
    for (const f of m.runner.form || []) {
      const k = `${f.date}|${normaliseName(f.venue)}|${f.distance}`;
      if (!seen.has(k)) seen.set(k, { ...f, source: f.source || m.source });
      else {
        // Fill gaps from lower-priority sources
        const cur = seen.get(k)!;
        for (const [kk, vv] of Object.entries(f)) {
          if ((cur as unknown as Record<string, unknown>)[kk] === undefined && vv !== undefined) (cur as unknown as Record<string, unknown>)[kk] = vv;
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function mergeOdds(members: Cluster['members']): OddsQuote[] {
  const out: OddsQuote[] = [];
  for (const m of members) for (const q of m.runner.odds || []) out.push({ ...q, source: q.source || m.source });
  return out;
}

export function reconcileRunner(cluster: Cluster, raceSources: SourceId[]): Runner {
  const ms = cluster.members;
  const votes = <T>(get: (r: RunnerRaw) => T | undefined): Vote<T>[] =>
    ms.map((m) => ({ source: m.source, weight: m.weight, value: get(m.runner) as T })).filter((v) => v.value !== undefined);

  const number = agree(votes((r) => r.number));
  const barrier = agree(votes((r) => r.barrier));
  const jockey = agree(votes((r) => r.jockey), (v) => normalisePerson(v));
  const trainer = agree(votes((r) => r.trainer), (v) => normalisePerson(v));
  const weight = agree(votes((r) => r.weight), (v) => String(Math.round(v * 2) / 2));
  // Scratched: any official/form source saying scratched wins; otherwise majority.
  const scratchVotes = votes((r) => r.scratched);
  const scratchedAgreement = agree(scratchVotes.length ? scratchVotes : ms.map((m) => ({ source: m.source, weight: m.weight, value: false })));
  const anyScratched = scratchVotes.some((v) => v.value === true && v.weight >= 0.8);
  const scratched = anyScratched ? true : scratchedAgreement.value === true;

  const conflicts: string[] = [];
  const checks: Array<[string, FieldAgreement<unknown>]> = [
    ['Saddlecloth', number],
    ['Barrier', barrier],
    ['Jockey', jockey],
    ['Trainer', trainer],
    ['Weight', weight],
    ['Scratching', scratchedAgreement],
  ];
  let checked = 0;
  let agreed = 0;
  let confSum = 0;
  for (const [label, f] of checks) {
    if (f.value === undefined) continue;
    checked++;
    confSum += f.confidence;
    if (f.disagree.length) {
      conflicts.push(`${label}: ${f.agree.join(', ')} say ${fmt(f.value)}; ${f.disagree.map((d) => `${d.source} says ${fmt(d.value)}`).join('; ')}`);
    } else agreed++;
  }
  const sourceCount = new Set(ms.map((m) => m.source)).size;
  const coverage = raceSources.length ? Math.min(1, sourceCount / Math.max(1, raceSources.length)) : 1;
  const score = checked ? round(Math.min(1, (confSum / checked) * (0.7 + 0.3 * coverage)), 3) : 0.2;

  const ratings: Record<string, number> = {};
  for (const m of ms) for (const [k, v] of Object.entries(m.runner.ratings || {})) if (typeof v === 'number') ratings[`${k}`] = v;
  const gear = [...new Set(ms.flatMap((m) => m.runner.gearChanges || []))];
  const comments = ms.filter((m) => m.runner.comment).map((m) => ({ source: m.source, text: m.runner.comment! }));

  const name = pick(ms, (r) => r.name) || cluster.key;
  const splits = pick(ms, (r) => r.splits);
  const career = [...ms]
    .map((m) => m.runner.career)
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => b.starts - a.starts)[0];

  return {
    id: normaliseName(name).replace(/\s+/g, '-'),
    number: number.value ?? 0,
    name,
    barrier: barrier.value,
    jockey: jockey.value,
    trainer: trainer.value,
    weight: weight.value,
    claim: pick(ms, (r) => r.claim),
    scratched,
    emergency: pick(ms, (r) => r.emergency),
    age: pick(ms, (r) => r.age),
    sex: pick(ms, (r) => r.sex),
    colour: pick(ms, (r) => r.colour),
    sire: pick(ms, (r) => r.sire),
    dam: pick(ms, (r) => r.dam),
    damSire: pick(ms, (r) => r.damSire),
    country: pick(ms, (r) => r.country),
    last5: pick(ms, (r) => r.last5),
    career,
    splits,
    form: mergeForm(ms),
    daysSinceLastRun: pick(ms, (r) => r.daysSinceLastRun),
    gearChanges: gear,
    comments,
    ratings,
    speedMapPosition: pick(ms, (r) => r.speedMapPosition),
    odds: mergeOdds(ms),
    finishingPosition: pick(ms, (r) => r.finishingPosition),
    margin: pick(ms, (r) => r.margin),
    silk: pick(ms, (r) => r.silk),
    jockeyStats: pick(ms, (r) => r.jockeyStats),
    trainerStats: pick(ms, (r) => r.trainerStats),
    fields: { barrier, jockey, trainer, weight, scratched: scratchedAgreement, number },
    sources: [...new Set(ms.map((m) => m.source))],
    verification: { score, sourceCount, conflicts, checkedFields: checked, agreedFields: agreed },
    news: [],
  };
}

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'scratched' : 'running';
  return String(v);
}

export function reconcileRace(raws: Array<{ source: SourceId; weight: number; race: RaceRaw }>): Race {
  const ordered = [...raws].sort((a, b) => b.weight - a.weight);
  const anchor = ordered[0].race;
  const sources = ordered.map((r) => r.source);
  const clusters = clusterRunners(ordered.map((r) => ({ source: r.source, weight: r.weight, runners: r.race.runners })));
  const runners = clusters.map((c) => reconcileRunner(c, sources)).sort((a, b) => a.number - b.number);

  // Resolve duplicate saddlecloth numbers (e.g. a fuzzy miss): keep the first, zero the rest' conflicts noted.
  const seen = new Set<number>();
  for (const r of runners) {
    if (r.number && seen.has(r.number)) r.verification.conflicts.push(`Saddlecloth ${r.number} is claimed by another runner`);
    seen.add(r.number);
  }

  const status = ordered.map((r) => r.race.status).sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0] || 'unknown';
  const withResults = ordered.find((r) => r.race.results && r.race.results.length);
  const distanceVotes = agree(ordered.map((r) => ({ source: r.source, weight: r.weight, value: r.race.distance })).filter((v) => v.value));
  const nameVotes = agree(ordered.map((r) => ({ source: r.source, weight: r.weight, value: r.race.name })).filter((v) => v.value), (v) => normaliseName(v));

  const active = runners.filter((r) => !r.scratched);
  const runnerScores = runners.map((r) => r.verification.score);
  const meanScore = runnerScores.length ? runnerScores.reduce((a, b) => a + b, 0) / runnerScores.length : 0;
  const multiSource = runners.length ? runners.filter((r) => r.sources.length >= 2).length / runners.length : 0;
  const raceConflicts: string[] = [];
  if (distanceVotes.disagree.length) raceConflicts.push(`Distance: ${distanceVotes.agree.join(', ')} say ${distanceVotes.value}m; ${distanceVotes.disagree.map((d) => `${d.source} says ${d.value}m`).join('; ')}`);
  if (nameVotes.disagree.length) raceConflicts.push(`Race name differs between sources (${nameVotes.disagree.map((d) => d.source).join(', ')})`);
  const score = round(Math.min(1, meanScore * (0.75 + 0.25 * multiSource) * (raceConflicts.length ? 0.95 : 1)), 3);

  const sourceRefs: Record<string, string> = {};
  for (const r of ordered) Object.assign(sourceRefs, r.race.sourceRefs || {});

  return {
    number: anchor.number,
    name: nameVotes.value || anchor.name,
    distance: distanceVotes.value || anchor.distance,
    startTime: ordered.map((r) => r.race.startTime).find(Boolean),
    raceClass: ordered.map((r) => r.race.raceClass).find(Boolean),
    group: ordered.map((r) => r.race.group).find(Boolean),
    prize: ordered.map((r) => r.race.prize).find((p) => p != null),
    ageRestriction: ordered.map((r) => r.race.ageRestriction).find(Boolean),
    sexRestriction: ordered.map((r) => r.race.sexRestriction).find(Boolean),
    trackCondition: ordered.map((r) => r.race.trackCondition).find(Boolean),
    trackRating: ordered.map((r) => r.race.trackRating).find((p) => p != null),
    status,
    sourceRefs,
    runners,
    results: withResults?.race.results,
    sources,
    verification: {
      score,
      sourceCount: sources.length,
      conflicts: raceConflicts,
      checkedFields: runners.reduce((a, r) => a + r.verification.checkedFields, 0),
      agreedFields: runners.reduce((a, r) => a + r.verification.agreedFields, 0),
    },
    fieldSize: active.length,
    fetchedAt: ordered.map((r) => r.race.fetchedAt).sort().reverse()[0] || new Date(0).toISOString(),
  };
}

/** Reconcile a whole meeting across sources. */
export function reconcileMeeting(raws: MeetingRaw[], opts: ReconcileOptions): ReconciledMeeting {
  const weightOf = (id: SourceId) => KIND_WEIGHT[opts.sources.find((s) => s.id === id)?.kind || 'odds'] ?? 0.6;
  const byNumber = new Map<number, Array<{ source: SourceId; weight: number; race: RaceRaw }>>();
  for (const m of raws) {
    for (const race of m.races) {
      if (!race.number) continue;
      const arr = byNumber.get(race.number) || [];
      arr.push({ source: m.source, weight: weightOf(m.source), race });
      byNumber.set(race.number, arr);
    }
  }
  const races = [...byNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, arr]) => reconcileRace(arr));
  const scores = races.map((r) => r.verification.score);
  const score = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 3) : 0;
  const sources = [...new Set(raws.filter((m) => m.races.length).map((m) => m.source))];
  return {
    races,
    sources,
    verification: {
      score,
      sourceCount: sources.length,
      conflicts: races.flatMap((r) => r.verification.conflicts.map((c) => `R${r.number} ${c}`)),
      checkedFields: races.reduce((a, r) => a + r.verification.checkedFields, 0),
      agreedFields: races.reduce((a, r) => a + r.verification.agreedFields, 0),
    },
  };
}

/**
 * Merge a freshly reconciled race (pre-race recheck: new odds, scratchings,
 * jockey changes) into the previously researched race, keeping the deep form
 * that only the original research fetched.
 */
export function mergeRaceRefresh(previous: Race, fresh: Race): Race {
  const prevByKey = new Map(previous.runners.map((r) => [r.id, r]));
  const runners: Runner[] = fresh.runners.map((f) => {
    const p = prevByKey.get(f.id) || previous.runners.find((r) => similarity(r.id, f.id) > 0.85 || (r.number === f.number && r.number > 0));
    if (!p) return f;
    return {
      ...p,
      ...f,
      form: f.form.length >= p.form.length ? f.form : p.form,
      splits: f.splits || p.splits,
      career: f.career || p.career,
      sire: f.sire || p.sire,
      dam: f.dam || p.dam,
      damSire: f.damSire || p.damSire,
      age: f.age ?? p.age,
      sex: f.sex || p.sex,
      colour: f.colour || p.colour,
      last5: f.last5 || p.last5,
      daysSinceLastRun: f.daysSinceLastRun ?? p.daysSinceLastRun,
      gearChanges: f.gearChanges.length ? f.gearChanges : p.gearChanges,
      comments: f.comments.length ? f.comments : p.comments,
      ratings: { ...p.ratings, ...f.ratings },
      speedMapPosition: f.speedMapPosition || p.speedMapPosition,
      odds: f.odds.length ? f.odds : p.odds,
      jockeyStats: f.jockeyStats || p.jockeyStats,
      trainerStats: f.trainerStats || p.trainerStats,
      news: p.news,
    };
  });
  // Runners that vanished from every source on refresh are most likely scratched.
  for (const p of previous.runners) {
    if (!runners.some((r) => r.id === p.id || (r.number === p.number && p.number > 0))) {
      runners.push({ ...p, scratched: true, verification: { ...p.verification, conflicts: [...p.verification.conflicts, 'Missing from all sources on refresh; treated as scratched'] } });
    }
  }
  runners.sort((a, b) => a.number - b.number);
  return { ...previous, ...fresh, runners, fieldSize: runners.filter((r) => !r.scratched).length };
}
