import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signLinkState, verifyLinkState, LINK_STATE_MAX_AGE_SECONDS } from '@/lib/strava/link-state';
import { parseLoginState } from '@/lib/auth/login-handoff';

const KEY = 'k'.repeat(40);
let saved: string | undefined;
beforeEach(() => { saved = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = KEY; });
afterEach(() => { process.env.ENCRYPTION_KEY = saved; });

describe('Strava link state', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('round-trips the athlete id', () => {
    const st = signLinkState(id, 1000)!;
    expect(st.startsWith('link.')).toBe(true);
    expect(verifyLinkState(st, 1000 + 5)).toBe(id);
  });
  it('a bare athlete id (the old state) is refused', () => {
    expect(verifyLinkState(id)).toBeNull();
  });
  it('a tampered id or signature is refused', () => {
    const st = signLinkState(id, 1000)!;
    const [p, b, t, n, sig] = st.split('.');
    const otherId = Buffer.from('00000000-0000-4000-8000-000000000002').toString('base64url');
    expect(verifyLinkState([p, otherId, t, n, sig].join('.'), 1001)).toBeNull();
    expect(verifyLinkState([p, b, t, n, sig.slice(0, -2) + 'AA'].join('.'), 1001)).toBeNull();
  });
  it('expires after 10 minutes and refuses a state issued in the future', () => {
    const st = signLinkState(id, 1000)!;
    expect(verifyLinkState(st, 1000 + LINK_STATE_MAX_AGE_SECONDS)).toBe(id);
    expect(verifyLinkState(st, 1000 + LINK_STATE_MAX_AGE_SECONDS + 1)).toBeNull();
    expect(verifyLinkState(signLinkState(id, 5000)!, 1000)).toBeNull();
  });
  it('a different key refuses it, and no usable key fails closed both ways', () => {
    const st = signLinkState(id, 1000)!;
    process.env.ENCRYPTION_KEY = 'x'.repeat(40);
    expect(verifyLinkState(st, 1001)).toBeNull();
    process.env.ENCRYPTION_KEY = 'short';
    expect(signLinkState(id)).toBeNull();
    expect(verifyLinkState(st)).toBeNull();
  });
  it('login and join states are still parsed as before, and a link state is not login', () => {
    expect(parseLoginState('login').isLogin).toBe(true);
    expect(parseLoginState('join:' + 'a'.repeat(32)).isLogin).toBe(false);
    expect(parseLoginState(signLinkState(id)!).isLogin).toBe(false);
  });
});

import { reserveLinkState, consumeLinkState } from '@/lib/strava/link-state';
import { createMemoryDb } from './helpers/memory-db';

describe('Strava link state: one-use reservation', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const fresh = () => createMemoryDb({ schema: { app_settings: ['key', 'value', 'updated_at'] }, unique: { app_settings: [['key']] } });
  it('two consumes of one reservation: exactly one succeeds', async () => {
    const db = fresh();
    const st = signLinkState(id)!;
    expect(await reserveLinkState(db.client, st, id)).toBe(true);
    const results = await Promise.all([consumeLinkState(db.client, st, id), consumeLinkState(db.client, st, id)]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'not_found')).toHaveLength(1);
    expect(db.tables.app_settings).toHaveLength(0);
  });
  it('a reservation is athlete-specific', async () => {
    const db = fresh();
    const st = signLinkState(id)!;
    await reserveLinkState(db.client, st, id);
    expect(await consumeLinkState(db.client, st, 'someone-else')).toBe('not_found');
    expect(await consumeLinkState(db.client, st, id)).toBe('ok');
  });
  it('fails closed when the store errors (no table) on reserve and on consume', async () => {
    const db = createMemoryDb({ schema: {} });
    const st = signLinkState(id)!;
    expect(await reserveLinkState(db.client, st, id)).toBe(false);
    expect(await consumeLinkState(db.client, st, id)).toBe('error');
  });
  it('a non-link state never reserves', async () => {
    expect(await reserveLinkState(fresh().client, 'login', id)).toBe(false);
  });
  it('one outstanding reservation per athlete: a new one replaces the old (no row pile-up)', async () => {
    const db = fresh();
    const first = signLinkState(id)!;
    const second = signLinkState(id)!;
    await reserveLinkState(db.client, first, id);
    await reserveLinkState(db.client, second, id);
    await reserveLinkState(db.client, signLinkState('other')!, 'other');
    expect(db.tables.app_settings).toHaveLength(2);
    expect(await consumeLinkState(db.client, first, id)).toBe('not_found');
    expect(await consumeLinkState(db.client, second, id)).toBe('ok');
  });
  it('the sweep touches only its own keys, never look-alikes (no LIKE wildcard in the prefix)', async () => {
    const db = fresh();
    const old = new Date(Date.now() - 3600_000).toISOString();
    db.tables.app_settings.push(
      { key: 'strava_link:x', value: id, updated_at: old },
      { key: 'strava-link:config', value: 'keep', updated_at: old },
      { key: 'stravalink:stale', value: 'gone', updated_at: old },
    );
    await reserveLinkState(db.client, signLinkState('z')!, 'z');
    const keys = db.tables.app_settings.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['strava_link:x', 'strava-link:config']));
    expect(keys).not.toContain('stravalink:stale');
  });
});
