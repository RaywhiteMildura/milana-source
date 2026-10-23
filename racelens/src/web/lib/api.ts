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
  Settings,
  SourceId,
  SourceKind,
  SourceStatus,
} from '@shared/types';

// ---------------------------------------------------------------------------
// Response shapes that only exist at the HTTP layer (see docs/API.md)
// ---------------------------------------------------------------------------

export interface Health {
  ok: boolean;
  mode: 'live' | 'demo';
  version?: string;
  time?: string;
  dataDir?: string;
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

/** Turn any thrown value into a friendly one-line message for a toast. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return `Not found: ${e.message}`;
    return e.message;
  }
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractError(data) ?? `${res.status} ${res.statusText || 'request failed'}`, path);
  }
  return data as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  health: () => get<Health>('/api/health'),

  getSettings: () => get<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => put<Settings>('/api/settings', patch),

  getSources: () => get<SourcesResponse>('/api/sources'),
  probeSources: () => post<JobIdResponse>('/api/sources/probe'),

  getMeetings: (date: string) => get<MeetingsResponse>(`/api/meetings?date=${enc(date)}`),

  research: (body: { date: string; venueSlug: string; force?: boolean }) => post<ResearchResponse>('/api/research', body),

  getJobs: () => get<JobProgress[]>('/api/jobs'),
  getJob: (id: string) => get<JobProgress>(`/api/jobs/${enc(id)}`),

  getPacks: () => get<PackListItem[]>('/api/packs'),
  getPack: (id: string) => get<MeetingPack>(`/api/packs/${enc(id)}`),
  deletePack: (id: string) => del<{ ok: boolean }>(`/api/packs/${enc(id)}`),

  recheck: (id: string, raceNumber?: number) =>
    post<JobIdResponse>(`/api/packs/${enc(id)}/recheck`, raceNumber == null ? {} : { raceNumber }),
  fetchResults: (id: string, raceNumber?: number) =>
    post<JobIdResponse>(`/api/packs/${enc(id)}/results`, raceNumber == null ? {} : { raceNumber }),
  manualResult: (id: string, raceNumber: number, placings: number[][]) =>
    post<MeetingPack>(`/api/packs/${enc(id)}/results/manual`, { raceNumber, placings }),

  getRace: (id: string, raceNumber: number) => get<RaceDetailResponse>(`/api/packs/${enc(id)}/races/${raceNumber}`),
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-run the request. `silent` keeps the current data on screen while it refreshes. */
  reload: (silent?: boolean) => Promise<void>;
  setData: (d: T | null) => void;
}

/** Run an async request once (and again whenever `deps` change). */
export function useRequest<T>(fn: () => Promise<T>, deps: unknown[]): RequestState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (mine === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ data: silent ? s.data : null, loading: false, error: errorMessage(e) }));
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((d: T | null) => setState((s) => ({ ...s, data: d })), []);

  return { ...state, reload, setData };
}

export interface JobPollState {
  job: JobProgress | null;
  /** Last transport error (polling continues unless the job is gone). */
  error: string | null;
  /** True while we are still waiting for the job to finish. */
  active: boolean;
  finished: boolean;
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
        // A job the server no longer knows about will never finish: stop after a few tries.
        if (e instanceof ApiError && e.status === 404 && misses >= 3) return;
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
  return { job, error, active: !!jobId && !finished, finished };
}

/** Alias kept for readability at call sites. */
export const usePoll = useJobPoll;
