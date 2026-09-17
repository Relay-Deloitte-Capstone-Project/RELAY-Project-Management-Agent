import { getAskApiToken } from "@/lib/auth/functions";

// Drop-in replacement for `fetch()` when calling the FastAPI backend
// (VITE_ASK_API_URL). Every backend route now verifies a bearer token
// (backend/api/auth.py) instead of trusting a client-supplied email/
// engagement_id — this is what attaches one on every request from anywhere
// in the app, not just Ask Project (which had this pattern first, in
// _authenticated.dev.ask.tsx's now-shared getApiToken/apiCall helpers).
//
// The token is short-lived (15 min) and separate from the 30-day httpOnly
// session cookie, which client-side JS can't read at all — see
// src/lib/auth/session.server.ts's signApiToken for why. Cached in memory
// per browser tab and refreshed a little before expiry, or immediately on
// an unexpected 401.
let tokenCache: { token: string; expiresAt: number } | null = null;

// Every dashboard fires several relayFetch calls at once on mount (one per
// panel). Without this, each one independently sees an empty/stale cache at
// the same instant and mints its own token — N redundant round-trips on
// every page load instead of 1, and the real source of the "everything got
// slower" latency. This makes concurrent callers share the same in-flight
// mint instead of each starting their own.
let inFlight: Promise<string> | null = null;

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  if (!forceRefresh && inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { token, expiresInSeconds } = await getAskApiToken();
      tokenCache = { token, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 };
      return token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function relayFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const call = (token: string) =>
    fetch(input, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });

  let res = await call(await getToken());
  if (res.status === 401) {
    // Expired or rejected token — get a fresh one and retry exactly once,
    // rather than failing a request over a token that just needed renewing.
    res = await call(await getToken(true));
  }
  return res;
}

// --- GET response cache ---------------------------------------------------
//
// Every dashboard page re-fetches everything from scratch on every mount —
// there was never a client-side cache here, auth or not. Combined with this
// app's free-tier Postgres (Neon) and, for anything backed by the live Jira
// board, a real network call to Atlassian, a single GET can take anywhere
// from ~0.5s to ~2.5s. None of that is caused by the auth work (a bare,
// no-op DB ping costs the same ~0.5s), but the fix for "feels slow every
// time I click back to a page I was just on" is the same either way: don't
// re-run a slow call for data that hasn't gone stale yet.
//
// TTL default is short (60s) on purpose — long enough that clicking between
// two pages feels instant, short enough that a real change (a new ticket, a
// note someone else approved) shows up again within a minute without
// requiring a hard refresh anywhere.
const DEFAULT_TTL_MS = 60_000;

const dataCache = new Map<string, { data: unknown; expiresAt: number }>();
const dataInFlight = new Map<string, Promise<unknown>>();

/**
 * GET + parse JSON through relayFetch, cached per URL. Concurrent calls for
 * the same URL share one request; a call within the TTL window returns the
 * cached value with no network round-trip at all.
 *
 * `opts.fresh` forces a real refetch (e.g. right after a mutation that
 * changed this data) and re-populates the cache with the new result.
 */
export async function cachedJson<T>(
  url: string,
  opts?: { ttlMs?: number; fresh?: boolean },
): Promise<T> {
  const now = Date.now();
  if (!opts?.fresh) {
    const cached = dataCache.get(url);
    if (cached && cached.expiresAt > now) return cached.data as T;
    const pending = dataInFlight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const promise = (async () => {
    try {
      const res = await relayFetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      dataCache.set(url, { data: json, expiresAt: Date.now() + ttlMs });
      return json as T;
    } finally {
      dataInFlight.delete(url);
    }
  })();
  dataInFlight.set(url, promise);
  return promise;
}

/** Drop cached GETs so the next read is forced fresh — call after a mutation
 * (upload, confirm, delete, etc.) that changed data a cached URL depends on.
 * With no argument, clears everything, including the cached API token —
 * call this on login and logout. Login and logout both navigate client-side
 * (see LoginForm.tsx, SignOutButton.tsx), so this module's state otherwise
 * survives the transition: the previous identity's still-fresh token would
 * get reused for the new session's first requests, passing require_user
 * (it's a validly signed token, just for the wrong person) while failing
 * any role check that the new person's actual role would have passed. */
export function invalidateCache(url?: string): void {
  if (url) {
    dataCache.delete(url);
    dataInFlight.delete(url);
  } else {
    dataCache.clear();
    dataInFlight.clear();
    tokenCache = null;
  }
}
