import { GoTrueClient } from '@supabase/auth-js';
import { APP_VERSION } from '@/lib/version';

// The browser gets ONLY the auth half of supabase-js.
//
// Every client-side call through here is `getSupabase().auth.…` — getSession,
// setSession, signOut, verifyOtp, onAuthStateChange. Nothing in the browser
// talks to PostgREST, Storage, Realtime or Edge Functions; all of that lives
// behind our own /api routes, which hold the service-role key and do the
// gating. But `createClient()` from @supabase/supabase-js instantiates all
// five sub-clients in its constructor, so importing it dragged realtime-js (a
// whole websocket stack), postgrest-js, storage-js and functions-js into the
// shared client chunk that 43 of the app's 44 page routes load. Measured with
// esbuild: 216 KB raw / 57 KB gzip for the full client against 101 KB / 24 KB
// for auth-js alone — 115 KB less to parse and 33 KB less to download on every
// cold page load, for a PWA whose users are all on phones.
//
// This is not a reimplementation. supabase-js's auth client is literally
// `class SupabaseAuthClient extends AuthClient { constructor(o) { super(o) } }`,
// and auth-js's `AuthClient` is in turn `const AuthClient = GoTrueClient` — so
// the object below is the very class supabase-js would have instantiated, given
// the same options it would have passed. (GoTrueClient rather than AuthClient
// only because auth-js declares the alias as a value with no type side.) The
// values that have to match exactly are called out where they're derived.
//
// @supabase/auth-js is pinned to the exact version @supabase/supabase-js
// depends on. Bump the two together: the server still uses the full client
// (src/lib/supabase/server.ts), and a mismatch would install a second copy of
// auth-js instead of sharing the hoisted one.

/**
 * The two values that have to come out byte-identical to what
 * `createClient(url, key)` computes, derived the same way its constructor does:
 * trailing slash first, so `new URL('auth/v1', base)` extends any path the
 * configured URL carries rather than replacing it.
 *
 * `storageKey` is the load-bearing one — it is where the session already sits in
 * every signed-in browser, so a different string here would silently sign the
 * whole club out on deploy. Exported only so a test can hold it against the real
 * supabase-js client (see browserSupabaseAuthConfig.test.ts).
 */
export function browserAuthConfig(url: string): { authUrl: string; storageKey: string } {
  const trimmed = url.trim();
  const base = new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`);
  return {
    authUrl: new URL('auth/v1', base).href,
    storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
  };
}

/**
 * Where the browser keeps its session. Normally derived from the project URL, as
 * supabase-js does. NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY pins it instead: when
 * the database moves to a new Supabase project (Tokyo → Frankfurt, 2026-10), the
 * derived key changes with the project ref, and every signed-in phone would look
 * signed out. Pinned to the old key, the stored session is found and handed to
 * expireForeignSession() below.
 */
export function sessionStorageKey(url: string): string {
  const pinned = process.env.NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY?.trim();
  return pinned || browserAuthConfig(url).storageKey;
}

/**
 * A session minted by ANOTHER project (its access token's `iss` is not this
 * project's auth URL) can't be used as-is: the new project rejects the old
 * signature. Its refresh token still works — auth.refresh_tokens moved with the
 * data — so mark it expired and let auth-js refresh it on load
 * (_recoverAndRefresh refreshes any session past expires_at). If the refresh
 * fails, auth-js drops the session and the mc_device silent re-auth takes over.
 * Returns true when it rewrote something; never throws.
 */
export function expireForeignSession(storage: Pick<Storage, 'getItem' | 'setItem'>, storageKey: string, authUrl: string): boolean {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return false;
    const session = JSON.parse(raw) as { access_token?: string; expires_at?: number };
    const payload = session.access_token?.split('.')[1];
    if (!payload) return false;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const iss = (JSON.parse(json) as { iss?: string }).iss;
    // Compared by HOST, and only when `iss` is a URL at all: a token whose issuer
    // isn't a URL (or is this project's) is never touched, so a format surprise
    // can't turn into a refresh on every load.
    let issHost = '';
    try { issHost = new URL(iss || '').hostname; } catch { return false; }
    if (!issHost || issHost === new URL(authUrl).hostname || session.expires_at === 0) return false;
    storage.setItem(storageKey, JSON.stringify({ ...session, expires_at: 0 }));
    return true;
  } catch {
    return false;
  }
}

let _client: { auth: GoTrueClient } | null = null;

/**
 * Auth-only Supabase client for the browser.
 *
 * Shaped as `{ auth }` so every existing `getSupabase().auth.…` call site reads
 * unchanged — and so that reaching for `.from()` or `.storage` here fails to
 * compile, which is the point rather than a limitation: a browser-side table
 * read runs under the anon key and whatever RLS happens to be on the table,
 * not under the API routes that actually gate this app.
 */
export function getSupabase(): { auth: GoTrueClient } {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('placeholder')) {
      throw new Error('Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    }

    const { authUrl } = browserAuthConfig(url);
    const storageKey = sessionStorageKey(url);
    if (typeof window !== 'undefined' && expireForeignSession(window.localStorage, storageKey, authUrl)) {
      // Read by /dashboard/move's check suite: "your session carried over".
      try { window.sessionStorage.setItem('mc_session_carried', '1'); } catch { /* private mode */ }
    }

    _client = {
      auth: new GoTrueClient({
        url: authUrl,
        // `headers` REPLACES auth-js's defaults rather than merging with them,
        // so the two credentials it needs are spelled out. X-Client-Info is
        // telemetry only — supabase-js sent its own version there, we send the
        // app's, which is the more useful answer in Supabase's logs anyway.
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'X-Client-Info': `madregot-connect/${APP_VERSION}`,
        },
        storageKey,
        // The same three the old createClient() call asked for. flowType
        // ('implicit') and the localStorage adapter are auth-js's defaults, and
        // were supabase-js's defaults too, so they stay unstated.
        //
        // Diffed field-by-field against a real createClient()'s .auth: url,
        // storageKey, flowType, the three flags below, the header set and
        // hasCustomAuthorizationHeader are identical. Two land on auth-js's
        // defaults instead of undefined, because supabase-js passes them through
        // as undefined and Object.assign keeps that: throwOnError (undefined vs
        // false — both falsy at every use) and lockAcquireTimeout (undefined vs
        // 5000 — only read when a custom `lock` is supplied, and neither client
        // supplies one, so it stays dead either way).
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      }),
    };
  }
  return _client;
}
