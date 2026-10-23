/**
 * Domain knowledge tables. These are priors, not facts about today's race:
 * they nudge scores when a source does not supply hard statistics. Tiers are
 * reviewed against the research notes in research/modelknowledge.md.
 */

import { normalisePerson, personKeys } from '../../shared/util.js';

export type Tier = 'A' | 'B' | 'C';

/** Leading Australian jockeys (approximate metropolitan strike-rate tiers, 2024-26). */
const JOCKEY_TIERS: Record<Tier, string[]> = {
  A: [
    'James McDonald', 'Damian Lane', 'Blake Shinn', 'Craig Williams', 'Mark Zahra', 'Jamie Melham', 'Jamie Kah',
    'Nash Rawiller', 'Zac Lloyd', 'Tommy Berry', 'Kerrin McEvoy', 'Ben Melham', 'Ethan Brown', 'Jye McNeil',
    'William Pike', 'Tim Clark', 'Jason Collett', 'Hugh Bowman', 'Ryan Maloney', 'Michael Dee', 'Ben Thompson',
  ],
  B: [
    'Daniel Moor', 'Harry Coffey', 'Billy Egan', 'Luke Nolen', 'John Allen', 'Declan Bates', 'Celine Gaudray',
    'Beau Mertens', 'Chad Schofield', 'Adam Hyeronimus', 'Dylan Gibbons', 'Rachel King', 'Regan Bayliss',
    'Carleen Hefel', 'Teodore Nugent', 'Tom Sherry', 'James Orman', 'Jim Byrne', 'Michael Rodd',
    'Luke Cartwright', 'Logan Bates', 'Siena Grima', 'Braith Nock', 'Jace McMurray', 'Jordan Childs',
    'Chris Parnham', 'Brad Rawiller', 'Josh Parr', 'Craig Newitt', 'Damien Thornton',
    'Thomas Stockdale', 'Blaike McDougall', 'Linda Meech', 'Dean Yendall', 'Patrick Moloney', 'Ben Allen',
    'Jamie Mott', 'Lachlan King', 'Tyler Schiller', 'Reece Jones', 'Jay Ford', 'Andrew Mallyon', 'Robbie Dolan',
    'Joao Moreira', 'Zac Purton', 'Ryan Moore', 'Oisin Murphy', 'Kyle Wilson-Taylor', 'Dylan Browne McMonagle',
  ],
  C: [],
};

/** Leading Australian trainers (approximate tiers, 2024-26). */
export const TRAINER_TIERS: Record<Tier, string[]> = {
  A: [
    'Chris Waller', 'Ciaron Maher', 'Anthony & Sam Freedman', 'Anthony and Sam Freedman', 'Gai Waterhouse & Adrian Bott',
    'Gai Waterhouse and Adrian Bott', 'James Cummings', 'Annabel Neasham & Rob Archibald', 'Annabel Neasham',
    'Ben, Will & JD Hayes', 'Ben Will & JD Hayes', 'Lindsay Park', 'Mick Price & Michael Kent Jnr', 'Mick Price & Michael Kent (Jnr)',
    'Peter & Paul Snowden', 'Peter and Paul Snowden', 'Bjorn Baker', 'Tony Gollan', 'Danny O\'Brien', 'Te Akau',
    'Mark Walker', 'Joseph Pride', 'Michael, Wayne & John Hawkes', 'John O\'Shea', 'Kris Lees',
  ],
  B: [
    'Matthew Smith', 'Tony & Calvin McEvoy', 'Phillip Stokes', 'Mitchell Freedman', 'Grahame Begg', 'Mark Newnham',
    'Richard & Michael Freedman', 'Chris Munce', 'Robert Heathcote', 'Andrew Forsman', 'Jamie Richards', 'Matt Laurie',
    'Patrick Payne', 'Peter Moody & Katherine Coleman', 'Trent Busuttin & Natalie Young', 'Simon Zahra', 'Nick Ryan',
    'Dan Clarken & Oopy MacGillivray', 'Will Clarken', 'Grant Williams', 'Simon Miller', 'Dan Morton', 'Neville Parnham',
    'Lindsey Smith', 'David Eustace', 'Henry Dwyer', 'Archie Alexander', 'Ben & JD Hayes', 'Michael Moroney',
    'Robbie Griffiths & Mathew de Kock', 'Clinton McDonald', 'Shea Eden', 'Aaron Purcell', 'Gary Portelli',
    'Brad Widdup', 'Jason Coyle', 'Bjorn Baker', 'Richard Litt', 'Ron Quinton', 'Les Bridge', 'Steve O\'Dea & Matt Hoysted',
    'Kelly Schweida', 'Barry Baldwin', 'Stuart Kendrick', 'Leon & Troy Corstens', 'Lloyd Kennewell & Lucy Yeomans',
  ],
  C: [],
};

