import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { GoTrueClient } from '@supabase/auth-js';
import { browserAuthConfig } from '@/lib/supabase/client';

/**
 * The browser no longer loads @supabase/supabase-js — it constructs auth-js's
 * GoTrueClient directly, which is the same class createClient() would have
 * instantiated, but with options we now pass ourselves (see the comment on
 * src/lib/supabase/client.ts for why: realtime-js, postgrest-js, storage-js and
 * functions-js were 133 KB of dead client JS on 43 of 44 page routes).
 *
 * Passing those options ourselves means one thing can go quietly, catastrophically
 * wrong: the auth storage key. It is where the session already sits in every
 * signed-in browser, so if our derivation ever drifts from supabase-js's, the
 * deploy signs the entire club out — and nothing else in the build would notice,
 * because a missing session looks exactly like a logged-out visitor.
 *
 * So these cases pin our derivation against the real thing rather than against a
 * hardcoded expectation: they build an actual supabase-js client and compare.
 * If a future supabase-js changes how it derives either value, this fails on
 * `npm test` instead of in production.
 */
describe('browserAuthConfig matches supabase-js', () => {
  // checkApiKeyFormat only warns, never throws, so the shape of this is irrelevant.
  const KEY = 'test-anon-key';

  const urls = [
    'https://njzldypndkicpsmdtyll.supabase.co',
    // Trailing slash — supabase-js normalises it in, so both forms must agree.
    'https://njzldypndkicpsmdtyll.supabase.co/',
    // Surrounding whitespace, which is what a copy-pasted .env value looks like.
    '  https://njzldypndkicpsmdtyll.supabase.co  ',
    // Self-hosted / custom domain: the "project ref" is just the first label.
    'https://supabase.example.org',
    // A URL with a path. The trailing slash is the whole reason this case works:
    // without it `new URL('auth/v1', base)` would drop /gateway.
    'https://example.org/gateway',
    // Local development.
    'http://localhost:54321',
  ];

  for (const url of urls) {
    it(`derives the same storageKey and auth url for ${JSON.stringify(url)}`, () => {
      const real = createClient(url, KEY);
      const ours = browserAuthConfig(url);
      // Both read off the instances rather than through the public API: neither
      // storageKey nor the auth url is exposed, which is exactly why they can
      // drift without anything noticing.
      expect(ours.storageKey).toBe((real as unknown as { storageKey: string }).storageKey);
      expect(ours.authUrl).toBe((real.auth as unknown as { url: string }).url);
    });
  }

  it('keys off the hostname, not the path, so two projects never collide', () => {
    const a = browserAuthConfig('https://aaaa.supabase.co');
    const b = browserAuthConfig('https://bbbb.supabase.co');
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(a.storageKey).toBe('sb-aaaa-auth-token');
  });
});

/**
 * The derivation test above proves we look in the right place. This one proves an
 * already-signed-in browser actually gets its session back out: it seeds a stored
 * session exactly as auth-js writes one, then reads it through both a full
 * supabase-js client and the auth-only client we now build, and requires the two
 * answers to be identical.
 *
 * That is the whole failure mode worth guarding. Anything that quietly switched
 * the client to in-memory storage — a changed default, a dropped
 * `persistSession`, a `storage` option we forgot to pass on — would return null
 * here, which in the app is indistinguishable from a logged-out visitor: no
 * error, no failed build, just the entire club bounced to the login screen after
 * a deploy.
 */
describe('the auth-only browser client recovers a stored session', () => {
  const URL_ = 'https://njzldypndkicpsmdtyll.supabase.co';
  const KEY = 'test-anon-key';
  const { authUrl, storageKey } = browserAuthConfig(URL_);

  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};

  beforeAll(() => {
    // auth-js only reaches for localStorage when isBrowser() is true, so the node
    // test environment has to look like a browser or BOTH clients fall back to
    // memory and the comparison passes for the wrong reason.
    for (const k of ['window', 'document', 'location', 'localStorage', 'addEventListener', 'removeEventListener', 'BroadcastChannel']) {
      saved[k] = g[k];
    }
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
    g.window = globalThis;
    g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
    g.location = { href: 'https://app.test/dashboard', hash: '', search: '', origin: 'https://app.test' };
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
    // Otherwise each client opens a real one and the run doesn't finish.
    delete g.BroadcastChannel;
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    store.clear();
  });

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  // An hour of life left, so neither client tries to refresh it over the network.
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: 'athlete-uuid', email: 'runner@example.test', exp, role: 'authenticated' }),
    'signature',
  ].join('.');
  // Built once, not per seed: the two clients are compared field by field, so a
  // `new Date()` inside the seeder would fail the run on a millisecond.
  const stored = JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh-abc',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: 'athlete-uuid',
      email: 'runner@example.test',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: { full_name: 'Test Runner' },
      created_at: new Date(exp * 1000 - 3600_000).toISOString(),
    },
  });

  function seed() {
    store.clear();
    store.set(storageKey, stored);
  }

  it('reads the same session supabase-js would, out of the same localStorage key', async () => {
    seed();
    const full = createClient(URL_, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const before = await full.auth.getSession();

    seed();
    // Same options src/lib/supabase/client.ts passes. (Constructing a second
    // client on one storage key logs auth-js's "multiple instances" warning —
    // that is this test holding two side by side, not something the app does.)
    const authOnly = new GoTrueClient({
      url: authUrl,
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'X-Client-Info': 'madregot-connect/test' },
      storageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    });
    const after = await authOnly.getSession();

    expect(before.error).toBeNull();
    expect(after.error).toBeNull();
    expect(after.data.session?.access_token).toBe(accessToken);
    expect(after.data.session?.user?.email).toBe('runner@example.test');
    expect(after.data.session).toEqual(before.data.session);
    // Not the in-memory fallback — the real adapter, which is what survives a reload.
    expect((authOnly as unknown as { storage: unknown }).storage).toBe(g.localStorage);
  });
});
