import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HANDOFF_STORAGE_KEY,
  HANDOFF_TTL_MS,
  challengeFor,
  clearPendingVerifier,
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
    });
  });

  it('still speaks plain "login" — every existing link and browser tab', () => {
    expect(loginState(null)).toBe('login');
    expect(loginState(undefined)).toBe('login');
    expect(parseLoginState('login')).toEqual({
      isLogin: true,
      challenge: null,
      linkAthleteId: null,
    });
  });

  it("keeps the coach's link-to-athlete state working", () => {
    // The regression to fear: state used to be compared with `!== 'login'`, so a
    // 'login:<challenge>' state would have been read as an athlete id and the
    // callback would have written Strava credentials onto athlete "login:...".
    const id = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81';
    expect(parseLoginState(id)).toEqual({ isLogin: false, challenge: null, linkAthleteId: id });
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
    });
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
