/**
 * RaceLens canonical data model.
 *
 * Every source adapter normalises its raw payload into these shapes. The
 * reconciliation engine merges many sources into a verified `Race`, and the
 * analysis engine turns that into a `Prediction`.
 */

export type SourceId = string;

export type RaceType = 'thoroughbred' | 'harness' | 'greyhound';

export type RaceStatus = 'open' | 'closed' | 'interim' | 'final' | 'abandoned' | 'unknown';

/** Source health for one fetch. */
export interface SourceStatus {
  source: SourceId;
  name: string;
  ok: boolean;
  ms: number;
  itemCount?: number;
  error?: string;
  url?: string;
  fetchedAt: string;
  kind: SourceKind;
}

export type SourceKind = 'official' | 'form' | 'odds' | 'news' | 'weather' | 'demo';

export type Capability =
  | 'meetings'
  | 'racecard'
  | 'form'
  | 'odds'
  | 'results'
  | 'conditions'
  | 'news'
  | 'weather';

// ---------------------------------------------------------------------------
// Meetings & races (as discovered / fetched from one source)
// ---------------------------------------------------------------------------

export interface MeetingSummary {
  /** Canonical id: `${date}:${venueSlug}` */
  id: string;
  /** Local race-day date YYYY-MM-DD */
  date: string;
  venue: string;
  venueSlug: string;
  state?: string;
  country?: string;
  raceType: RaceType;
  raceCount?: number;
  trackCondition?: string;
  /** 1 (Firm) .. 10 (Heavy) */
  trackRating?: number;
  weather?: string;
  rail?: string;
  /** ISO time of first race */
  firstRaceTime?: string;
  /** IANA time zone of the venue, e.g. Australia/Brisbane (for displaying race times in local track time) */
  timezone?: string;
  /** Source specific identifiers (TAB venue mnemonic, Sportsbet meeting id, etc.) */
  sourceRefs: Record<SourceId, string>;
  sources: SourceId[];
}

export interface RaceSummary {
  number: number;
  name: string;
  distance: number;
  startTime?: string;
  raceClass?: string;
  group?: 'G1' | 'G2' | 'G3' | 'Listed' | string;
  prize?: number;
  ageRestriction?: string;
  sexRestriction?: string;
  trackCondition?: string;
  trackRating?: number;
  status: RaceStatus;
  sourceRefs: Record<SourceId, string>;
}

export interface CareerStats {
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  prizeMoney?: number;
}

export interface SplitStats {
  track?: CareerStats;
  distance?: CareerStats;
  trackDistance?: CareerStats;
  firm?: CareerStats;
  good?: CareerStats;
  soft?: CareerStats;
  heavy?: CareerStats;
  synthetic?: CareerStats;
  firstUp?: CareerStats;
  secondUp?: CareerStats;
  /** Record of today's jockey on this horse */
  jockey?: CareerStats;
  /** Clockwise / anticlockwise etc. where supplied */
  direction?: CareerStats;
}

/** One past start. */
export interface FormLine {
  date: string;
  venue: string;
  distance: number;
  trackCondition?: string;
  trackRating?: number;
  position: number;
  starters: number;
  /** Lengths behind the winner (0 when won). */
  margin?: number;
  weight?: number;
  barrier?: number;
  jockey?: string;
  raceClass?: string;
  prize?: number;
  startingPrice?: number;
  time?: string;
  sectional600?: string;
  winner?: string;
  second?: string;
  /** Settling positions, e.g. "4-3-2" */
  inRunning?: string;
  comment?: string;
  /** Source that supplied this line */
  source?: SourceId;
}

export type OddsType = 'fixed' | 'tote' | 'exchange';

export interface OddsQuote {
  source: SourceId;
  bookmaker: string;
  type: OddsType;
  win?: number;
  place?: number;
  opening?: number;
  /** Price history, oldest first (the current price is the last entry when supplied). */
  flucs?: Array<{ price: number; at?: string }>;
  fetchedAt: string;
}

export type SpeedMapPosition = 'leader' | 'on-pace' | 'midfield' | 'backmarker';