function keyOf(name: string): string {
  return normalisePerson(name);
}

function buildIndex(tiers: Record<Tier, string[]>): Map<string, Tier> {
  const idx = new Map<string, Tier>();
  for (const tier of ['B', 'A'] as Tier[]) for (const n of tiers[tier]) idx.set(keyOf(n), tier);
  return idx;
}

const JOCKEY_INDEX = buildIndex(JOCKEY_TIERS);
const TRAINER_INDEX = buildIndex(TRAINER_TIERS);

/**
 * The people in a trainer name as first initial + surname, a family name
 * written once carried to the members named before it: "A & S Freedman" and
 * "Anthony & Sam Freedman" → ["a freedman", "s freedman"]; "L & T Corstens &
 * W Larkin" → ["l corstens", "t corstens", "w larkin"].
 */
function memberKeys(name: string): string[] {
  const keys = personKeys(name);
  const out = keys.map((k, i) => {
    if (k.includes(' ')) return k;
    const next = keys.slice(i + 1).find((x) => x.includes(' '));
    return next ? `${k[0]} ${next.slice(next.indexOf(' ') + 1)}` : k;
  });
  return [...new Set(out)];
}

/** Listed trainers by person key, and listed partnerships by their members (A wins over B for a name in both). */
const TRAINER_SOLO = new Map<string, Tier>();
const TRAINER_PARTNERSHIPS: Array<{ members: string[]; tier: Tier }> = [];
for (const tier of ['B', 'A'] as Tier[]) {
  for (const n of TRAINER_TIERS[tier]) {
    const members = memberKeys(n);
    if (members.length === 1) TRAINER_SOLO.set(members[0], tier);
    else if (members.length > 1) TRAINER_PARTNERSHIPS.push({ members, tier });
  }
}

const better = (a: Tier | undefined, b: Tier | undefined): Tier | undefined => (!a ? b : !b || a <= b ? a : b);

export function jockeyTier(name?: string): Tier | undefined {
  if (!name) return undefined;
  return JOCKEY_INDEX.get(keyOf(name.replace(/\(a\d*(?:\.\d)?\)/i, '')));
}

/**
 * Tier of a trainer or partnership, matched person by person on first initial
 * + surname ("C J Waller" is Chris Waller) and never on a surname alone, so an
 * unlisted "Paul Walker" gets no tier. A partnership takes the tier of the
 * listed partnership with the same people ("A & S Freedman"), else of one that
 * contains it or that it contains, else of its best-known member ("C. Maher &
 * D. Eustace" → Ciaron Maher). Undefined for a trainer not in the tables.
 */
export function trainerTier(name?: string): Tier | undefined {
  if (!name) return undefined;
  const exact = TRAINER_INDEX.get(normalisePerson(name));
  if (exact) return exact;
  const members = memberKeys(name);
  let best: Tier | undefined;
  if (members.length > 1) {
    let same: Tier | undefined;
    for (const p of TRAINER_PARTNERSHIPS) {
      const inName = p.members.every((k) => members.includes(k));
      const inEntry = members.every((k) => p.members.includes(k));
      if (inName && inEntry) same = better(same, p.tier);
      else if (inName || inEntry) best = better(best, p.tier);
    }
    if (same) return same;
  }
  for (const k of members) best = better(best, TRAINER_SOLO.get(k));
  return best;
}

export interface VenueTweak {
  /** Multiplier on the barrier effect at this venue for the distance band. */
  barrierEffect?: (distance: number) => number;
  /** Multiplier on the on-pace advantage. */
  paceEffect?: (distance: number) => number;
  notes?: string;
}

