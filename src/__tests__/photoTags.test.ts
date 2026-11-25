// b23 — manual photo tags (migration 214, flag photos_social). No face recognition.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { initialStatus, mayApprove, mayRemove, project, visibleTo, type PhotoTagRow } from '@/lib/photos/tags';
import { selectFileIds } from '@/lib/quality-session/photos-server';

const me = { athleteId: 'me', isStaff: false };
const coach = { athleteId: 'coach', isStaff: true };
const row = (o: Partial<PhotoTagRow>): PhotoTagRow => ({
  id: 't', photo_id: 'PHOTO_000001', folder_id: 'FOLDER_00001', athlete_id: 'me', tagged_by: 'me',
  status: 'approved', created_at: '', approved_at: null, ...o,
});

describe('photo tag rules', () => {
  it('self-tag is approved; tagging someone else waits for them', () => {
    expect(initialStatus(me, 'me')).toBe('approved');
    expect(initialStatus(me, 'dana')).toBe('pending');
    expect(initialStatus(coach, 'dana')).toBe('pending');   // staff too: the tagged person decides
  });
  it('the tagged person can always remove; the tagger only while pending; staff always', () => {
    expect(mayRemove(me, row({ athlete_id: 'me', tagged_by: 'dana', status: 'approved' }))).toBe(true);
    expect(mayRemove(me, row({ athlete_id: 'dana', tagged_by: 'me', status: 'pending' }))).toBe(true);
    expect(mayRemove(me, row({ athlete_id: 'dana', tagged_by: 'me', status: 'approved' }))).toBe(false);
    expect(mayRemove(me, row({ athlete_id: 'dana', tagged_by: 'yoni', status: 'approved' }))).toBe(false);
    expect(mayRemove(coach, row({ athlete_id: 'dana', tagged_by: 'yoni' }))).toBe(true);
  });
  it('only the tagged person approves', () => {
    expect(mayApprove(me, row({ athlete_id: 'me' }))).toBe(true);
    expect(mayApprove(coach, row({ athlete_id: 'me' }))).toBe(false);
  });
  it('a pending tag is seen only by the tagged person and the tagger', () => {
    const p = row({ athlete_id: 'dana', tagged_by: 'yoni', status: 'pending' });
    expect(visibleTo(me, p)).toBe(false);
    expect(visibleTo(coach, p)).toBe(false);
    expect(visibleTo({ athleteId: 'dana', isStaff: false }, p)).toBe(true);
    expect(visibleTo({ athleteId: 'yoni', isStaff: false }, p)).toBe(true);
  });
  it('projection carries a name, never contact fields or the tagger id', () => {
    const out = project(me, [row({})], new Map([['me', 'Dana Levi']]));
    expect(out).toEqual([{ photoId: 'PHOTO_000001', folderId: 'FOLDER_00001', athleteId: 'me', name: 'Dana Levi', status: 'approved', mine: true, byMe: true }]);
  });
});

describe('approve fileIds selection', () => {
  it('keeps only files in the folder, de-duplicated, in pick order, capped', () => {
    expect(selectFileIds(['a', 'b', 'c', 'd'], ['c', 'x', 'a', 'c', 'd'], 2)).toEqual(['c', 'a']);
    expect(selectFileIds(['a'], ['x'], 10)).toEqual([]);
  });
});

describe('migration 214', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/214_photo_tags_likes.sql', import.meta.url), 'utf8');
  it('is idempotent, RLS on, status constrained, one tag per person per photo', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS photo_tags/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CHECK \(status IN \('pending', 'approved'\)\)/);
    expect(sql).toMatch(/UNIQUE \(photo_id, athlete_id\)/);
    expect(sql).not.toMatch(/(CREATE|ALTER) TABLE[^;]*(detected_faces|athlete_faces|run_photos)/i);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
let flagOn = true;
let caller: any = { athleteId: 'me', isStaff: false, isSuperUser: false };
let rows: PhotoTagRow[] = [];
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async (k: string) => k === 'photos_social' && flagOn }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/photos/drive-browse', () => ({
  listFolderPhotos: async (id: string) => id === 'FOLDER_00001'
    ? { folder: { id, date: '2026-11-24' }, photos: [{ id: 'PHOTO_000001' }], videos: [] } : null,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const f: Array<(r: any) => boolean> = [];
      let op: 'select' | 'delete' = 'select';
      const q: any = {
        select: () => q, order: () => q, limit: () => q, in: () => q,
        eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
        delete: () => { op = 'delete'; return q; },
        maybeSingle: async () => ({ data: table === 'athletes' ? { id: 'dana', status: 'active' } : rows.find((r) => f.every((g) => g(r))) ?? null, error: null }),
        then: (ok: any) => {
          if (op === 'delete') { rows = rows.filter((r) => !f.every((g) => g(r))); return ok({ error: null }); }
          return ok({ data: table === 'athletes' ? [{ id: 'dana', name: 'Dana' }] : rows.filter((r) => f.every((g) => g(r))), error: null });
        },
      };
      return q;
    },
  }),
}));

