import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCourseGpxUrl } from '@/lib/events';

/** V11: an event's course map (events.course_gpx_url, migration 200 — not applied yet). */

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { isStaff: true, athleteId: 'coach-1' } }),
  authError: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/push', () => ({ resolveAudience: async () => [], sendPushLocalized: vi.fn() }));
let written: Record<string, unknown> | null = null;
let dbError: unknown = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      let writing = false;
      for (const m of ['select', 'eq']) c[m] = () => c;
      c.insert = (r: Record<string, unknown>) => { written = r; writing = true; return c; };
      c.update = (r: Record<string, unknown>) => { written = r; writing = true; return c; };
      // The schema error belongs to the write; PATCH first reads the current row (events v2).
      c.single = async () => (writing && dbError ? { data: null, error: dbError } : { data: { id: 'e1', ...written }, error: null });
      c.maybeSingle = c.single;
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/events/route');
const { PATCH } = await import('@/app/api/events/[id]/route');
const BASE = { kind: 'race', name: 'Valencia', date: '2026-12-06', location: 'Valencia' };
const post = (b: object) => POST(new Request('http://x/api/events', { method: 'POST', body: JSON.stringify(b) }));
const patch = (b: object) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) }), { params: Promise.resolve({ id: 'e1' }) });

beforeEach(() => { written = null; dbError = null; });

describe('isCourseGpxUrl', () => {
  it('https URL or null only', () => {
    expect(isCourseGpxUrl('https://x.supabase.co/storage/v1/object/public/c/valencia.gpx')).toBe(true);
    expect(isCourseGpxUrl(null)).toBe(true);
    for (const v of ['http://x/a.gpx', 'javascript:alert(1)', 'not a url', '', 5, {}, `https://x/${'a'.repeat(2001)}`]) expect(isCourseGpxUrl(v)).toBe(false);
  });
});

describe('POST /api/events', () => {
  it('without course_gpx_url the insert has no such key (works before migration 200)', async () => {
    expect((await post(BASE)).status).toBe(200);
    expect(written).not.toHaveProperty('course_gpx_url');
  });
  it('a valid URL is stored; an invalid one is 400 and nothing is written', async () => {
    await post({ ...BASE, course_gpx_url: 'https://cdn.example/v.gpx' });
    expect(written).toMatchObject({ course_gpx_url: 'https://cdn.example/v.gpx' });
    written = null;
    const res = await post({ ...BASE, course_gpx_url: 'http://cdn.example/v.gpx' });
    expect(res.status).toBe(400);
    expect(written).toBeNull();
  });
});

describe('PATCH /api/events/[id]', () => {
  it('sets and clears the course map', async () => {
    expect((await patch({ course_gpx_url: 'https://cdn.example/v.gpx' })).status).toBe(200);
    expect(written).toMatchObject({ course_gpx_url: 'https://cdn.example/v.gpx' });
    await patch({ course_gpx_url: null });
    expect(written).toMatchObject({ course_gpx_url: null });
  });
  it('an invalid URL is 400', async () => {
    expect((await patch({ course_gpx_url: 'ftp://x' })).status).toBe(400);
    expect(written).toBeNull();
  });
  it('before migration 200: 503 naming the migration, not a 500', async () => {
    dbError = { code: '42703', message: 'column "course_gpx_url" does not exist' };
    const res = await patch({ course_gpx_url: 'https://cdn.example/v.gpx' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'migration 200 not applied' });
  });
});
