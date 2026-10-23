/**
 * Domain knowledge tables. These are priors, not facts about today's race:
 * they nudge scores when a source does not supply hard statistics. Tiers are
 * reviewed against the research notes in research/modelknowledge.md.
 */

import { normalisePerson } from '../../shared/util.js';

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
const TRAINER_TIERS: Record<Tier, string[]> = {
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

/** Trainer partnerships are often written as "A & B": match any member. */
function partnershipKeys(name: string): string[] {
  return name
    .split(/\s*(?:&|and|\/)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(keyOf);
}

export function jockeyTier(name?: string): Tier | undefined {
  if (!name) return undefined;
  return JOCKEY_INDEX.get(keyOf(name.replace(/\(a\d*(?:\.\d)?\)/i, '')));
}

export function trainerTier(name?: string): Tier | undefined {
  if (!name) return undefined;
  const full = normalisePerson(name);
  // Try whole string against known partnerships first
  for (const [k, t] of TRAINER_INDEX) if (k === full) return t;
  const parts = partnershipKeys(name);
  let best: Tier | undefined;
  for (const p of parts) {
    const t = TRAINER_INDEX.get(p);
    if (t === 'A') return 'A';
    if (t) best = t;
  }
  // Compare by surname only as a last resort
  const surname = full.split(' ').pop();
  if (!best && surname) {
    for (const [k, t] of TRAINER_INDEX) if (k.endsWith(' ' + surname) || k === surname) return t;
  }
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
