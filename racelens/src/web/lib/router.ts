/** Tiny hash router: `#/pack/2026-10-24:flemington/race/3?tab=field` */
import { useEffect, useState } from 'react';

export interface Route {
  /** Decoded path segments, e.g. ['pack', '2026-10-24:flemington', 'race', '3'] */
  path: string[];
  query: URLSearchParams;
  raw: string;
}

export function parseHash(hash: string): Route {
  let h = hash || '';
  if (h.startsWith('#')) h = h.slice(1);
  const qIndex = h.indexOf('?');
  const pathPart = qIndex >= 0 ? h.slice(0, qIndex) : h;
  const queryPart = qIndex >= 0 ? h.slice(qIndex + 1) : '';
  const path = pathPart
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path, query: new URLSearchParams(queryPart), raw: hash };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string, replace = false): void {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    // replaceState does not fire hashchange; dispatch so useRoute updates.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export const routes = {
  home: (date?: string) => (date ? `#/?date=${encodeURIComponent(date)}` : '#/'),
  job: (jobId: string, meetingId?: string) =>
    `#/job/${encodeURIComponent(jobId)}${meetingId ? `?to=${encodeURIComponent(meetingId)}` : ''}`,
  pack: (packId: string, raceNumber?: number) =>
    `#/pack/${encodeURIComponent(packId)}${raceNumber != null ? `/race/${raceNumber}` : ''}`,
  settings: () => '#/settings',
};
