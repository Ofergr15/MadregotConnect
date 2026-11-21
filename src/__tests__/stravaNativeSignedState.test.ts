import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { signLinkState, reserveLinkState, readLinkReturn, verifyLinkState } from '@/lib/strava/link-state';
import { createMemoryDb } from './helpers/memory-db';

// The native app's Strava connect used an unsigned `app:<athleteId>` state, so anyone could
// build an authorize URL naming someone else's id and have their own Strava written onto that
// member (and then sign in as them). It now goes through the same signed, single-use link state
// as the web, with the reservation remembering that the answer returns to the app.
const KEY = 'k'.repeat(40);
let saved: string | undefined;
beforeEach(() => { saved = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = KEY; });
afterEach(() => { process.env.ENCRYPTION_KEY = saved; });

const id = '00000000-0000-4000-8000-000000000001';
const fresh = () => createMemoryDb({ schema: { app_settings: ['key', 'value', 'updated_at'] }, unique: { app_settings: [['key']] } });

describe('native Strava connect uses a signed link state', () => {
  it("a reservation made for the app reads back as 'app'", async () => {
    const db = fresh();
    const st = signLinkState(id)!;
    expect(await reserveLinkState(db.client, st, id, 'app')).toBe(true);
    expect(await readLinkReturn(db.client, st)).toBe('app');
  });

  it('a bare app:<id> state is not a valid link state', () => {
    expect(verifyLinkState(`app:${id}`)).toBeNull();
  });

  it('the native route mints a signed, reserved state instead of app:<id>', () => {
    const src = readFileSync('src/app/api/me/data-sources/strava/route.ts', 'utf8');
    expect(src).toMatch(/signLinkState\(athleteId\)/);
    expect(src).toMatch(/reserveLinkState\(.*'app'\)/);
    expect(src).not.toMatch(/NATIVE_STRAVA_STATE_PREFIX/);
  });

  it('the callback no longer trusts the app: prefix', () => {
    const src = readFileSync('src/app/api/strava/callback/route.ts', 'utf8');
    expect(src).not.toMatch(/nativeStravaAthleteId/);
    expect(src).toMatch(/fromApp = \(await readLinkReturn/);
  });
});
