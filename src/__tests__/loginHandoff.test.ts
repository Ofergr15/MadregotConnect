import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HANDOFF_STORAGE_KEY,
  HANDOFF_TTL_MS,
  challengeFor,
  clearPendingVerifier,
  joinState,
  loginState,
  newVerifier,
  parseLoginState,
  readPendingVerifier,
  storePendingVerifier,
} from '../lib/auth/login-handoff';

describe('the verifier / challenge pair', () => {
  it('produces a 43-char base64url verifier — the shape both routes validate', () => {
    for (let i = 0; i < 20; i++) {
      expect(newVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('never repeats a verifier', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newVerifier()));
    expect(seen.size).toBe(200);
  });

  it('derives a challenge of the same shape, deterministically', async () => {
    const verifier = newVerifier();
    const challenge = await challengeFor(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await challengeFor(verifier)).toBe(challenge);
  });

  it('is SHA-256, not something reversible — a known vector', async () => {
    // base64url(SHA-256('verifier')). If this ever changes, every pending login
    // in the wild stops matching, so it is pinned.
    expect(await challengeFor('verifier')).toBe('iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ');
  });

  it('gives different verifiers different challenges', async () => {
    const [a, b] = [await challengeFor(newVerifier()), await challengeFor(newVerifier())];
    expect(a).not.toBe(b);
  });
});

describe('the OAuth state round trip', () => {
  it('carries the challenge, and parses back to it', () => {
    const challenge = 'A'.repeat(43);
    expect(loginState(challenge)).toBe(`login:${challenge}`);
    expect(parseLoginState(loginState(challenge))).toEqual({
      isLogin: true,
      challenge,
      linkAthleteId: null,
      joinToken: null,
    });
  });

  it('still speaks plain "login" — every existing link and browser tab', () => {
    expect(loginState(null)).toBe('login');
    expect(loginState(undefined)).toBe('login');
    expect(parseLoginState('login')).toEqual({
      isLogin: true,
      challenge: null,
      linkAthleteId: null,
      joinToken: null,
    });
  });

  it("keeps the coach's link-to-athlete state working", () => {
    // The regression to fear: state used to be compared with `!== 'login'`, so a
    // 'login:<challenge>' state would have been read as an athlete id and the
    // callback would have written Strava credentials onto athlete "login:...".
    const id = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81';
    expect(parseLoginState(id)).toEqual({
      isLogin: false,
      challenge: null,
      linkAthleteId: id,
      joinToken: null,
    });
    expect(parseLoginState(`login:${'A'.repeat(43)}`).linkAthleteId).toBeNull();
  });

  it('treats a malformed challenge as no challenge, never as a key', () => {
    // It arrives from a query string and is used as a primary key, so anything
    // that isn't a digest degrades to the old behaviour instead of failing.
    for (const bad of ['', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}+`, 'a/b']) {
      const parsed = parseLoginState(`login:${bad}`);
      expect(parsed.isLogin).toBe(true);
      expect(parsed.challenge).toBeNull();
    }
  });

  it('is null-safe', () => {
    expect(parseLoginState(null)).toEqual({
      isLogin: false,
      challenge: null,
      linkAthleteId: null,
      joinToken: null,
    });
  });
});

describe('the join state — finishing an invite with Strava', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // randomBytes(16).toString('hex')

  it('round-trips the invite token', () => {
    expect(joinState(TOKEN)).toBe(`join:${TOKEN}`);
    expect(parseLoginState(joinState(TOKEN))).toEqual({
      isLogin: false,
      challenge: null,
      linkAthleteId: null,
      joinToken: TOKEN,
    });
  });

  // The whole reason this branch is safe to leave open. The callback resolves an
  // athlete from `joinToken` and MINTS A SESSION for it, so anything that is not
  // an unguessable token we issued must resolve to no join at all. An athlete
  // uuid in that position would be a one-request account takeover — `state` is
  // attacker-craftable, since client_id is public and the redirect_uri is ours.
  it('refuses anything that is not a 32-char lowercase hex token', () => {
    const uuid = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81';
    const bad = [
      '',
      uuid,
      TOKEN.toUpperCase(),
      TOKEN.slice(0, 31),
      `${TOKEN}0`,
      `${TOKEN.slice(0, 31)}g`,
      'runner@madregot.local',
      "' or 1=1--",
    ];
    for (const value of bad) {
      const parsed = parseLoginState(`join:${value}`);
      expect(parsed.joinToken).toBeNull();
      // And it must not fall through into a branch that DOES act on it.
      expect(parsed.isLogin).toBe(false);
      expect(parsed.linkAthleteId).toBeNull();
    }
  });

  it('does not collide with the other three states', () => {
    expect(parseLoginState('login').joinToken).toBeNull();
    expect(parseLoginState(`login:${'A'.repeat(43)}`).joinToken).toBeNull();
    expect(parseLoginState('4e7d7c0f-3a13-4c86-a5f8-b103f1506f81').joinToken).toBeNull();
    // …and a join state is never read as an athlete id, which is what would let
    // the callback's link mode write credentials onto a row named "join:…".
    expect(parseLoginState(joinState(TOKEN)).linkAthleteId).toBeNull();
    expect(parseLoginState(joinState(TOKEN)).isLogin).toBe(false);
  });
});

describe('the pending verifier in the app partition', () => {
  // Same shape as firstRunOrder.test.ts: the suite runs in node, so localStorage
  // is stubbed rather than provided by an environment.
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips', () => {
    const verifier = newVerifier();
    storePendingVerifier(verifier);
    expect(readPendingVerifier()).toBe(verifier);
  });

  it('expires, so an abandoned login stops costing a request per foreground', () => {
    localStorage.setItem(
      HANDOFF_STORAGE_KEY,
      JSON.stringify({ verifier: newVerifier(), at: Date.now() - HANDOFF_TTL_MS - 1 }),
    );
    expect(readPendingVerifier()).toBeNull();
    expect(localStorage.getItem(HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it('survives right up to the deadline', () => {
    const verifier = newVerifier();
    localStorage.setItem(
      HANDOFF_STORAGE_KEY,
      JSON.stringify({ verifier, at: Date.now() - HANDOFF_TTL_MS + 5_000 }),
    );
    expect(readPendingVerifier()).toBe(verifier);
  });

  it('reads nothing out of junk rather than throwing on the login path', () => {
    localStorage.setItem(HANDOFF_STORAGE_KEY, 'not json');
    expect(readPendingVerifier()).toBeNull();
    localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify({ at: Date.now() }));
    expect(readPendingVerifier()).toBeNull();
  });

  it('clears', () => {
    storePendingVerifier(newVerifier());
    clearPendingVerifier();
    expect(readPendingVerifier()).toBeNull();
  });
});