/** Runner as emitted by one adapter: partial, best effort. */
export interface RunnerRaw {
  number?: number;
  name: string;
  barrier?: number;
  jockey?: string;
  trainer?: string;
  weight?: number;
  claim?: number;
  scratched?: boolean;
  emergency?: boolean;
  age?: number;
  sex?: string;
  colour?: string;
  sire?: string;
  dam?: string;
  damSire?: string;
  country?: string;
  /** Last starts string most-recent-right as printed in AU form e.g. "x1234" */
  last5?: string;
  career?: CareerStats;
  splits?: SplitStats;
  form?: FormLine[];
  daysSinceLastRun?: number;
  gearChanges?: string[];
  comment?: string;
  /** Source ratings keyed by rating name */
  ratings?: Record<string, number>;
  speedMapPosition?: SpeedMapPosition;
  odds?: OddsQuote[];
  finishingPosition?: number;
  margin?: number;
  silk?: string;
  /** Today's in-running positions once the race has been run, e.g. "3-3-2" */
  inRunning?: string;
  /** Rider statistics where a source supplies them (strike rates in %). */
  jockeyStats?: PersonStats;
  trainerStats?: PersonStats;
}

export interface PersonStats {
  /** Career or season win strike rate, percent */
  winPct?: number;
  /** Recent (e.g. last 30 days / 50 rides) win strike rate, percent */
  recentWinPct?: number;
  /** Place strike rate, percent */
  placePct?: number;
  /** Record of this person at this meeting/track if known */
  starts?: number;
  wins?: number;
  source?: SourceId;
}

export interface RaceRaw extends RaceSummary {
  runners: RunnerRaw[];
  /** Placings as arrays of runner numbers (dead heats share an index). */
  results?: number[][];
  /** Dividends keyed by product (win, place1, quinella, exacta, trifecta, first4) once resulted. */
  dividends?: Record<string, number>;
  source: SourceId;
  fetchedAt: string;
}

