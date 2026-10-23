#!/usr/bin/env node
/**
 * Deterministic generator for the RaceLens DEMO fixture pack.
 *
 *   node fixtures/demo/generate-pack.mjs
 *
 * Writes (next to this file):
 *   flemington-2026-10-24.json  – a FICTIONAL 9-race Flemington meeting (runners, form, odds, source variants)
 *   results.json                – results for races 1–3 (on-pace / inside-barrier bias, favourites 2/3)
 *   weather.json                – Open-Meteo-like hourly series 2026-10-21..24 (light rain on the 22nd)
 *
 * Everything is seeded so the output is byte-for-byte stable. Horse, jockey and
 * trainer names are invented. `news.json` is hand-written and references the
 * names fixed below (see FORCED), so keep those stable when editing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATE = '2026-10-24';
const TZ = '+11:00';
const VENUE = 'Flemington';
const VENUE_SLUG = 'flemington';
const MEETING_ID = `${DATE}:${VENUE_SLUG}`;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261024);
const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// ---------------------------------------------------------------------------
// Date helpers (UTC arithmetic on YYYY-MM-DD strings)
// ---------------------------------------------------------------------------
const DAY = 86400000;
const dateToMs = (s) => Date.parse(s + 'T00:00:00Z');
const msToDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (s, n) => msToDate(dateToMs(s) + n * DAY);
const daysBetween = (a, b) => Math.round((dateToMs(b) - dateToMs(a)) / DAY);
const localIso = (date, hhmm) => `${date}T${hhmm}:00${TZ}`;

// ---------------------------------------------------------------------------
// Name pools (all invented)
// ---------------------------------------------------------------------------
const JOCKEYS = [
  'T. Marchetti', 'B. Kowalski', 'J. Nakamura-Reid', 'S. Fairweather', 'D. Oyelaran', 'K. Lindqvist',
  'M. Brannigan', 'H. Castellano', 'R. Tuilagi', 'A. Petrakis', 'C. Whitlam', 'E. Sorensen',
  'P. Delacroix', 'N. Haddad', 'W. Okonjo', 'Z. Ferreira', 'G. McAllister', 'L. Vanderberg',
  'I. Takahashi', 'O. Brightwater', 'J. Pham', 'A. Nguyen-Baxter',
];
const APPRENTICE_CLAIM = { 'J. Pham': 2, 'A. Nguyen-Baxter': 1.5 };
const TRAINERS = [
  'Linda Okafor', 'Marcus & Priya Castellanos', 'Harriet Vane-Stokes', 'Declan Murtagh', 'S. & J. Templeton',
  'Ingrid Solberg', 'Tony Barrasso', 'Fiona Macquarie', 'Ruben Delgado', 'Annika Lindgren', 'Peter Hargreaves',
  'Bianca Moretti', 'Gordon Fairlie', 'Colin & Dana Kirkwood', 'Yusuf Rahimi', "Megan O'Driscoll",
  'Nick Thackeray', 'Sophie Carrington',
];
const SIRES = [
  'Street Lamp', 'Thunder Ledger', 'Iron Constitution', 'Night Watchman', 'Velvet Hammer', 'Sea Captain',
  'Lightning Quill', 'Gold Standard Lad', 'Riverstone Rebel', 'Northern Compass', 'Royal Decree', 'Quick Draw Kid',
  'Deep Harbour', 'Marble Arch', 'Southern Sentinel', 'Firebrand Fellow',
];
const DAMS = [
  'Lantern Light', 'Quiet Harbour', 'Sweet Marjoram', 'Autumn Ledger', 'Pearl Of Parkville', 'Misty Morning Tea',
  'Candle Glow', 'Riverside Rose', 'Opal Whisper', 'Seaside Sonnet', 'Velvet Curtain', 'Golden Gazette',
  'Starboard Lass', 'Mountain Mist', 'Violet Verse', 'Harbour Lantern', 'Dawn Chorus Girl', 'Silver Spoonful',
];
const DAM_SIRES = [
  'Old Testament', 'Compass Point', 'Grey Gazette', 'Harbour Master', 'Royal Ledger', 'Sunset Boulevard Lad',
  'Western Front', 'Midnight Mariner', 'Stone Bridge', 'Bold Barrister',
];
const COLOURS = ['bay', 'bay', 'bay', 'brown', 'chestnut', 'chestnut', 'grey', 'black', 'bay or brown'];
const OTHER_HORSES = [
  'Outback Overture', "Rival's Reward", 'Wandering Willow', 'Nowhere Fast', 'Borrowed Time', 'Castle Keep',
  'Lemon Twist Lad', 'Prairie Postcard', 'Vanishing Point', 'Harlequin Haze', 'Crimson Codex', 'Winter Wager',
  'Pelican Point', 'Granite Gaze', 'Tumbleweed Tess', 'Mulberry Mile', 'Jasper Junction', 'Bootleg Ballad',
  'Compass Rose Kid', 'Sandstone Sprite',
];
const VENUES_METRO = ['Flemington', 'Caulfield', 'Moonee Valley', 'Sandown'];
const VENUES_PROV = ['Bendigo', 'Ballarat', 'Geelong', 'Cranbourne', 'Pakenham', 'Mornington', 'Kilmore', 'Sale'];
const VENUES_INTERSTATE = ['Randwick', 'Rosehill', 'Eagle Farm', 'Doomben', 'Morphettville', 'Ascot'];
const VENUES_NZ = ['Ellerslie', 'Te Rapa', 'Riccarton', 'Hastings'];
const VENUES_2YO = ['Cranbourne', 'Pakenham', 'Caulfield', 'Sandown', 'Moonee Valley'];
const GEAR = [
  'Blinkers first time', 'Blinkers off, winkers first time', 'Tongue tie off', 'Winkers first time',
  'Lugging bit first time', 'Ear muffs (pre-race only)', 'Nose roll off', 'Cross-over nose band first time',
  'Tongue tie first time', 'Pacifiers first time',
];

// ---------------------------------------------------------------------------
// Race programme
// ---------------------------------------------------------------------------
const RACES = [
  {
    number: 1, name: 'R1 Maribyrnong Trial Stakes 1000m 2yo', distance: 1000, time: '12:25', raceClass: 'Listed', group: 'Listed',
    prize: 160000, ageRestriction: '2yo', weights: 'sw2yo', tier: '2yo',
    names: ['Pocket Rocketeer', 'Velvet Thunderclap', 'Miss Maribyrnong', 'Lightning Ledger', 'Tiny Tornado', 'Sugarloaf Sprite',
      'Dashing Dividend', 'Copper Comet', 'Whistling Wren', 'Early Edition'],
    forcedBarrier: { 6: 3, 2: 1, 9: 7 },
    forcedSpeed: { 6: 'leader', 2: 'on-pace', 9: 'midfield' },
    forcedRating: { 6: 'top' },
  },
  {
    number: 2, name: 'R2 Demo Handicap 1400m BM78', distance: 1400, time: '13:00', raceClass: 'BM78', prize: 130000,
    ageRestriction: '3yo+', weights: 'handicap', top: 60.5, bottom: 54, tier: 'bm',
    names: ['Ironbark Avenue', 'Saltbush Samba', 'Marmalade Sky', 'Fenwick Lane', 'Bluestone Alley', 'Pepper Creek Road',
      'Lord Lygon', 'Brunswick Bazaar', 'Ticket To Tullamarine', 'Cobalt Current', 'Gentle Larrikin', 'Dusty Boulevard'],
    forcedBarrier: { 8: 4, 3: 2, 1: 11, 5: 6 },
    forcedSpeed: { 8: 'on-pace', 3: 'leader', 1: 'backmarker' },
    forcedRating: { 1: 'top', 8: 'mid' },
  },
  {
    number: 3, name: 'R3 Riverbend Stakes 1200m 3yo Fillies Group 3', distance: 1200, time: '13:35', raceClass: 'Group 3', group: 'G3',
    prize: 200000, ageRestriction: '3yo', sexRestriction: 'Fillies', weights: 'sw3yoF', tier: 'group',
    names: ['Opal Overture', 'Sapphire Sonnet', 'Miss Moonee Ponds', 'Lilac Luminary', 'Tessellate', "Nellie's Lantern",
      'Amber Verdict', 'Rosella Rhapsody', 'Ginger Gazette', 'Paper Lanterns', 'Coral Catwalk', 'Daisy Chain Dancer',
      'Scarlet Stanza', 'Hazel Halo'],
    forcedBarrier: { 2: 5, 11: 1, 6: 9, 4: 3 },
    forcedSpeed: { 2: 'on-pace', 11: 'leader', 6: 'midfield' },
    forcedRating: { 2: 'top' },
  },
  {
    number: 4, name: 'R4 Straight Six Sprint 1200m BM90', distance: 1200, time: '14:10', raceClass: 'BM90', prize: 150000,
    ageRestriction: '3yo+', weights: 'handicap', top: 60.5, bottom: 54, tier: 'bm',
    names: ['Straight Line Steve', 'Skyline Sprinter', 'Rapid Rhetoric', 'Bolt Of Basalt', 'Midnight Metronome', 'Sonic Sonata',
      'Zephyr Zone', 'Turbo Tango', 'Keilor Kingpin', 'Quickstep Quarry', 'Jetstream Jack', 'Flashbulb Fella', 'Sudden Sunrise',
      'Brakeless Bandit', 'Hot Pursuit Harry', 'Six Furlong Fury', 'Last Minute Larry'],
    scratched: [9], emergency: [17],
  },
  {
    number: 5, name: 'R5 Demo Mile 1600m Open Handicap', distance: 1600, time: '14:45', raceClass: 'Open Handicap', prize: 175000,
    ageRestriction: '3yo+', weights: 'handicap', top: 60.5, bottom: 52, tier: 'open',
    names: ['Mile High Maestro', 'Parliament Pass', 'Collins Street Cat', 'Yarra Yarra Yonder', 'Tramline Tenor', 'Docklands Drifter',
      'Elm Row Elegance', 'Nightwatch Ned', 'Ascot Vale Avenger', 'Treasury Gardens', 'Spring Street Sage', 'Bourke Street Bard',
      'Footscray Phantom'],
  },
  {
    number: 6, name: 'R6 Westgate Cup 2500m Open WFA Group 3', distance: 2500, time: '15:20', raceClass: 'Group 3', group: 'G3',
    prize: 250000, ageRestriction: '3yo+', weights: 'wfa', tier: 'group',
    names: ['Marathon Mandolin', 'Distant Drums Dan', 'Long Road Lucy', 'Perpetual Pilgrim', 'Horizon Hollow', "Stayer's Lament"],
  },
  {
    number: 7, name: 'R7 Flying Demo Stakes 1100m Open WFA Group 2', distance: 1100, time: '15:55', raceClass: 'Group 2', group: 'G2',
    prize: 300000, ageRestriction: '3yo+', weights: 'wfa', tier: 'group',
    names: ['Supersonic Sue', 'Blink And Miss', 'Laser Lane', 'Rocket Rue', 'Fast Track Freddie', 'Thunder Thistle',
      'Scorching Sands', 'Blistering Bess', 'Velocity Vale', 'Fire Alarm Fiona', 'Quick Quill'],
    scratched: [3],
  },
  {
    number: 8, name: 'R8 Riverside Handicap 2000m BM84', distance: 2000, time: '16:30', raceClass: 'BM84', prize: 130000,
    ageRestriction: '3yo+', weights: 'handicap', top: 60, bottom: 54, tier: 'bm',
    names: ["Steady Eddie's Dream", 'Cobblestone Climb', 'Autumn Argument', 'Gumtree Gallop', 'Royal Park Ranger', 'Lakeside Lyric',
      'Twilight Tramway', 'Hume Highway Hero', 'Grampians Ghost', 'Bendigo Bound', 'Ballarat Breeze', 'Moorabool Meadow',
      'Otway Oracle', 'Silverleaf Symphony'],
  },
  {
    number: 9, name: 'R9 Demo Plate 2040m WFA Group 1', distance: 2040, time: '17:05', raceClass: 'Group 1', group: 'G1',
    prize: 750000, ageRestriction: '3yo+', weights: 'wfa', tier: 'g1',
    names: ['Demo Dynasty', 'Tauranga Mist', 'Sovereign Serenade', 'Grand Finale Gus', 'Regal Reckoning', 'Imperial Ink',
      "Monarch's Mantle", 'Crown Of Carrum', 'Noble Narrative', 'Epic Equation'],
  },
];

/** Fixed attributes so news.json and the source variants line up. */
const FORCED = {
  '1:6': { jockey: 'K. Lindqvist', trainer: 'Marcus & Priya Castellanos' },
  '1:2': { jockey: 'H. Castellano', trainer: 'Peter Hargreaves' },
  '2:1': { jockey: 'B. Kowalski', trainer: 'S. & J. Templeton' },
  '2:7': { jockey: 'A. Petrakis', trainer: 'Gordon Fairlie' },
  '2:8': { jockey: 'R. Tuilagi', trainer: 'Yusuf Rahimi' },
  '3:2': { jockey: 'T. Marchetti', trainer: 'Linda Okafor' },
  '3:6': { jockey: 'S. Fairweather', trainer: 'Harriet Vane-Stokes' },
  '4:9': { trainer: 'Ruben Delgado' },
  '4:17': { jockey: 'J. Pham', trainer: 'Nick Thackeray' },
  '5:4': { jockey: 'T. Marchetti', trainer: 'Declan Murtagh' },
  '6:1': { jockey: 'D. Oyelaran', trainer: 'Harriet Vane-Stokes' },
  '7:1': { jockey: 'M. Brannigan', trainer: 'Fiona Macquarie' },
  '7:3': { trainer: 'Tony Barrasso' },
  '9:1': { jockey: 'B. Kowalski', trainer: 'Linda Okafor' },
  '9:2': { jockey: 'J. Nakamura-Reid', trainer: 'Ingrid Solberg', country: 'NZ' },
  '9:7': { jockey: 'E. Sorensen', trainer: "Megan O'Driscoll" },
  '8:1': { trainer: 'Bianca Moretti' },
  '8:12': { jockey: 'G. McAllister', trainer: 'Colin & Dana Kirkwood' },
};

