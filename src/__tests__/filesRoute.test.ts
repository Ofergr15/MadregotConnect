import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const caller = vi.hoisted(() => ({ current: null as null | { isStaff: boolean; isSuperUser: boolean } }));
const signCalls = vi.hoisted(() => [] as Array<[string, string, number]>);

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () =>
    caller.current
      ? { denied: null, caller: caller.current }
      : { denied: new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401 }), caller: {} },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          signCalls.push([bucket, path, ttl]);
          return { data: { signedUrl: `https://eu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t${signCalls.length}` }, error: null };
        },
      }),
    },
  }),
}));
// One staff-only bucket, to pin the staff gate (none of today's served buckets is staff-only).
vi.mock('@/lib/storage/buckets', async (orig) => {
  const real = await orig<typeof import('@/lib/storage/buckets')>();
  return {
    ...real,
    servedObject: (bucket: string, segments: string[]) =>
      bucket === 'coach-only' ? { bucket, access: 'staff', path: segments.join('/') } : real.servedObject(bucket, segments),
  };
});

import { GET } from '@/app/api/files/[bucket]/[...path]/route';
import { POST as mint } from '@/app/api/files/session/route';
import { GET as nativePdf } from '@/app/api/native/storage/program-plans/[folder]/[file]/route';
import { FILES_COOKIE, signFilesCookie, signedLinkFor, verifyFilesCookie } from '@/lib/storage/file-access';

const get = (bucket: string, path: string[], headers: Record<string, string> = {}) =>
  GET(new Request(`https://www.madregot.app/api/files/${bucket}/${path.join('/')}`, { headers }), { params: Promise.resolve({ bucket, path }) });
const cookie = (level: 'member' | 'staff') => ({ cookie: `other=1; ${FILES_COOKIE}=${signFilesCookie(level)}` });

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', 'k'.repeat(40));
  caller.current = null;
  signCalls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/files/[bucket]/[...path]', () => {
  it('401 with no session and no cookie, and nothing is signed', async () => {
    const res = await get('avatars', ['a', 'b.jpg']);
    expect(res.status).toBe(401);
    expect(signCalls).toEqual([]);
  });

  it('401 for a forged, expired or other-key cookie', async () => {
    const good = signFilesCookie('member')!;
    const [exp, lvl] = good.split('.');
    const expired = signFilesCookie('member', Date.now() - 8 * 86400_000)!;
    const forged = `${exp}.s.${good.split('.')[2]}`;
    for (const v of [forged, expired, `${exp}.${lvl}.AAAAAAAAAAAAAAAAAAAAAAAA`, 'junk']) {
      expect((await get('avatars', ['x.jpg'], { cookie: `${FILES_COOKIE}=${v}` })).status).toBe(401);
    }
  });

  it('member by cookie → 302 to a ten-minute signed URL', async () => {
    const res = await get('feed-media', ['posts', 'p 1.jpg'], cookie('member'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^https:\/\/eu\.supabase\.co\/storage\/v1\/object\/sign\/feed-media\/posts\/p%201\.jpg\?token=/);
    expect(signCalls).toEqual([['feed-media', 'posts/p 1.jpg', 600]]);
  });

  it('member by bearer token → 302; a rejected token is the gate’s own answer', async () => {
    caller.current = { isStaff: false, isSuperUser: false };
    expect((await get('avatars', ['a.jpg'], { authorization: 'Bearer t' })).status).toBe(302);
    caller.current = null;
    expect((await get('avatars', ['a.jpg'], { authorization: 'Bearer dead', ...cookie('member') })).status).toBe(401);
  });

  it('404 for a public, unknown or own-route bucket, or a traversal — before any auth', async () => {
    for (const [b, p] of [['notification-images', ['n.png']], ['face-crops', ['f.jpg']], ['nope', ['a']], ['avatars', ['..', 'x']]] as const) {
      expect((await get(b, [...p], cookie('member'))).status).toBe(404);
    }
    expect((await get('nope', ['a'])).status).toBe(404);
  });

  it('staff-only content: member 403, staff 302 (cookie or bearer)', async () => {
    expect((await get('coach-only', ['plan.pdf'], cookie('member'))).status).toBe(403);
    expect((await get('coach-only', ['plan.pdf'], cookie('staff'))).status).toBe(302);
    caller.current = { isStaff: false, isSuperUser: true };
    expect((await get('coach-only', ['plan.pdf'], { authorization: 'Bearer t' })).status).toBe(302);
  });
});

describe('POST /api/files/session', () => {
  it('mints an httpOnly cookie scoped to /api/files for a verified caller only', async () => {
    expect((await mint(new Request('https://x/api/files/session', { method: 'POST' }))).status).toBe(401);
    caller.current = { isStaff: true, isSuperUser: false };
    const res = await mint(new Request('https://x/api/files/session', { method: 'POST', headers: { authorization: 'Bearer t' } }));
    const set = res.headers.get('set-cookie') || '';
    expect(set).toMatch(new RegExp(`^${FILES_COOKIE}=`));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Path=\/api\/files/);
    expect(verifyFilesCookie(set.split(';')[0].split('=')[1])).toBe('staff');
  });
});

describe('native program PDF route', () => {
  const pdf = (folder: string, file: string, headers: Record<string, string> = {}) =>
    nativePdf(new Request('https://www.madregot.app/x', { headers }), { params: Promise.resolve({ folder, file }) });
  it('now gated like /api/files; still only the two PDF folders', async () => {
    expect((await pdf('training-program', 'week-1.pdf')).status).toBe(401);
    caller.current = { isStaff: false, isSuperUser: false };
    const res = await pdf('training-program', 'week-1.pdf', { authorization: 'Bearer t' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/object/sign/program-plans/training-program/week-1.pdf');
    expect((await pdf('secret', 'a.pdf', { authorization: 'Bearer t' })).status).toBe(404);
  });
});

describe('signedLinkFor (push icons)', () => {
  it('signs a private-bucket link for a week, passes others through', async () => {
    expect(await signedLinkFor('https://old.supabase.co/storage/v1/object/public/avatars/a.jpg?v=1')).toMatch(/object\/sign\/avatars\/a\.jpg/);
    expect(signCalls.at(-1)).toEqual(['avatars', 'a.jpg', 604800]);
    expect(await signedLinkFor('/api/files/avatars/b%20c.jpg')).toMatch(/object\/sign\/avatars\/b c\.jpg/);
    for (const u of ['/images/icon-192.png', 'https://x.supabase.co/storage/v1/object/public/notification-images/n.png', undefined]) {
      expect(await signedLinkFor(u)).toBe(u);
    }
  });
});