export interface MeetingRaw {
  meeting: MeetingSummary;
  races: RaceRaw[];
  source: SourceId;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// News, rumours, weather
// ---------------------------------------------------------------------------

export interface NewsItem {
  id: string;
  source: SourceId;
  outlet?: string;
  title: string;
  url: string;
  publishedAt?: string;
  snippet?: string;
  /** Horse / jockey / trainer names mentioned (matched by the news engine) */
  mentions: string[];
  /** -1 .. 1 crude sentiment */
  sentiment: number;
  /** 0..1 how relevant to the meeting */
  relevance: number;
}

export interface WeatherHour {
  time: string;
  tempC?: number;
  rainMm?: number;
  rainProb?: number;
  windKmh?: number;
  windDir?: number;
}

export interface WeatherSummary {
  source: SourceId;
  venue: string;
  fetchedAt: string;
  /** Rain in the 72h before the meeting (mm) */
  rainLast72hMm?: number;
  /** Rain still to fall on race day before 18:00, as of when the forecast was fetched (mm) */
  rainRaceDayMm?: number;
  maxTempC?: number;
  windKmhMax?: number;
  hourly: WeatherHour[];
  summary: string;
  /** Expected drift in track rating from rain (positive = softer) */
  conditionDrift?: number;
}

// ---------------------------------------------------------------------------
// Reconciled (verified) data
// ---------------------------------------------------------------------------

export interface FieldAgreement<T> {
  value: T | undefined;
  agree: SourceId[];
  disagree: Array<{ source: SourceId; value: T }>;
  /** 0..1 */
  confidence: number;
}

export interface Verification {
  /** 0..1 overall confidence that the facts about this entity are right */
  score: number;
  sourceCount: number;
  conflicts: string[];
  checkedFields: number;
  agreedFields: number;
}

export interface Runner {
  id: string;
  number: number;
  name: string;
  barrier?: number;
  jockey?: string;
  trainer?: string;
  weight?: number;
  claim?: number;
  scratched: boolean;
  emergency?: boolean;
  age?: number;
  sex?: string;
  colour?: string;
  sire?: string;
  dam?: string;
  damSire?: string;
  country?: string;
  last5?: string;
  career?: CareerStats;
  splits?: SplitStats;
  form: FormLine[];
  daysSinceLastRun?: number;
  gearChanges: string[];
  comments: Array<{ source: SourceId; text: string }>;
  ratings: Record<string, number>;
  speedMapPosition?: SpeedMapPosition;
  odds: OddsQuote[];
  market?: MarketSummary;
  finishingPosition?: number;
  margin?: number;
  silk?: string;
  inRunning?: string;
  jockeyStats?: PersonStats;
  trainerStats?: PersonStats;
  fields: {
    barrier: FieldAgreement<number>;
    jockey: FieldAgreement<string>;
    trainer: FieldAgreement<string>;
    weight: FieldAgreement<number>;
    scratched: FieldAgreement<boolean>;
    number: FieldAgreement<number>;
  };
  sources: SourceId[];
  verification: Verification;
  news: NewsItem[];
}

export interface MarketSummary {
  /** Best available fixed win price */
  bestWin?: number;
  bestWinBookmaker?: string;
  /** Mean fixed win price */
  meanWin?: number;
  bestPlace?: number;
  /** Market implied win probability after removing overround */
  impliedWinProb?: number;
  /** % price change from opening to now across sources (negative = firming) */
  movePct?: number;
  mover?: 'firming' | 'drifting' | 'steady';
  quoteCount: number;
  /** Price dispersion between bookmakers as a fraction of mean */
  dispersion?: number;
}

export interface Race extends RaceSummary {
  runners: Runner[];
  results?: number[][];
  sources: SourceId[];
  verification: Verification;
  /** Field size after scratchings */
  fieldSize: number;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface FactorScore {
  key: string;
  label: string;
  /** Standardised -1 .. 1 (positive favours the runner) */
  score: number;
  weight: number;
  contribution: number;
  evidence: string;
  /** 0..1 how much data backed this factor */
  dataQuality: number;
}

export interface RunnerAssessment {
  runnerId: string;
  number: number;
  name: string;
  /** Model strength (log-scale) */
  strength: number;
  winProb: number;
  placeProb: number;
  top6Prob: number;
  expectedFinish: number;
  rank: number;
  factors: FactorScore[];
  reasons: string[];
  concerns: string[];
  marketWinProb?: number;
  bestOdds?: number;
  bestPlace?: number;
  fairOdds: number;
  /** Expected profit per $1 at the best price, by our win chance (winProb × bestOdds − 1); above 0 = value. */
  valueEdge?: number;
  dataCompleteness: number;
  verificationScore: number;
}

export type ConfidenceLabel = 'Low' | 'Fair' | 'Good' | 'High';

export interface ConfidenceRating {
  /** 0..100 */
  overall: number;
  label: ConfidenceLabel;
  components: {
    dataCompleteness: number;
    sourceAgreement: number;
    separation: number;
    marketAlignment: number;
    fieldSize: number;
    freshness: number;
  };
  notes: string[];
}

export type BetType =
  | 'win'
  | 'place'
  | 'each-way'
  | 'quinella'
  | 'exacta'
  | 'trifecta'
  | 'first4'
  | 'saver';

export interface BetSuggestion {
  type: BetType;
  runners: number[];
  /** For exotics: standout structure e.g. [[1],[2,3],[2,3,4]] */
  legs?: number[][];
  stakeUnits: number;
  stakeAmount: number;
  combinations?: number;
  flexiPct?: number;
  rationale: string;
  estimatedReturn?: string;
  priority: 'core' | 'value' | 'saver' | 'fun';
}

export interface BettingPlan {
  stance: 'bet' | 'small' | 'watch' | 'skip';
  unitAmount: number;
  totalUnits: number;
  totalAmount: number;
  suggestions: BetSuggestion[];
  notes: string[];
}

export interface DayPattern {
  key: string;
  label: string;
  detail: string;
  /** 0..1 */
  strength: number;
  basedOnRaces: number[];
  /** Factor key this pattern adjusts and the multiplier applied */
  adjust?: { factorKey: string; multiplier: number } | { bias: 'inside' | 'outside' | 'leaders' | 'backmarkers' | 'favourites' | 'roughies'; weight: number };
}

export interface Prediction {
  raceNumber: number;
  generatedAt: string;
  ranked: RunnerAssessment[];
  /** Top 6 (or fewer in small fields) */
  top: RunnerAssessment[];
  confidence: ConfidenceRating;
  betting: BettingPlan;
  summary: string;
  dayPatternsApplied: DayPattern[];
  /** Diff versus the previous prediction for this race (pre-race recheck) */
  changes?: string[];
  modelVersion: string;
  /**
   * Rated after the race had jumped (a meeting first researched after it ran): shown for reference only, never
   * scored and left out of the "our pick ranked N" tally.
   */
  postJump?: boolean;
}

export interface RaceResult {
  raceNumber: number;
  placings: number[][];
  margins?: number[];
  time?: string;
  dividends?: Record<string, number>;
  recordedAt: string;
  source: SourceId;
  /** Interim placings may still change (protest, correction); final ones do not. */
  status?: 'interim' | 'final';
  /** Sources that agreed on these placings */
  confirmedBy?: SourceId[];
  /** How the prediction did */
  scorecard?: {
    winnerRank?: number;
    winnerInTop3: boolean;
    winnerInTop6: boolean;
    placegettersInTop6: number;
    predictedWinnerPosition?: number;
    exactaHit: boolean;
    quinellaHit: boolean;
    trifectaBoxHit: boolean;
  };
}

// ---------------------------------------------------------------------------
// Meeting pack (persisted research)
// ---------------------------------------------------------------------------

export interface PackEvent {
  at: string;
  type: 'research' | 'recheck' | 'results' | 'note';
  summary: string;
  raceNumber?: number;
  changes?: string[];
}

/**
 * Book-keeping for the automatic results watcher: one entry per race the
 * server is (or was) polling for a result after the jump.
 */
export interface ResultWatch {
  /** Last time the sources were asked for this race's result */
  lastCheckedAt: string;
  /** How many automatic checks have run for this race */
  attempts: number;
  /** When the next automatic check is due (absent once settled or given up) */
  nextCheckAt?: string;
  /** Set once the watcher stops trying (e.g. hours after the jump with nothing published) */
  gaveUp?: boolean;
  /** Human-readable state, e.g. "Result from one source only – waiting for confirmation" */
  note?: string;
  /**
   * One more look, after the sources settled the result early, for a late
   * correction (a protest upheld, amended placings). Absent once that look has
   * run, for results typed in by hand, and for results settled later on.
   */
  correctionCheckAt?: string;
}

export interface MeetingPack {
  id: string;
  createdAt: string;
  updatedAt: string;
  meeting: MeetingSummary;
  races: Race[];
  predictions: Record<number, Prediction>;
  weather?: WeatherSummary;
  news: NewsItem[];
  sourceStatuses: SourceStatus[];
  dayPatterns: DayPattern[];
  results: Record<number, RaceResult>;
  history: PackEvent[];
  /** Overall data verification 0..1 */
  verificationScore: number;
  /** Settings used */
  settings: Settings;
  /** Automatic results watcher state, keyed by race number */
  resultWatch?: Record<number, ResultWatch>;
}

export interface Settings {
  bankroll: number;
  unitAmount: number;
  /** 'conservative' | 'balanced' | 'aggressive' */
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  jurisdiction: string;
  disabledSources: SourceId[];
  autoRecheckMinutesBeforeRace: number;
  /** Poll the results sources after each race and re-rate the remaining races automatically */
  autoResults: boolean;
}

/** What the background scheduler is doing, as reported by GET /api/health (authenticated). */
export interface SchedulerStatus {
  running: boolean;
  lastTickAt?: string;
  nextTickAt?: string;
  autoResults: boolean;
  autoRecheckMinutes: number;
  /** Races currently being watched for a result */
  watching: Array<{ meetingId: string; venue: string; raceNumber: number; attempts: number; lastCheckedAt?: string; nextCheckAt?: string }>;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStepStatus = 'pending' | 'running' | 'done' | 'warn' | 'error' | 'skipped';

export interface JobStep {
  key: string;
  label: string;
  status: JobStepStatus;
  detail?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface JobProgress {
  id: string;
  type: 'research' | 'recheck' | 'results' | 'probe';
  meetingId?: string;
  raceNumber?: number;
  status: 'queued' | 'running' | 'done' | 'error';
  steps: JobStep[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** 0..100 */
  percent: number;
  message: string;
}

export const MODEL_VERSION = 'racelens-model-1.0';
