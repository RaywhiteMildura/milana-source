/**
 * Typed fetch helpers for every endpoint in docs/API.md, plus small React hooks
 * for one-off requests and for polling a job until it finishes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Capability,
  JobProgress,
  MeetingPack,
  MeetingSummary,
  Prediction,
  Race,
  RaceResult,
  SchedulerStatus,
  Settings,
  SourceId,
  SourceKind,
  SourceStatus,
} from '@shared/types';
import { dropCopy, readCopy, saveCopy, savedGeneration, savedKeys } from './saved';

// ---------------------------------------------------------------------------
// Response shapes that only exist at the HTTP layer (see docs/API.md)
// ---------------------------------------------------------------------------

export interface Health {
  ok: boolean;
  mode: 'live' | 'demo';
  version?: string;
  time?: string;
  /** True when the server wants a password before it answers the rest of the API. */
  authRequired: boolean;
  // The fields below are only present once signed in (or when no password is set).
  dataDir?: string;
  /** Addresses a phone on the same network can use (empty unless the server listens on 0.0.0.0, and always empty when hosted). */
  urls?: string[];
  /** The address that works from anywhere when the server is hosted (Fly, Render or RACELENS_PUBLIC_URL). */
  publicUrl?: string;
  scheduler?: SchedulerStatus;
}

export interface AuthState {
  required: boolean;
  authenticated: boolean;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  kind: SourceKind;
  capabilities: Capability[];
  homepage?: string;
  enabled: boolean;
  lastStatus?: SourceStatus;
}

export interface SourcesResponse {
  sources: SourceInfo[];
}

export interface MeetingsResponse {
  date: string;
  meetings: MeetingSummary[];
  sourceStatuses: SourceStatus[];
  fromCache: boolean;
}

export interface ResearchResponse {
  jobId: string;
  meetingId: string;
}

export interface JobIdResponse {
  jobId: string;
}

/** POST /packs/:id/results with { catchup: true }: no job (jobId null) when the server has nothing due. */
export interface CatchupResponse {
  jobId: string | null;
  /** Races the server found due and is checking */
  due: number[];
}

/** A quick change (manual result, delete) accepted but still queued behind a long job: follow `jobId`. */
export interface QueuedReply {
  queued: true;
  jobId: string;
  message: string;
}

export const isQueued = (x: unknown): x is QueuedReply => !!x && typeof x === 'object' && (x as { queued?: unknown }).queued === true && typeof (x as { jobId?: unknown }).jobId === 'string';

export interface PackListItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  meeting: MeetingSummary;
  verificationScore: number;
  raceCount: number;
  predictedRaces: number;
  resultedRaces: number;
}

export interface RaceDetailResponse {
  race: Race;
  prediction?: Prediction;
  result?: RaceResult;
}

/** GET /api/update: the version the server runs and its own updater (on the Mac mini; unsupported elsewhere). */
export type UpdateState = 'idle' | 'requested' | 'running' | 'failed' | 'done';

export interface UpdateStatus {
  supported: boolean;
  version?: { commit?: string; branch?: string; installedAt?: string };
  state: UpdateState;
  last?: { startedAt?: string; finishedAt?: string; ok?: boolean; message?: string; from?: string; to?: string };
}