// ---------------------------------------------------------------------------
// Helpers for form generation
// ---------------------------------------------------------------------------
function trackCond() {
  const rating = weighted([[3, 2], [4, 5], [5, 2], [6, 1.5], [7, 1], [8, 0.6], [9, 0.3]]);
  const label = rating <= 4 ? 'Good' : rating <= 7 ? 'Soft' : 'Heavy';
  return { trackCondition: `${label} ${rating}`, trackRating: rating };
}
function raceTime(distance, rating) {
  // Rough AU metropolitan standard: ~57.6s per 1000m on Good 4, +6.1s per extra 100m, slower on wet tracks.
  const base = 57.6 + ((distance - 1000) / 100) * 6.1;
  const wet = Math.max(0, rating - 4) * 0.25 * (distance / 1000);
  const secs = base + wet + (rng() - 0.5) * 1.2;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function sectional(rating) {
  return (33.4 + Math.max(0, rating - 4) * 0.35 + rng() * 2.2).toFixed(2);
}
function inRunningFor(speed, starters) {
  const cap = (n) => Math.max(1, Math.min(starters, n));
  let s;
  if (speed === 'leader') s = [1, 1, chance(0.8) ? 1 : 2];
  else if (speed === 'on-pace') s = [rint(2, 4), rint(2, 4), rint(1, 3)];
  else if (speed === 'midfield') s = [rint(5, 8), rint(5, 8), rint(3, 7)];
  else s = [rint(9, 14), rint(9, 14), rint(6, 12)];
  return s.map(cap).join('-');
}
function positionFor(quality) {
  const r = rng();
  if (r < 0.14 + 0.26 * quality) return 1;
  if (r < 0.30 + 0.32 * quality) return rint(2, 3);
  if (r < 0.55 + 0.25 * quality) return rint(4, 6);
  return rint(7, 14);
}
function commentFor(pos, speed, margin) {
  const winBy = {
    leader: ['Led throughout and kicked clear', 'Dictated from the front, too strong late', 'Bounced to the lead and was never headed'],
    'on-pace': ['Sat outside the leader, took over at the 300m and held on', 'Trailed the speed, pounced at the 200m', 'Raced handy, dashed clear on straightening'],
    midfield: ['Settled midfield, peeled out at the 400m and ran over them', 'Midfield, angled out at the 300m and sprinted sharply', 'Travelled sweetly behind the pace and finished too well'],
    backmarker: ['Last to turn, brilliant turn of foot to win going away', 'Got back, swept around the field and won easing down', 'Rearward early, came widest and strongest'],
  };
  if (pos === 1) return pick(winBy[speed] || winBy.midfield);
  if (pos <= 3 && margin < 1.5) {
    if (speed === 'leader') return pick(['Led, headed late, fought back for a placing', 'Set a solid tempo, just run down in the last 50m']);
    if (speed === 'backmarker') return pick(['Hit the line hard from the rear, run short of room at the 300m', 'Last at the 600m, flew home for a placing']);
    return pick(['Every chance, just held out', 'Honest effort from a wide gate', 'Checked at the 600m then ran on strongly', 'Peaked on run in final 50m']);
  }
  if (pos <= 6) {
    if (speed === 'leader') return pick(['Led, weakened in the last 100m', 'Keen early in front and did not finish off']);
    return pick(['Settled back, made ground without threatening', 'Raced three wide without cover, battled on', 'Flattened out over the last 100m', 'Boxed in on the fence until the 200m', 'Fair effort first-up, should improve']);
  }
  if (speed === 'leader') return pick(['Raced too keenly in front and dropped out', 'Over-raced in the lead and stopped badly']);
  return pick(['Never a factor after being held up at a vital stage', 'Lost a plate during the running', 'Slow away and could not make ground on the heavy track', 'Disappointing, trainer to seek a vet report', 'Got back and plodded', 'Wide the trip, weakened']);
}
function spFor(quality) {
  const base = 2.2 + (1 - quality) * 18;
  const p = base * (0.6 + rng() * 0.9);
  return roundPrice(Math.max(1.6, p));
}
function roundPrice(p) {
  if (p < 2) return r2(Math.round(p / 0.05) * 0.05);
  if (p < 4) return r1(Math.round(p / 0.1) * 0.1);
  if (p < 10) return r1(Math.round(p / 0.5) * 0.5);
  if (p < 20) return Math.round(p);
  if (p < 60) return Math.round((p - 1) / 5) * 5 + 1; // 21, 26, 31 ...
  return Math.min(101, Math.round((p - 1) / 10) * 10 + 1);
}
function placePrice(win) {
  const p = 1 + (win - 1) * 0.28;
  return win < 1.6 ? 1.1 : r2(Math.round(p / 0.05) * 0.05);
}
function pastClass(tier, age) {
  if (tier === '2yo') return pick(['2yo SW', '2yo Hcp', '2yo Mdn', 'Listed 2yo']);
  if (age === 3) return pick(['3yo Hcp', '3yo SW', 'Mdn', 'BM64', 'Listed', 'Group 3', 'Class 1']);
  if (tier === 'bm') return pick(['BM64', 'BM70', 'BM78', 'BM84', 'Class 2', 'Mdn', 'BM90']);
  if (tier === 'open') return pick(['BM78', 'BM84', 'BM90', 'Open Hcp', 'Listed']);
  if (tier === 'g1') return pick(['Group 1', 'Group 2', 'Group 3', 'Listed', 'Open Hcp']);
  return pick(['Group 2', 'Group 3', 'Listed', 'Open Hcp', 'BM90']);
}
function prizeFor(cls) {
  if (/Group 1/.test(cls)) return 1000000;
  if (/Group 2/.test(cls)) return 300000;
  if (/Group 3|Listed/.test(cls)) return 160000;
  if (/Open|BM9/.test(cls)) return 130000;
  if (/Trial/.test(cls)) return 0;
  return weighted([[50000, 2], [80000, 1], [35000, 2], [27000, 1]]);
}
function pickVenue(tier, country) {
  if (tier === '2yo') return pick(VENUES_2YO);
  if (country === 'NZ' && chance(0.5)) return pick(VENUES_NZ);
  return weighted([[pick(VENUES_METRO), 6], [pick(VENUES_PROV), 2.5], [pick(VENUES_INTERSTATE), 1.5]]);
}
function formDistance(todayDistance) {
  const step = weighted([[0, 3], [-200, 2], [-100, 2], [100, 2], [200, 1.5], [-400, 1], [400, 0.7]]);
  return Math.max(1000, Math.min(3200, todayDistance + step));
}
function stats0() {
  return { starts: 0, wins: 0, seconds: 0, thirds: 0 };
}
function bump(stat, pos) {
  stat.starts++;
  if (pos === 1) stat.wins++;
  else if (pos === 2) stat.seconds++;
  else if (pos === 3) stat.thirds++;
}
function withPrize(stat, perStart) {
  if (stat.starts === 0) return undefined;
  return { ...stat, prizeMoney: Math.round(stat.wins * perStart * 6 + stat.seconds * perStart * 2 + stat.thirds * perStart + stat.starts * perStart * 0.4) };
}

/** Weight allocation for a race. */
function weightsFor(race, runners) {
  if (race.weights === 'handicap') {
    const n = runners.length;
    const out = [];
    let w = race.top;
    for (let i = 0; i < n; i++) {
      out.push(w);
      const drop = i < 2 ? 0.5 : weighted([[0, 1], [0.5, 4], [1, 1.5]]);
      w = Math.max(race.bottom, r1(w - drop));
    }
    return out;
  }
  if (race.weights === 'sw2yo') return runners.map((r) => (r.sex === 'filly' ? 55 : 57));
  if (race.weights === 'sw3yoF') return runners.map((_, i) => (i === 1 ? 57.5 : i === 5 ? 57 : i === 10 ? 57 : 56));
  // WFA
  return runners.map((r) => {
    const female = r.sex === 'mare' || r.sex === 'filly';
    if (r.age === 3) return female ? 53 : 55;
    return female ? 57 : 59;
  });
}

function sexFor(race, name) {
  if (race.weights === 'sw3yoF') return 'filly';
  if (race.tier === '2yo') return /Miss|Sprite|Wren|Velvet/.test(name) ? 'filly' : 'colt';
  const fem = /Lucy|Sue|Bess|Fiona|Rue|Lady|Miss|Elegance|Breeze|Lyric|Mist|Serenade|Gazette|Symphony/.test(name);
  if (fem) return weighted([['mare', 5], ['filly', 1]]);
  return weighted([['gelding', 6], ['horse', 1.5], ['entire', 0.5]]);
}
function ageFor(race, sex) {
  if (race.tier === '2yo') return 2;
  if (race.weights === 'sw3yoF') return 3;
  if (sex === 'filly') return 3;
  if (race.tier === 'g1') return weighted([[3, 1], [4, 4], [5, 4], [6, 2]]);
  return weighted([[3, 1], [4, 4], [5, 4], [6, 3], [7, 1.5], [8, 0.5]]);
}

// ---------------------------------------------------------------------------
// Runner generation
// ---------------------------------------------------------------------------
function buildRunners(race) {
  const n = race.names.length;
  const scratchedSet = new Set(race.scratched || []);
  const emergencySet = new Set(race.emergency || []);

  // Barriers: forced first, then a shuffle of what is left.
  const forcedB = race.forcedBarrier || {};
  const freeBarriers = shuffle([...Array(n).keys()].map((i) => i + 1).filter((b) => !Object.values(forcedB).includes(b)));
  // Jockeys unique within a race.
  const usedJ = new Set();
  for (let i = 1; i <= n; i++) {
    const f = FORCED[`${race.number}:${i}`];
    if (f?.jockey) usedJ.add(f.jockey);
  }
  const freeJ = shuffle(JOCKEYS.filter((j) => !usedJ.has(j)));

  const runners = [];
  let leaders = 0;
  for (let i = 1; i <= n; i++) {
    const name = race.names[i - 1];
    const f = FORCED[`${race.number}:${i}`] || {};
    const sex = sexFor(race, name);
    const age = ageFor(race, sex);
    const country = f.country || (chance(0.04) ? 'NZ' : 'AUS');
    const jockey = f.jockey || freeJ.pop();
    const trainer = f.trainer || pick(TRAINERS);
    const barrier = forcedB[i] ?? freeBarriers.pop();
    let speed = (race.forcedSpeed || {})[i];
    if (!speed) {
      speed = weighted([['leader', leaders === 0 ? 1.5 : 0.4], ['on-pace', 3], ['midfield', 4], ['backmarker', 2.2]]);
    }
    if (speed === 'leader') leaders++;

    // Ratings: tier base + noise; forced top/mid for the result script.
    const base = { '2yo': 76, bm: 84, open: 90, group: 94, g1: 102 }[race.tier];
    let rating = base + rint(-9, 9);
    const fr = (race.forcedRating || {})[i];
    if (fr === 'top') rating = base + 9;
    if (fr === 'mid') rating = base + 3;
    const quality = Math.max(0, Math.min(1, (rating - (base - 10)) / 24));

    runners.push({ number: i, name, barrier, jockey, trainer, sex, age, country, speed, rating, quality, scratched: scratchedSet.has(i), emergency: emergencySet.has(i) });
  }
  // Make sure nobody else ties the forced top rating.
  const forcedTop = Object.entries(race.forcedRating || {}).filter(([, v]) => v === 'top').map(([k]) => Number(k));
  for (const t of forcedTop) {
    const top = runners.find((r) => r.number === t);
    for (const r of runners) if (r !== top && r.rating > top.rating - 5) r.rating = top.rating - 5 - rint(0, 3);
  }
  // And that the forced "mid" runner really is mid-market (rank 3-5).
  const forcedMid = Object.entries(race.forcedRating || {}).filter(([, v]) => v === 'mid').map(([k]) => Number(k));
  for (const m of forcedMid) {
    const mid = runners.find((r) => r.number === m);
    const better = runners.filter((r) => r !== mid && r.rating > mid.rating).sort((a, b) => b.rating - a.rating);
    // Keep exactly 3 runners above the mid runner.
    better.slice(3).forEach((r) => (r.rating = mid.rating - rint(1, 6)));
    if (better.length < 3) {
      const cands = runners.filter((r) => r !== mid && !forcedTop.includes(r.number) && r.rating <= mid.rating).slice(0, 3 - better.length);
      cands.forEach((r) => (r.rating = mid.rating + rint(1, 3)));
    }
  }

  // Weights by number order (handicaps descending).
  const weights = weightsFor(race, runners);
  runners.forEach((r, i) => (r.weight = weights[i]));

  // Form, career, splits, odds.
  const ratings = runners.map((r) => r.rating);
  const market = marketFromRatings(ratings, runners.map((r) => r.scratched));
  runners.forEach((r, i) => Object.assign(r, formFor(race, r), oddsFor(r, market[i], race)));

  return runners.map(finaliseRunner);
}

function formFor(race, r) {
  const count = race.tier === '2yo' ? rint(5, 6) : rint(5, 10);
  const firstUpToday = race.tier !== '2yo' && chance(0.18);
  let daysSince = firstUpToday ? rint(90, 200) : rint(7, 42);
  if (race.tier === '2yo') daysSince = rint(12, 30);
  let date = addDays(DATE, -daysSince);
  const lines = [];
  const trialCount = race.tier === '2yo' ? rint(2, 3) : 0;
  for (let k = 0; k < count; k++) {
    const isTrial = race.tier === '2yo' && k >= count - trialCount;
    const { trackCondition, trackRating } = trackCond();
    const starters = isTrial ? rint(6, 10) : rint(7, 16);
    let pos = isTrial ? rint(1, 6) : positionFor(r.quality);
    pos = Math.min(pos, starters);
    const margin = pos === 1 ? 0 : r1(0.2 * (pos - 1) + rng() * 1.3 * (pos - 1));
    const distance = isTrial ? pick([800, 900, 1000]) : race.tier === '2yo' ? pick([1000, 1000, 1100, 1200]) : formDistance(race.distance);
    const venue = isTrial ? pick(['Cranbourne', 'Flemington', 'Pakenham']) : pickVenue(race.tier, r.country);
    const raceClass = isTrial ? 'Barrier Trial' : pastClass(race.tier, r.age);
    const line = {
      date,
      venue,
      distance,
      trackCondition,
      trackRating,
      position: pos,
      starters,
      margin,
      weight: isTrial ? undefined : r1(r.weight + weighted([[0, 3], [-1, 2], [1, 2], [-2, 1], [2, 1], [-0.5, 1], [0.5, 1]])),
      barrier: rint(1, starters),
      jockey: chance(0.6) ? r.jockey : pick(JOCKEYS),
      raceClass,
      prize: prizeFor(raceClass),
      startingPrice: isTrial ? undefined : spFor(r.quality),
      time: raceTime(distance, trackRating),
      sectional600: sectional(trackRating),
      winner: pos === 1 ? undefined : pick(OTHER_HORSES),
      second: pos === 1 ? pick(OTHER_HORSES) : undefined,
      inRunning: inRunningFor(r.speed, starters),
      comment: isTrial ? pick(['Official trial, not fully tested', 'Trialled quietly, never asked for an effort', 'Jumped well in trial and travelled nicely', 'Green in the trial but finished off well']) : commentFor(pos, r.speed, margin),
    };
    if (line.weight === undefined) delete line.weight;
    if (line.startingPrice === undefined) delete line.startingPrice;
    if (line.winner === undefined) delete line.winner;
    if (line.second === undefined) delete line.second;
    lines.push(line);
    // Gap to the previous (earlier) start, with occasional spell.
    const spell = race.tier === '2yo' ? (k === count - trialCount - 1 ? rint(20, 45) : 0) : chance(0.15) ? rint(70, 160) : 0;
    date = addDays(date, -(spell || rint(10, 35)));
  }
  lines.sort((a, b) => (a.date < b.date ? -1 : 1)); // oldest first
  const raceLines = lines.filter((l) => l.raceClass !== 'Barrier Trial');

  // last5 built from the most recent 5 *race* lines, with x for spells (>60 days).
  const recent = raceLines.slice(-5);
  let last5 = '';
  for (let i = 0; i < recent.length; i++) {
    if (i > 0 && daysBetween(recent[i - 1].date, recent[i].date) > 60) last5 += 'x';
    last5 += recent[i].position >= 10 ? '0' : String(recent[i].position);
  }
  if (daysSince > 60) last5 += 'x';

  // Career & splits derived from the visible race lines, plus some unseen starts.
  const career = stats0();
  const splits = { track: stats0(), distance: stats0(), trackDistance: stats0(), good: stats0(), soft: stats0(), heavy: stats0(), firstUp: stats0(), secondUp: stats0(), jockey: stats0() };
  raceLines.forEach((l, i) => {
    bump(career, l.position);
    if (l.venue === VENUE) bump(splits.track, l.position);
    if (Math.abs(l.distance - race.distance) <= 50) bump(splits.distance, l.position);
    if (l.venue === VENUE && Math.abs(l.distance - race.distance) <= 50) bump(splits.trackDistance, l.position);
    if (l.trackRating <= 4) bump(splits.good, l.position);
    else if (l.trackRating <= 7) bump(splits.soft, l.position);
    else bump(splits.heavy, l.position);
    const prev = raceLines[i - 1];
    const prev2 = raceLines[i - 2];
    const afterSpell = i === 0 || daysBetween(prev.date, l.date) > 60;
    if (afterSpell) bump(splits.firstUp, l.position);
    else if (i >= 1 && (i === 1 || daysBetween(prev2.date, prev.date) > 60)) bump(splits.secondUp, l.position);
    if (l.jockey === r.jockey) bump(splits.jockey, l.position);
  });
  const extra = race.tier === '2yo' ? 0 : rint(0, 14);
  for (let k = 0; k < extra; k++) {
    const pos = positionFor(r.quality);
    bump(career, pos);
  }
  const perStart = { '2yo': 9000, bm: 6000, open: 9000, group: 14000, g1: 25000 }[race.tier];
  const splitsOut = {};
  for (const [k, v] of Object.entries(splits)) {
    const s = withPrize(v, perStart);
    if (s) splitsOut[k] = s;
  }

  const gearChanges = chance(0.16) ? [pick(GEAR)] : undefined;
  const lastLine = raceLines[raceLines.length - 1];
  const comment = runnerComment(r, race, lastLine, daysSince);

  return {
    form: lines,
    last5,
    daysSinceLastRun: daysSince,
    career: withPrize(career, perStart),
    splits: splitsOut,
    gearChanges,
    comment,
    ratings: { demoRating: r.rating, speedRating: r.rating + rint(-4, 6), classRating: r.rating + rint(-6, 3) },
  };
}

function runnerComment(r, race, last, daysSince) {
  const gate = r.barrier <= 4 ? 'from the inside gate' : r.barrier >= race.names.length - 3 ? 'from the wide gate' : 'from a middle draw';
  const map = { leader: 'should find the front', 'on-pace': 'will settle on the speed', midfield: 'maps midfield', backmarker: 'will get back and need luck' }[r.speed];
  const lastBit = !last ? 'Untested at race level.' : last.position === 1 ? `Won last start at ${last.venue} and ${daysSince > 60 ? 'resumes' : 'can go on with it'}.` : last.position <= 3 ? `Placed last start at ${last.venue}; ${daysSince > 60 ? 'first-up today' : 'fitter for the run'}.` : `Beaten ${last.margin}L at ${last.venue} last time; ${daysSince > 60 ? 'resuming from a spell' : 'needs to lift'}.`;
  return `${map.charAt(0).toUpperCase() + map.slice(1)} ${gate}. ${lastBit}`;
}

// ---------------------------------------------------------------------------
// Market / odds
// ---------------------------------------------------------------------------
function marketFromRatings(ratings, scratched) {
  const live = ratings.map((r, i) => (scratched[i] ? null : r));
  const max = Math.max(...live.filter((v) => v !== null));
  const k = 0.115;
  const raw = live.map((r) => (r === null ? 0 : Math.exp(k * (r - max))));
  const sum = raw.reduce((a, b) => a + b, 0);
  const overround = 1.16 + ratings.length * 0.004;
  return raw.map((w) => (w === 0 ? null : 1 / ((w / sum) * overround)));
}
function oddsFor(r, basePrice, race) {
  if (basePrice === null || r.scratched) return { odds: {} };
  const base = Math.max(1.5, basePrice);
  // Market move shared by all bookmakers: <1 = firmed from opening, >1 = drifted.
  const move = weighted([[0.82, 1], [0.9, 2], [1, 4], [1.1, 2], [1.22, 1], [1.35, 0.5]]);
  const mk = (mult, jitter, openingTimes, type) => {
    const win = roundPrice(base * mult);
    const opening = roundPrice(Math.max(1.5, win / move * (1 + jitter)));
    const steps = openingTimes.length;
    const flucs = openingTimes.map((at, i) => {
      const t = i / (steps - 1);
      const p = opening + (win - opening) * t + (i > 0 && i < steps - 1 ? (rng() - 0.5) * 0.08 * win : 0);
      return { price: i === steps - 1 ? win : roundPrice(Math.max(1.5, p)), at };
    });
    const out = { win, place: placePrice(win), opening, flucs };
    if (type) out.type = type;
    return out;
  };
  const alphaTimes = [localIso('2026-10-21', '17:00'), localIso('2026-10-23', '09:00'), localIso('2026-10-24', '08:00'), localIso('2026-10-24', '11:30')];
  const bravoTimes = [localIso('2026-10-21', '18:30'), localIso('2026-10-22', '20:00'), localIso('2026-10-23', '19:00'), localIso('2026-10-24', '11:45')];
  const toteTimes = [localIso('2026-10-24', '09:00'), localIso('2026-10-24', '11:00'), localIso('2026-10-24', '11:40')];
  const alpha = mk(1 + (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.05, alphaTimes);
  const bravo = mk(1 + (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.05, bravoTimes);
  const tote = mk(1 + (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.08, toteTimes);
  return { odds: { tote, alpha, bravo } };
}

function finaliseRunner(r) {
  const out = {
    number: r.number,
    name: r.name,
    barrier: r.barrier,
    jockey: r.jockey,
    trainer: r.trainer,
    weight: r.weight,
  };
  if (APPRENTICE_CLAIM[r.jockey]) out.claim = APPRENTICE_CLAIM[r.jockey];
  if (r.scratched) out.scratched = true;
  if (r.emergency) out.emergency = true;
  Object.assign(out, {
    age: r.age,
    sex: r.sex,
    colour: pick(COLOURS),
    sire: pick(SIRES),
    dam: pick(DAMS),
    damSire: pick(DAM_SIRES),
    country: r.country,
    last5: r.last5,
    career: r.career,
    splits: r.splits,
    daysSinceLastRun: r.daysSinceLastRun,
    speedMapPosition: r.speed,
    ratings: r.ratings,
    comment: r.comment,
    form: r.form,
    odds: r.odds,
  });
  if (r.gearChanges) out.gearChanges = r.gearChanges;
  return out;
}

// ---------------------------------------------------------------------------
// Build the pack
// ---------------------------------------------------------------------------
const races = RACES.map((rc) => {
  const runners = buildRunners(rc);
  const race = {
    number: rc.number,
    name: rc.name,
    distance: rc.distance,
    startTime: localIso(DATE, rc.time),
    raceClass: rc.raceClass,
    prize: rc.prize,
    ageRestriction: rc.ageRestriction,
    trackCondition: 'Good 4',
    trackRating: 4,
    runners,
  };
  if (rc.group) race.group = rc.group;
  if (rc.sexRestriction) race.sexRestriction = rc.sexRestriction;
  return race;
});

const byNo = (raceNo, no) => races[raceNo - 1].runners.find((r) => r.number === no);

// Deliberate cross-source disagreements. Values are written out explicitly so the
// test suite (and reviewers) can see exactly what differs.
const r1b5 = byNo(1, 5).barrier;
const variants = {
  'demo-form': {
    note: 'Older jockey booking, 0.5kg weight discrepancy, two name spellings, and one scratching not yet applied.',
    runnerOverrides: [
      { race: 5, number: 4, field: 'jockey', value: 'C. Whitlam', official: byNo(5, 4).jockey, note: 'older booking, replaced race-week' },
      { race: 2, number: 7, field: 'weight', value: r1(byNo(2, 7).weight + 0.5), official: byNo(2, 7).weight, note: '0.5kg discrepancy' },
      { race: 3, number: 6, field: 'name', value: 'Nellies Lantern', official: byNo(3, 6).name, note: 'apostrophe dropped' },
      { race: 9, number: 2, field: 'name', value: 'Tauranga Mist (NZ)', official: byNo(9, 2).name, note: 'country suffix' },
      { race: 7, number: 3, field: 'scratched', value: false, official: true, note: 'scratching not yet applied by this source' },
    ],
  },
  'demo-odds-a': { note: 'Prices only differ slightly from demo-odds-b; no structural disagreements.', runnerOverrides: [] },
  'demo-odds-b': {
    note: 'One barrier typo and one runner missing from the market.',
    runnerOverrides: [
      { race: 1, number: 5, field: 'barrier', value: r1b5 === 10 ? 1 : r1b5 + 1 === 10 ? 1 : r1b5 + 1, official: r1b5, note: 'barrier typo (collides with another runner)' },
    ],
    omitRunners: [{ race: 8, number: 12, name: byNo(8, 12).name, note: 'runner missing from this market' }],
  },
};
// Sanity: the typo must collide with a real barrier of another runner so reconciliation notices.
{
  const typo = variants['demo-odds-b'].runnerOverrides[0].value;
  if (!races[0].runners.some((r) => r.number !== 5 && r.barrier === typo)) throw new Error('barrier typo does not collide');
}

const pack = {
  _comment: 'FICTIONAL demo meeting generated by fixtures/demo/generate-pack.mjs. All horses, people and prices are invented.',
  meeting: {
    id: MEETING_ID,
    date: DATE,
    venue: VENUE,
    venueSlug: VENUE_SLUG,
    state: 'VIC',
    country: 'AUS',
    raceType: 'thoroughbred',
    raceCount: races.length,
    trackCondition: 'Good 4',
    trackRating: 4,
    weather: 'Fine',
    rail: '+3m entire',
    firstRaceTime: races[0].startTime,
  },
  races,
  variants,
};

// ---------------------------------------------------------------------------
// Results for races 1–3: on-pace + inside-barrier bias, favourites 2/3.
// ---------------------------------------------------------------------------
function favourite(raceNo) {
  const rs = races[raceNo - 1].runners.filter((r) => !r.scratched && r.odds.alpha);
  return rs.reduce((best, r) => (r.odds.alpha.win < best.odds.alpha.win ? r : best), rs[0]);
}
const RESULTS = [
  {
    raceNumber: 1, finishingOrder: [6, 2, 9, 1, 4, 8, 3, 10, 7, 5], margins: [0, 1.0, 1.8, 2.4], time: '0:57.92',
    inRunning: { 6: '1-1-1', 2: '2-2-2', 9: '6-6-4', 1: '4-4-5' },
    sectional600: '33.62',
    note: 'Favourite led throughout from barrier 3; runner-up sat second from barrier 1.',
  },
  {
    raceNumber: 2, finishingOrder: [8, 3, 1, 5, 10, 2, 12, 4, 6, 11, 7, 9], margins: [0, 0.5, 0.8, 2.3], time: '1:23.41',
    inRunning: { 8: '2-2-1', 3: '1-1-2', 1: '11-11-8', 5: '5-5-4' },
    sectional600: '34.08',
    note: 'Winner sat outside the leader from barrier 4; leader (barrier 2) held second; favourite ran on from last off a wide gate for third.',
  },
  {
    raceNumber: 3, finishingOrder: [2, 11, 6, 4, 13, 1, 8, 3, 10, 14, 5, 12, 7, 9], margins: [0, 0.75, 2.0, 2.3], time: '1:09.66',
    inRunning: { 2: '2-2-1', 11: '1-1-2', 6: '7-7-5', 4: '3-3-3' },
    sectional600: '33.91',
    note: 'Favourite trailed the leader from barrier 5 and took over at the 200m; leader from barrier 1 held second.',
  },
];
for (const res of RESULTS) {
  const race = races[res.raceNumber - 1];
  const live = race.runners.filter((r) => !r.scratched).map((r) => r.number).sort((a, b) => a - b);
  const order = [...res.finishingOrder].sort((a, b) => a - b);
  if (JSON.stringify(live) !== JSON.stringify(order)) throw new Error(`R${res.raceNumber} finishing order does not match the field`);
  const winner = byNo(res.raceNumber, res.finishingOrder[0]);
  if (winner.barrier > 5) throw new Error(`R${res.raceNumber} winner not drawn 1-5`);
  if (!['leader', 'on-pace'].includes(winner.speedMapPosition)) throw new Error(`R${res.raceNumber} winner not on pace`);
  const fav = favourite(res.raceNumber);
  const favWon = fav.number === winner.number;
  if ((res.raceNumber === 2) === favWon) throw new Error(`R${res.raceNumber} favourite rule violated (fav #${fav.number})`);
  // Every bookmaker must agree on the favourite.
  for (const b of ['alpha', 'bravo', 'tote']) {
    const rs = race.runners.filter((r) => !r.scratched);
    const f = rs.reduce((best, r) => (r.odds[b].win < best.odds[b].win ? r : best), rs[0]);
    if (f.number !== fav.number) throw new Error(`R${res.raceNumber} bookmaker ${b} disagrees on favourite`);
  }
  // Dividends follow the tote prices of the placegetters so results and odds agree.
  const [w, s2, t3, f4] = res.finishingOrder.slice(0, 4).map((n) => byNo(res.raceNumber, n).odds.tote);
  const quinella = r1((w.win * s2.win) / 2.3);
  const exacta = r1(quinella * 1.9);
  const trifecta = r1(exacta * t3.win * 0.95);
  res.dividends = { win: w.win, place: w.place, quinella, exacta, trifecta, first4: r1(trifecta * f4.win * 0.8) };
  res.winnerBarrier = winner.barrier;
  res.winnerSpeedMapPosition = winner.speedMapPosition;
  res.favouriteNumber = fav.number;
  res.favouriteWon = favWon;
  res.winnerName = winner.name;
  res.placings = res.finishingOrder.slice(0, 4).map((n) => [n]);
}
const resultsOut = {
  _comment: 'Results for the first three races of the FICTIONAL demo meeting. margins[i] = lengths behind the winner for placings[i]. finishingOrder is the complete order; placings are the first four.',
  meetingId: MEETING_ID,
  results: RESULTS.map((r) => ({
    raceNumber: r.raceNumber,
    placings: r.placings,
    finishingOrder: r.finishingOrder,
    margins: r.margins,
    time: r.time,
    sectional600: r.sectional600,
    dividends: r.dividends,
    inRunning: r.inRunning,
    winnerName: r.winnerName,
    winnerBarrier: r.winnerBarrier,
    winnerSpeedMapPosition: r.winnerSpeedMapPosition,
    favouriteNumber: r.favouriteNumber,
    favouriteWon: r.favouriteWon,
    note: r.note,
  })),
};

// ---------------------------------------------------------------------------
// Weather: Open-Meteo-like hourly series for 2026-10-21..24
// ---------------------------------------------------------------------------
function buildWeather() {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
  const time = [];
  const temperature_2m = [];
  const precipitation = [];
  const precipitation_probability = [];
  const wind_speed_10m = [];
  const wind_direction_10m = [];
  const relative_humidity_2m = [];
  const weather_code = [];
  const wrng = mulberry32(777);
  const profile = {
    '2026-10-21': { min: 10.2, max: 19.4, windBase: 14, dir: 200, rain: () => 0 },
    '2026-10-22': { min: 11.8, max: 16.1, windBase: 22, dir: 225, rain: (h) => (h >= 6 && h <= 14 ? [0.4, 0.8, 1.2, 1.4, 1.0, 0.9, 0.6, 0.5, 0.3][h - 6] : h === 15 ? 0.3 : 0) },
    '2026-10-23': { min: 9.6, max: 18.7, windBase: 18, dir: 240, rain: () => 0 },
    '2026-10-24': { min: 10.4, max: 21.6, windBase: 16, dir: 20, rain: () => 0 },
  };
  for (const d of days) {
    const p = profile[d];
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      // Diurnal temperature curve peaking ~15:00.
      const phase = Math.cos(((h - 15) / 24) * 2 * Math.PI);
      const t = p.min + (p.max - p.min) * (0.5 + 0.5 * phase);
      temperature_2m.push(r1(t + (wrng() - 0.5) * 0.6));
      const rain = p.rain(h);
      precipitation.push(r1(rain));
      precipitation_probability.push(rain > 0 ? Math.min(95, 55 + Math.round(rain * 25)) : d === '2026-10-22' ? 30 : d === '2026-10-24' ? (h > 18 ? 15 : 5) : 8);
      const gust = p.windBase + 8 * Math.max(0, Math.sin(((h - 9) / 24) * 2 * Math.PI)) + (wrng() - 0.5) * 6;
      wind_speed_10m.push(r1(Math.max(3, gust)));
      wind_direction_10m.push(Math.round((p.dir + (wrng() - 0.5) * 40 + 360) % 360));
      relative_humidity_2m.push(Math.round(rain > 0 ? 82 + wrng() * 12 : 48 + 25 * (1 - 0.5 * (1 + phase)) + wrng() * 8));
      weather_code.push(rain > 1 ? 61 : rain > 0 ? 51 : d === '2026-10-22' ? 3 : h >= 7 && h <= 18 ? (d === '2026-10-24' ? 0 : 1) : 0);
    }
  }
  return {
    _comment: 'Synthetic Open-Meteo-style hourly forecast/archive for the FICTIONAL demo meeting. Light rain on 2026-10-22, fine and warming for race day.',
    latitude: -37.79,
    longitude: 144.91,
    elevation: 12,
    timezone: 'Australia/Melbourne',
    timezone_abbreviation: 'AEDT',
    utc_offset_seconds: 39600,
    venue: VENUE,
    venueSlug: VENUE_SLUG,
    hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation: 'mm', precipitation_probability: '%', wind_speed_10m: 'km/h', wind_direction_10m: '°', relative_humidity_2m: '%', weather_code: 'wmo code' },
    hourly: { time, temperature_2m, precipitation, precipitation_probability, wind_speed_10m, wind_direction_10m, relative_humidity_2m, weather_code },
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
const write = (name, data) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2) + '\n');
write('flemington-2026-10-24.json', pack);
write('results.json', resultsOut);
write('weather.json', buildWeather());

const totalRunners = races.reduce((s, r) => s + r.runners.length, 0);
console.log(`Wrote demo pack: ${races.length} races, ${totalRunners} runners, ${RESULTS.length} results, 96 weather hours`);
for (const res of resultsOut.results) {
  console.log(`  R${res.raceNumber}: won by #${res.placings[0][0]} ${res.winnerName} (barrier ${res.winnerBarrier}, ${res.winnerSpeedMapPosition}, in-running ${res.inRunning[res.placings[0][0]]}) fav #${res.favouriteNumber} ${res.favouriteWon ? 'won' : 'beaten'}`);
}
for (const [src, v] of Object.entries(variants)) {
  for (const o of v.runnerOverrides) console.log(`  ${src}: R${o.race} #${o.number} ${o.field} ${JSON.stringify(o.official)} -> ${JSON.stringify(o.value)}`);
  for (const o of v.omitRunners || []) console.log(`  ${src}: R${o.race} #${o.number} ${o.name} omitted`);
}
