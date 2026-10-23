/**
 * App-wide session state: the server's health (mode, LAN urls, scheduler
 * status) and whether a password login is in force. Provided by App.tsx.
 */
import { createContext, useContext } from 'react';
import type { Health } from './api';
import { useNow } from './hooks';

export interface Session {
  health: Health | null;
  /** Re-fetch /api/health (silently keeps the current value while it loads). */
  reloadHealth: () => Promise<void>;
  /** True when the server is protected by a password. */
  authRequired: boolean;
  /** Clear the session cookie and return to the login screen. */
  signOut: () => Promise<void>;
  /**
   * Server time minus device time, in ms. Countdowns, "jumped yet?" decisions
   * and catch-up checks follow the server's clock (it is the one running the
   * automation), so a phone with a drifting clock, or a demo rehearsal with
   * RACELENS_FAKE_NOW, still agrees with what the server is doing.
   */
  clockOffset: number;
}

export const SessionContext = createContext<Session>({
  health: null,
  reloadHealth: async () => undefined,
  authRequired: false,
  signOut: async () => undefined,
  clockOffset: 0,
});

export function useSession(): Session {
  return useContext(SessionContext);
}

/** A ticking clock in server time (see Session.clockOffset). */
export function useServerNow(intervalMs = 30_000): number {
  const now = useNow(intervalMs);
  const { clockOffset } = useSession();
  return now + clockOffset;
}
