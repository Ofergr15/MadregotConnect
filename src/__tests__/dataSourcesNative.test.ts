import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDataSourcesPayload,
  disconnectPatch,
  garminNativeServiceUrl,
  garminSsoSignInUrl,
  isPlausibleGarminTicket,
  nativeState,
  nativeStravaAthleteId,
  nextGarminSync,
  syncNowRetryAfter,
} from '@/lib/data-sources/native';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const ID = '0b3c1a52-6f7e-4c41-9b0a-1234567890ab';

describe('native data sources — status', () => {
  it('never carries the credential blobs, only states and timestamps', () => {
    const p = buildDataSourcesPayload(
      { garmin_auth: 'SECRET-BLOB', strava_auth: 'OTHER-BLOB', garmin_last_sync_at: '2026-11-21T09:50:00Z', garmin_connected_via: 'sso' },
      [],
      { state: 'importing', imported: 40, reachedMonth: '2025-03' },
      NOW,
    );
    const json = JSON.stringify(p);
    expect(json).not.toContain('SECRET-BLOB');
    expect(json).not.toContain('OTHER-BLOB');
    expect(p.garmin.state).toBe('connected');
    expect(p.garmin.connectedVia).toBe('sso');
    expect(p.primary).toBe('garmin');
  });

  it('maps a failed credential to needs_reauth and stale to connected', () => {
    expect(nativeState('failed')).toBe('needs_reauth');
    expect(nativeState('stale')).toBe('connected');
    expect(nativeState('none')).toBe('not_connected');
  });

  it('shows no history or timestamps for a disconnected Garmin', () => {
    const p = buildDataSourcesPayload({ garmin_auth: null, garmin_last_sync_at: '2026-11-01T00:00:00Z' }, [], { state: 'complete', imported: 9, reachedMonth: '2024-01' }, NOW);
    expect(p.garmin).toMatchObject({ state: 'not_connected', lastSyncAt: null, nextSyncAt: null });
    expect(p.history.state).toBe('none');
  });

  it('next sync is in the future', () => {
    const next = nextGarminSync('2026-11-21T08:00:00Z', NOW)!;
    expect(Date.parse(next)).toBeGreaterThan(NOW);
  });
});

describe('native data sources — sync now', () => {
  it('limits to one a minute across instance memory and DB stamps', () => {
    expect(syncNowRetryAfter(NOW - 10_000, [], NOW)).toBe(50);
    expect(syncNowRetryAfter(undefined, [new Date(NOW - 30_000).toISOString()], NOW)).toBe(30);
    expect(syncNowRetryAfter(undefined, [null, '2026-11-20T00:00:00Z'], NOW)).toBe(0);
  });
});

describe('native data sources — disconnect', () => {
  it('nulls the Garmin credential and hands data_source to a live Strava', () => {
    expect(disconnectPatch('garmin', { garmin_auth: 'x', strava_auth: 'y', data_source: 'garmin' }))
      .toEqual({ garmin_auth: null, garmin_last_sync_at: null, garmin_auth_failed_at: null, data_source: 'strava' });
  });
  it('does not claim a source that is not connected', () => {
    expect(disconnectPatch('garmin', { garmin_auth: 'x', data_source: 'garmin' })).not.toHaveProperty('data_source');
    expect(disconnectPatch('strava', { strava_auth: 'y', data_source: 'strava' })).not.toHaveProperty('data_source');
  });
});

describe('native data sources — SSO and Strava handoff', () => {
  it('service URL is server-fixed and embedded in the sign-in URL', () => {
    const svc = garminNativeServiceUrl('https://www.madregot.app/');
    expect(svc).toBe('https://www.madregot.app/api/garmin/sso-callback/app');
    expect(new URL(garminSsoSignInUrl(svc)).searchParams.get('service')).toBe(svc);
  });
  it('shape-checks tickets', () => {
    expect(isPlausibleGarminTicket('ST-0123456-abcdefGHIJ-cas')).toBe(true);
    expect(isPlausibleGarminTicket('ST-1&x=y')).toBe(false);
    expect(isPlausibleGarminTicket(42)).toBe(false);
  });
  it('only an app:<uuid> state is a native Strava link', () => {
    expect(nativeStravaAthleteId(`app:${ID}`)).toBe(ID);
    expect(nativeStravaAthleteId(ID)).toBeNull();
    expect(nativeStravaAthleteId('app:login')).toBeNull();
  });
});

describe('native data-sources routes are self-only', () => {
  const dir = join(__dirname, '../app/api/me/data-sources');
  const routes = ['route.ts', 'garmin/sso/route.ts', 'garmin/ticket/route.ts', 'garmin/password/route.ts', 'strava/route.ts', 'sync/route.ts', 'disconnect/route.ts'];
  for (const r of routes) {
    it(`${r} takes identity from the JWT and never returns the blob`, () => {
      const src = readFileSync(join(dir, r), 'utf8');
      expect(src).toContain('requireAthlete(request)');
      expect(src).not.toMatch(/athleteId\s*[:=]\s*body|searchParams\.get\('athlete/);
      expect(src).not.toMatch(/json\(\{[^}]*\bauth:\s*encrypt/);
      expect(src).not.toMatch(/console\.\w+\([^)]*\b(password|ticket)\b\s*[,)]/);
    });
  }
});