/** POST /api/update: 202 (409 while one is running, 501 where there is no updater). */
export interface UpdateRequested {
  requested: true;
  message: string;
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const UNREACHABLE_MESSAGE = 'The Mac mini is not answering – check Tailscale is on and you have signal.';
/** An error page from what stands in front of RaceLens (Tailscale Serve answers 502 while the Mac restarts it). */
const RESTARTING_MESSAGE = 'RaceLens on the Mac mini is restarting or not running – try again in a minute.';

/** No answer from the server at all: the request timed out, or the network refused it (Tailscale off, no signal). */
export class UnreachableError extends Error {
  constructor(
    public readonly path: string,
    public readonly timedOut: boolean,
  ) {
    super(UNREACHABLE_MESSAGE);
    this.name = 'UnreachableError';
  }
}

/** RaceLens itself did not answer (see above, or a 5xx such as that 502): a saved copy may stand in. */
export function isUnreachable(e: unknown): boolean {
  return e instanceof UnreachableError || (e instanceof ApiError && e.status >= 500);
}

/** Turn any thrown value into a friendly one-line message for a toast. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return `Not found: ${e.message}`;
    return e.message;
  }
  if (e instanceof UnreachableError) return e.message;
  if (e instanceof TypeError) return 'Could not reach the RaceLens server. Check it is running and you are online.';
  if (e instanceof Error) return e.message;
  return String(e);
}

function extractError(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const v = d[key];
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string') {
        return (v as { message: string }).message;
      }
    }
  }
  return undefined;
}

/** Fired on `window` whenever an API call is refused for want of a login. */
export const AUTH_REQUIRED_EVENT = 'racelens:auth-required';

/**
 * How long a read may go without a byte from the server – before the answer
 * starts, or between pieces of a big one – before it gives up. Without it a
 * stalled connection (congested 4G at the track) hangs for a minute or more; a
 * slow but moving download of a big meeting is never cut off.
 */
const READ_TIMEOUT_MS = 15_000;
/** Writes and job starts: the server may take a moment before it answers. */
const WRITE_TIMEOUT_MS = 30_000;

/** The body as text, calling `onProgress` as each piece arrives. */
async function readBody(res: Response, onProgress: () => void): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    onProgress();
    text += decoder.decode(value, { stream: true });
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  init.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let timedOut = false;
  let timer: number | undefined;
  const wait = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, ms);
  };
  let res: Response;
  let text: string;
  wait(!init.method || init.method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  try {
    res = await fetch(path, { ...init, signal: ctrl.signal, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    wait(READ_TIMEOUT_MS);
    text = await readBody(res, () => wait(READ_TIMEOUT_MS));
  } catch (e) {
    // A network failure is a TypeError ("Load failed" on an iPhone); our own timeout is an AbortError.
    if (timedOut || e instanceof TypeError) throw new UnreachableError(path, timedOut);
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && data && typeof data === 'object' && (data as { code?: unknown }).code === 'auth') {
      // The session cookie is missing or expired: let the app shell drop back to the login screen.
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
    // Not RaceLens's own JSON error but a gateway's page: say what it means.
    const gateway = res.status >= 502 && res.status <= 504 && !(data && typeof data === 'object');
    throw new ApiError(res.status, gateway ? RESTARTING_MESSAGE : extractError(data) ?? `${res.status} ${res.statusText || 'request failed'}`, path);
  }
  return data as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

const enc = encodeURIComponent;

/** Keep a good answer as the phone's saved copy (lib/saved.ts) – only the meeting list and the meetings themselves. */
async function keep<T>(key: string, p: Promise<T>): Promise<T> {
  const gen = savedGeneration();
  const data = await p;
  void saveCopy(key, data, gen);
  return data;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  health: () => get<Health>('/api/health'),

  auth: () => get<AuthState>('/api/auth'),
  login: (password: string) => post<{ ok: boolean }>('/api/login', { password }),
  logout: () => post<{ ok: boolean }>('/api/logout'),

  getSettings: () => get<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => put<Settings>('/api/settings', patch),

  getSources: () => get<SourcesResponse>('/api/sources'),
  probeSources: () => post<JobIdResponse>('/api/sources/probe'),

  getMeetings: (date: string) => get<MeetingsResponse>(`/api/meetings?date=${enc(date)}`),

  research: (body: { date: string; venueSlug: string; force?: boolean }) => post<ResearchResponse>('/api/research', body),

  getJobs: () => get<JobProgress[]>('/api/jobs'),
  getJob: (id: string) => get<JobProgress>(`/api/jobs/${enc(id)}`),

  getPacks: () => keep(savedKeys.packList, get<PackListItem[]>('/api/packs')),
  getPack: (id: string) => keep(savedKeys.pack(id), get<MeetingPack>(`/api/packs/${enc(id)}`)),
  deletePack: async (id: string) => {
    const out = await del<{ ok: boolean } | QueuedReply>(`/api/packs/${enc(id)}`);
    void dropCopy(savedKeys.pack(id));
    return out;
  },

  recheck: (id: string, raceNumber?: number) =>
    post<JobIdResponse>(`/api/packs/${enc(id)}/recheck`, raceNumber == null ? {} : { raceNumber }),
  fetchResults: (id: string, raceNumber?: number) =>
    post<JobIdResponse>(`/api/packs/${enc(id)}/results`, raceNumber == null ? {} : { raceNumber }),
  /** The phone's quiet catch-up: the server checks only the races its own schedule says are due, as an automatic check. */
  catchUpResults: (id: string) => post<CatchupResponse>(`/api/packs/${enc(id)}/results`, { catchup: true }),
  manualResult: (id: string, raceNumber: number, placings: number[][]) =>
    post<MeetingPack | QueuedReply>(`/api/packs/${enc(id)}/results/manual`, { raceNumber, placings }),

  getRace: (id: string, raceNumber: number) => get<RaceDetailResponse>(`/api/packs/${enc(id)}/races/${raceNumber}`),

  getUpdate: () => get<UpdateStatus>('/api/update'),
  startUpdate: () => post<UpdateRequested>('/api/update'),
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** When the copy on screen was saved on this phone, while RaceLens cannot be reached (see `savedKey`); null when live. */
  savedAt: string | null;
  /** When the data on screen last came live from the server (null before it ever did). */
  receivedAt: string | null;
  /** Re-run the request. `silent` keeps the current data on screen while it refreshes. */
  reload: (silent?: boolean) => Promise<void>;
  /** Show newer data from the server (marks it live). */
  setData: (d: T | null) => void;
  /**
   * Another request found the server gone (the page's own live poll): label the data on screen as a saved copy from
   * `since` (default: when it arrived) and keep retrying, as when this request itself fails. Needs a `savedKey`.
   */
  markUnreachable: (since?: string | null) => void;
}

interface RequestData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  savedAt: string | null;
}

/** How often a page showing a saved copy asks the server again (and at once on regaining the network or the screen). */
const SAVED_RETRY_MS = 15_000;
/** On a crawling connection, show the saved copy after this long rather than a skeleton for the whole wait. */
const SAVED_EARLY_MS = 4_000;

/**
 * Run an async request once (and again whenever `deps` change).
 *
 * With `savedKey` (the lib/saved.ts key whose copy `fn` keeps), a request that
 * cannot reach RaceLens shows the copy saved on this phone instead of an error
 * – flagged by `savedAt` for the page's banner – and keeps retrying in the
 * background until the server answers again.
 */
export function useRequest<T>(fn: () => Promise<T>, deps: unknown[], savedKey?: string): RequestState<T> {
  const [state, setState] = useState<RequestData<T>>({ data: null, loading: true, error: null, savedAt: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(savedKey);
  keyRef.current = savedKey;
  const stateRef = useRef(state);
  stateRef.current = state;
  /** When the live data on screen arrived: "Saved copy from …" if the server then stops answering. */
  const liveAt = useRef<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    const key = keyRef.current;
    let settled = false;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    const showSaved = async (onlyWhilePending: boolean) => {
      const copy = key ? await readCopy<T>(key) : null;
      if (!copy || mine !== seq.current || (onlyWhilePending && settled)) return false;
      setState({ data: copy.data, loading: false, error: null, savedAt: copy.savedAt });
      return true;
    };
    const early = key && !silent ? window.setTimeout(() => void showSaved(true), SAVED_EARLY_MS) : undefined;
    try {
      const data = await fnRef.current();
      settled = true;
      if (mine !== seq.current) return;
      liveAt.current = new Date().toISOString();
      setState({ data, loading: false, error: null, savedAt: null });
    } catch (e) {
      settled = true;
      if (mine !== seq.current) return;
      if (key && isUnreachable(e)) {
        // What is on screen is the newest copy this phone has: keep it, labelled. Otherwise the saved one.
        const s = stateRef.current;
        if (silent && s.data != null) {
          setState({ ...s, loading: false, error: null, savedAt: s.savedAt ?? liveAt.current ?? new Date().toISOString() });
          return;
        }
        if ((await showSaved(false)) || mine !== seq.current) return;
      }
      setState((s) => ({ data: silent ? s.data : null, loading: false, error: errorMessage(e), savedAt: silent ? s.savedAt : null }));
    } finally {
      window.clearTimeout(early);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Showing a saved copy: keep asking, quietly, until the server answers.
  const onSavedCopy = state.savedAt != null;
  useEffect(() => {
    if (!onSavedCopy) return;
    let busy = false;
    const retry = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        await reload(true);
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(retry, SAVED_RETRY_MS);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [onSavedCopy, reload]);

  const setData = useCallback((d: T | null) => {
    liveAt.current = new Date().toISOString();
    setState((s) => ({ ...s, data: d, savedAt: null }));
  }, []);

  const markUnreachable = useCallback((since?: string | null) => {
    if (!keyRef.current) return;
    setState((s) => (s.data == null || s.savedAt ? s : { ...s, error: null, savedAt: since ?? liveAt.current ?? new Date().toISOString() }));
  }, []);

  // liveAt only changes together with state, so reading it here is current.
  return { ...state, receivedAt: liveAt.current, reload, setData, markUnreachable };
}

export interface JobPollState {
  job: JobProgress | null;
  /** Last transport error (polling continues unless the job is gone). */
  error: string | null;
  /** True while we are still waiting for the job to finish. */
  active: boolean;
  /** The job reported done or error. */
  finished: boolean;
  /** The server no longer knows the job (404s, e.g. after a restart): polling stopped and it will never finish. */
  gone: boolean;
}

export function isJobFinished(job: JobProgress | null | undefined): boolean {
  return !!job && (job.status === 'done' || job.status === 'error');
}

/**
 * Poll GET /api/jobs/:id every `intervalMs` (default 1s) until the job reports
 * `done` or `error`. Pass `null` to idle.
 */
export function useJobPoll(jobId: string | null | undefined, intervalMs = 1000): JobPollState {
  const [job, setJob] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed by job id so a lost earlier job can never make a new one look lost on its first render.
  const [goneFor, setGoneFor] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
    if (!jobId) return;
    let cancelled = false;
    let timer: number | undefined;
    let misses = 0;

    const tick = async () => {
      try {
        const j = await api.getJob(jobId);
        if (cancelled) return;
        misses = 0;
        setJob(j);
        setError(null);
        if (isJobFinished(j)) return;
      } catch (e) {
        if (cancelled) return;
        misses += 1;
        setError(errorMessage(e));
        // A job the server no longer knows about will never finish: stop after a few tries and say so.
        if (e instanceof ApiError && e.status === 404 && misses >= 3) {
          setGoneFor(jobId);
          return;
        }
      }
      timer = window.setTimeout(tick, intervalMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  const finished = isJobFinished(job);
  const gone = !!jobId && goneFor === jobId && !finished;
  return { job, error, active: !!jobId && !finished && !gone, finished, gone };
}

/** Alias kept for readability at call sites. */
export const usePoll = useJobPoll;
