import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  NATIVE_LOGIN_RETURN,
  NATIVE_LOGIN_STATE_MAX_AGE_SECONDS,
  signNativeLoginState,
  verifyNativeLoginState,
} from '@/lib/auth/native-login-state';
import { GET as startStrava } from '@/app/api/strava/route';
import { GET as callback } from '@/app/api/strava/callback/route';

// Native "Sign in with Strava": the callback ends on madregot://auth/strava ONLY for a
// state this server signed; the URL carries no token (the app claims via claim-login).
const KEY = 'k'.repeat(40);
const CHALLENGE = 'A'.repeat(43);
const env: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'STRAVA_CLIENT_ID', 'NEXT_PUBLIC_APP_URL']) env[k] = process.env[k];
  process.env.ENCRYPTION_KEY = KEY;
  process.env.STRAVA_CLIENT_ID = '123';
  process.env.NEXT_PUBLIC_APP_URL = 'https://madregot.app';
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const stateOf = async (url: string) => {
  const res = await startStrava(new Request(url));
  const { authUrl } = await res.json();
  return new URL(authUrl).searchParams.get('state');
};
const deny = (state: string) =>
  callback(new Request(`https://madregot.app/api/strava/callback?error=access_denied&state=${encodeURIComponent(state)}`));

describe('native login state', () => {
  it('round-trips and expires', () => {
    const now = 1_800_000_000;
    const st = signNativeLoginState(CHALLENGE, now)!;
    expect(verifyNativeLoginState(st, now + 5)).toBe(CHALLENGE);
    expect(verifyNativeLoginState(st, now + NATIVE_LOGIN_STATE_MAX_AGE_SECONDS + 1)).toBeNull();
  });

  it('rejects tampering: other challenge, other key, bare prefix', () => {
    const st = signNativeLoginState(CHALLENGE)!;
    expect(verifyNativeLoginState(st.replace(CHALLENGE, 'B'.repeat(43)))).toBeNull();
    expect(verifyNativeLoginState(`nlogin.${CHALLENGE}.${Math.floor(Date.now() / 1000)}.forged`)).toBeNull();
    expect(verifyNativeLoginState(`login:${CHALLENGE}`)).toBeNull();
    process.env.ENCRYPTION_KEY = 'z'.repeat(40);
    expect(verifyNativeLoginState(st)).toBeNull();
  });

  it('refuses a bad challenge', () => {
    expect(signNativeLoginState('short')).toBeNull();
  });
});

describe('GET /api/strava', () => {
  it('native=1 mints a signed state', async () => {
    const st = await stateOf(`https://madregot.app/api/strava?mode=login&native=1&challenge=${CHALLENGE}`);
    expect(verifyNativeLoginState(st)).toBe(CHALLENGE);
  });

  it('native=1 without a challenge is a 400 (no token-in-URL fallback)', async () => {
    const res = await startStrava(new Request('https://madregot.app/api/strava?mode=login&native=1'));
    expect(res.status).toBe(400);
  });

  it('web login state is unchanged', async () => {
    expect(await stateOf('https://madregot.app/api/strava?mode=login')).toBe('login');
    expect(await stateOf(`https://madregot.app/api/strava?mode=login&challenge=${CHALLENGE}`)).toBe(`login:${CHALLENGE}`);
  });
});

describe('callback redirect target', () => {
  it('a signed native state returns to the fixed app URL with no token', async () => {
    const res = await deny(signNativeLoginState(CHALLENGE)!);
    const loc = res.headers.get('location')!;
    expect(loc.startsWith(`${NATIVE_LOGIN_RETURN}?result=denied`)).toBe(true);
    expect(loc).not.toMatch(/token/);
  });

  it('a tampered native state gets no custom-scheme redirect', async () => {
    const st = signNativeLoginState(CHALLENGE)!;
    for (const bad of [st.slice(0, -2) + 'xx', st.replace(CHALLENGE, 'B'.repeat(43)), `nlogin.${CHALLENGE}.1.x`]) {
      const loc = (await deny(bad)).headers.get('location')!;
      expect(loc.startsWith('madregot:')).toBe(false);
      expect(loc.startsWith('https://madregot.app/')).toBe(true);
    }
  });

  it('web login states are unchanged', async () => {
    for (const st of ['login', `login:${CHALLENGE}`]) {
      const loc = (await deny(st)).headers.get('location')!;
      expect(loc).toMatch(/^https:\/\/madregot\.app\/\?strava=error&reason=denied/);
    }
  });

  it('native success parks the login and never builds the session fragment for the app', () => {
    const src = readFileSync('src/app/api/strava/callback/route.ts', 'utf8');
    expect(src).toMatch(/if \(nativeLogin\) return NextResponse\.redirect\(nativeLoginReturn\('ok', debugId\)\)/);
    expect(src).toMatch(/if \(nativeLogin\) \{[\s\S]{0,200}nativeLoginReturn\('error', debugId\)/);
  });
});
