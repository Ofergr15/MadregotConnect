import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDeviceToken, signDeviceToken } from '@/lib/auth/device-token';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const EMAIL = 'coach@madregot.club';
const NOW = 1_756_000_000_000; // fixed clock; Date.now() is unavailable in some runners

describe('device token', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  it('round-trips the email it was signed for', () => {
    const token = signDeviceToken(EMAIL, NOW)!;
    expect(readDeviceToken(token, NOW)).toBe(EMAIL);
  });

  it('normalises case and whitespace', () => {
    const token = signDeviceToken('  Coach@Madregot.Club  ', NOW)!;
    expect(readDeviceToken(token, NOW)).toBe(EMAIL);
  });

  it('rejects a token signed with a different key', () => {
    const token = signDeviceToken(EMAIL, NOW)!;
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    expect(readDeviceToken(token, NOW)).toBeNull();
  });

  // The whole point of the cookie: the email must not be attacker-controlled.
  it('rejects a token whose email payload was swapped', () => {
    const token = signDeviceToken('runner@madregot.club', NOW)!;
    const [v, , iat, mac] = token.split('.');
    const forgedPayload = Buffer.from('admin@madregot.club', 'utf8').toString('base64url');
    expect(readDeviceToken(`${v}.${forgedPayload}.${iat}.${mac}`, NOW)).toBeNull();
  });

  it('rejects a token whose timestamp was swapped', () => {
    const token = signDeviceToken(EMAIL, NOW)!;
    const [v, payload, , mac] = token.split('.');
    expect(readDeviceToken(`${v}.${payload}.${NOW + 5000}.${mac}`, NOW)).toBeNull();
  });

  it('rejects malformed, empty and missing tokens', () => {
    for (const bad of [undefined, null, '', 'garbage', 'v1.a.b', 'v1.a.b.c.d']) {
      expect(readDeviceToken(bad as string | undefined, NOW)).toBeNull();
    }
  });

  it('rejects a token older than a year', () => {
    const token = signDeviceToken(EMAIL, NOW)!;
    const yearAndADay = 366 * 24 * 60 * 60 * 1000;
    expect(readDeviceToken(token, NOW + yearAndADay)).toBeNull();
    // still good just inside the window
    expect(readDeviceToken(token, NOW + 364 * 24 * 60 * 60 * 1000)).toBe(EMAIL);
  });

  it('rejects a token stamped in the future beyond clock skew', () => {
    const token = signDeviceToken(EMAIL, NOW + 5 * 60_000)!;
    expect(readDeviceToken(token, NOW)).toBeNull();
    // a few seconds of skew is tolerated
    expect(readDeviceToken(signDeviceToken(EMAIL, NOW + 5_000)!, NOW)).toBe(EMAIL);
  });

  it('fails closed when ENCRYPTION_KEY is missing or too short', () => {
    const token = signDeviceToken(EMAIL, NOW)!;
    delete process.env.ENCRYPTION_KEY;
    expect(signDeviceToken(EMAIL, NOW)).toBeNull();
    expect(readDeviceToken(token, NOW)).toBeNull();

    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(signDeviceToken(EMAIL, NOW)).toBeNull();
    expect(readDeviceToken(token, NOW)).toBeNull();
  });
});