/** Venue-specific adjustments for well-known track shapes. */
export const VENUE_TWEAKS: Record<string, VenueTweak> = {
  flemington: {
    // The straight six (1000-1200m) has next to no barrier effect; the 1400m chute and the 1600m/2000m starts have a mild one.
    barrierEffect: (d) => (d <= 1200 ? 0.2 : d <= 1600 ? 0.8 : 0.6),
    paceEffect: (d) => (d <= 1200 ? 0.8 : 1.0),
    notes: 'Long straight (450m) suits strong finishers; barrier matters little in straight races.',
  },
  'moonee-valley': {
    barrierEffect: (d) => (d <= 1200 ? 1.4 : d <= 1600 ? 1.0 : d <= 2100 ? 1.2 : 0.6),
    paceEffect: () => 1.3,
    notes: 'Tight turning track with a short straight; on-pace runners and inside draws are favoured, most of all over 1000-1200m.',
  },
  caulfield: {
    // Short run to the first turn from the 1600m-2000m starts makes the draw critical; sprints have ~650m of straight running first.
    barrierEffect: (d) => (d <= 1200 ? 0.8 : d <= 2000 ? 1.3 : 0.8),
    paceEffect: () => 1.1,
    notes: 'Draw matters most from 1600m to 2000m; less in the sprints.',
  },
  sandown: { barrierEffect: () => 0.9, paceEffect: () => 1.0 },
  'sandown-hillside': { barrierEffect: () => 0.9, paceEffect: () => 1.0 },
  'sandown-lakeside': { barrierEffect: () => 0.9, paceEffect: () => 1.05 },
  // Randwick 1600m big-field handicaps: wide gates win as often as inside (Epsom/Doncaster history); long uphill straight suits backmarkers.
  randwick: { barrierEffect: (d) => (d >= 1500 && d <= 1700 ? 0.15 : d <= 1200 ? 0.7 : 0.8), paceEffect: () => 0.9, notes: 'Long uphill straight; wide draws are no handicap over the mile.' },
  rosehill: { barrierEffect: (d) => (d <= 1200 ? 1.1 : 1.0), paceEffect: () => 1.1 },
  'warwick-farm': { barrierEffect: () => 1.1, paceEffect: () => 1.15 },
  canterbury: { barrierEffect: () => 1.2, paceEffect: () => 1.25 },
  'eagle-farm': { barrierEffect: () => 0.8, paceEffect: () => 0.9 },
  doomben: { barrierEffect: () => 1.2, paceEffect: () => 1.2 },
  morphettville: { barrierEffect: () => 1.0, paceEffect: () => 1.0 },
  ascot: { barrierEffect: () => 1.0, paceEffect: () => 1.0 },
  belmont: { barrierEffect: () => 1.1, paceEffect: () => 1.15 },
  mildura: { barrierEffect: () => 1.1, paceEffect: () => 1.2, notes: 'Small turning track; leaders are hard to run down.' },
};

/** Sires with a reputation for producing wet-track performers (used only as a weak hint). */
export const WET_TRACK_SIRES = new Set(
  ['Zoustar', 'Snitzel', 'I Am Invincible', 'Written Tycoon', 'Capitalist', 'Deep Field', 'Pierro', 'So You Think', 'Savabeel', 'Tavistock', 'Ocean Park', 'Per Incanto', 'Fastnet Rock', 'Dundeel', 'Shamus Award', 'Toronado', 'Brazen Beau', 'Rubick', 'Spirit Of Boom', 'Better Than Ready'].map((s) => s.toLowerCase()),
);

/** Sires associated with stamina (2000m+). Weak hint only. */
export const STAMINA_SIRES = new Set(
  ['So You Think', 'Savabeel', 'Tavistock', 'Dundeel', 'Ocean Park', 'Camelot', 'Galileo', 'Frankel', 'Sea The Stars', 'Teofilo', 'Almanzor', 'Reliable Man', 'Fiorente', 'Americain', 'Puissance De Lune', 'Shocking', 'Zed', 'Proisir', 'Contributer', 'Ace High', 'Shamus Award'].map((s) => s.toLowerCase()),
);