const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/photos/tags${qs}`, { method, body: body ? JSON.stringify(body) : undefined });

describe('/api/photos/tags', () => {
  beforeEach(() => { flagOn = true; caller = { athleteId: 'me', isStaff: false, isSuperUser: false }; rows = []; });

  it('404 while the flag is off', async () => {
    flagOn = false;
    const { GET } = await import('@/app/api/photos/tags/route');
    expect((await GET(req('GET', undefined, '?folderId=FOLDER_00001'))).status).toBe(404);
  });
  it('a teammate never sees someone else’s pending tag', async () => {
    rows = [row({ athlete_id: 'dana', tagged_by: 'yoni', status: 'pending' }), row({ id: 't2', photo_id: 'PHOTO_000002', athlete_id: 'dana', tagged_by: 'dana' })];
    const { GET } = await import('@/app/api/photos/tags/route');
    const j = await (await GET(req('GET', undefined, '?folderId=FOLDER_00001'))).json();
    expect(j.tags.map((t: any) => t.photoId)).toEqual(['PHOTO_000002']);
  });
  it('tagging a photo outside the library is 404', async () => {
    const { POST } = await import('@/app/api/photos/tags/route');
    expect((await POST(req('POST', { photoId: 'PHOTO_999999', folderId: 'FOLDER_00001', athleteId: 'dana' }))).status).toBe(404);
  });
  it('a member cannot remove an approved tag of someone else', async () => {
    rows = [row({ athlete_id: 'dana', tagged_by: 'me', status: 'approved' })];
    const { DELETE } = await import('@/app/api/photos/tags/route');
    expect((await DELETE(req('DELETE', { photoId: 'PHOTO_000001', athleteId: 'dana' }))).status).toBe(403);
    expect(rows).toHaveLength(1);
  });
  it('the tagged person removes it', async () => {
    rows = [row({ athlete_id: 'me', tagged_by: 'dana', status: 'approved' })];
    const { DELETE } = await import('@/app/api/photos/tags/route');
    expect((await DELETE(req('DELETE', { photoId: 'PHOTO_000001', athleteId: 'me' }))).status).toBe(200);
    expect(rows).toHaveLength(0);
  });
});

describe('likes', () => {
  it('counts per media and marks mine, without returning who', async () => {
    const { likeCounts } = await import('@/lib/photos/tags');
    const out = likeCounts([{ media_id: 'A', athlete_id: 'me' }, { media_id: 'A', athlete_id: 'dana' }, { media_id: 'B', athlete_id: 'dana' }], 'me');
    expect(out).toEqual({ A: { count: 2, mine: true }, B: { count: 1, mine: false } });
    expect(JSON.stringify(out)).not.toContain('dana');
  });
  it('migration adds photo_likes with RLS and one like per person', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/214_photo_tags_likes.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS photo_likes/);
    expect(sql).toMatch(/PRIMARY KEY \(media_id, athlete_id\)/);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
  });
});

// QA 25.11 #1: the routes queried `photos_social` (the flag's name) and 503'd forever. The in-memory DB
// does not check table names against migrations, so pin every `.from()` in the tag routes to 214's table.
describe('photo tag routes — table name matches migration 214', () => {
  it('every from() in /api/photos/tags* names the table 214 creates', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/214_photo_tags_likes.sql', import.meta.url), 'utf8');
    const created = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
    expect(created.has('photo_tags')).toBe(true);
    const files = ['route.ts', 'approve/route.ts', 'mine/route.ts'];
    let n = 0;
    for (const f of files) {
      const src = readFileSync(new URL(`../app/api/photos/tags/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from\('photos_social'\)/);   // the flag's name, not a table
      n += (src.match(/\.from\('photo_tags'\)/g) || []).length;
    }
    expect(n).toBe(7);
  });
});
