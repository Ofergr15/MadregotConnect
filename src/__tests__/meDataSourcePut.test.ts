import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDataSourcesPayload, mainSourcePatch } from '@/lib/data-sources/native';

/** PUT /api/me/data-source — self-only main source switch. */
let row: Record<string, unknown> | null;
const updates: { patch: unknown; id: unknown }[] = [];
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: async () => ({ ok: true, user: { athleteId: 'me' } }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({ update: (patch: unknown) => ({ eq: async (_c: string, id: unknown) => { updates.push({ patch, id }); Object.assign(row!, patch as object); return { error: null }; } }) }),
  }),
}));
vi.mock('@/lib/data-sources/server', () => ({
  readSourceRow: async () => row,
  loadDataSourcesStatus: async () => (row ? buildDataSourcesPayload(row as any, [], { state: 'none', imported: 0, reachedMonth: null }) : null),
}));
const { PUT } = await import('@/app/api/me/data-source/route');
const put = (body: unknown) => PUT(new Request('http://x/api/me/data-source', { method: 'PUT', body: JSON.stringify(body) }));

beforeEach(() => { updates.length = 0; row = { garmin_auth: 'G', strava_auth: 'S', data_source: 'garmin' }; });

describe('mainSourcePatch', () => {
  it('rejects unknown and unconnected sources', () => {
    expect(mainSourcePatch({ garmin_auth: 'G' }, 'polar')).toEqual({ error: 'unknown' });
    expect(mainSourcePatch({ garmin_auth: 'G' }, 'strava')).toEqual({ error: 'not_connected' });
    expect(mainSourcePatch({ strava_auth: 'S' }, 'strava')).toEqual({ patch: { data_source: 'strava' } });
  });
  it('primary honours data_source when that provider is connected', () => {
    const h = { state: 'none', imported: 0, reachedMonth: null } as const;
    expect(buildDataSourcesPayload({ garmin_auth: 'G', strava_auth: 'S', data_source: 'strava' }, [], h).primary).toBe('strava');
    expect(buildDataSourcesPayload({ garmin_auth: 'G', data_source: 'strava' }, [], h).primary).toBe('garmin');
  });
});

describe('PUT /api/me/data-source', () => {
  it('switches the caller and returns the GET status shape', async () => {
    const res = await put({ source: 'strava', athleteId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ patch: { data_source: 'strava' }, id: 'me' }]);
    const body = await res.json();
    expect(body.primary).toBe('strava');
    expect(body.garmin.state).toBe('connected');
  });
  it('400 for an unknown source', async () => {
    expect((await put({ source: 'coros' })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('409 when the source is not connected', async () => {
    row = { garmin_auth: 'G', strava_auth: null, data_source: 'garmin' };
    expect((await put({ source: 'strava' })).status).toBe(409);
    expect(updates).toHaveLength(0);
  });
});
