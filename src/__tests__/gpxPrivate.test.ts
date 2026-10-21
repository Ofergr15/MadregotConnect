import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { gpxPathOf, gpxRef, gpxHref } from '@/lib/strava/gpx-store';

// Legal item 4 (2026-10-21): a member's GPX — where they run — is in a private bucket,
// and only its owner downloads it, through a link that lasts a minute.
describe('where a GPX lives', () => {
  it('a reference, or an old public link, both read as the same path', () => {
    expect(gpxPathOf(gpxRef('a1/123.gpx'))).toBe('a1/123.gpx');
    expect(gpxPathOf('https://x.supabase.co/storage/v1/object/public/run-chat/a1/123.gpx')).toBe('a1/123.gpx');
    expect(gpxPathOf('https://elsewhere/file.gpx')).toBeNull();
    expect(gpxPathOf(null)).toBeNull();
  });
  it('nothing writes or links a public GPX any more', () => {
    expect(fs.readFileSync('src/lib/strava/enrich.ts', 'utf8')).not.toMatch(/getPublicUrl\(gpxPath\)/);
    expect(fs.readFileSync('src/components/run-chat/StravaRunCard.tsx', 'utf8')).toMatch(/href=\{gpxHref\(attachment\.run\.id\)\}/);
    expect(gpxHref('abc')).toBe('/api/activities/gpx?activityId=abc');
  });
});

let caller: { athleteId: string; isSuperUser: boolean };
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { athlete_id: 'owner', strava_gpx_url: gpxRef('owner/9.gpx') } }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async (path: string, sec: number) => ({ data: { signedUrl: `https://signed/${path}?t=${sec}` }, error: null }) }) },
  }),
}));
const { GET } = await import('@/app/api/activities/gpx/route');
const ID = '11111111-2222-3333-4444-555555555555';
const req = () => new Request(`http://x/api/activities/gpx?activityId=${ID}`);

describe('the download', () => {
  it('the owner gets a link that lasts a minute', async () => {
    caller = { athleteId: 'owner', isSuperUser: false };
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://signed/owner/9.gpx?t=60');
  });
  it('a teammate, or a coach, gets nothing', async () => {
    caller = { athleteId: 'teammate', isSuperUser: false };
    expect((await GET(req())).status).toBe(404);
  });
});
