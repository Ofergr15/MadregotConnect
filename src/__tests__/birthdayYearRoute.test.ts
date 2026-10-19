import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may see a birthday story (stories phase 2): only what the stories gate + the
 * person's overrides open (lib/stories/access.ts). The old club switch and a per-story
 * `published:true` open nothing; `published:false` still hides one story.
 */

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: () => caller() }));
const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { birth_date: '1990-10-19' } }) }) }) }) }) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));
let published: boolean | undefined;
const loadStory = vi.fn(async (_s: unknown, id: string, _t: string, o: { preview?: boolean }) => ({ athleteId: id, preview: !!o.preview, config: { published } }));
vi.mock('@/lib/birthday-year/server', async () => ({
  legacyClosed: (await vi.importActual<typeof import('@/lib/birthday-year/server')>('@/lib/birthday-year/server')).legacyClosed,
  loadStory: (s: unknown, id: string, t: string, o: { preview?: boolean }) => loadStory(s, id, t, o),
}));
const access = vi.fn();
vi.mock('@/lib/stories/access', () => ({ defaultAccessDeps: () => ({}), storyAccess: (...a: unknown[]) => access(...a) }));

const { GET } = await import('@/app/api/birthday-year/route');
const get = (q = '') => GET(new Request(`http://x/api/birthday-year${q}`));
const runner = { denied: null, caller: { athleteId: 'me', role: 'runner', roles: ['runner'], isSuperUser: false, isStaff: false } };
const admin = { denied: null, caller: { athleteId: 'boss', role: 'admin', roles: ['admin'], isSuperUser: false, isStaff: true } };
const open = (preview = false) => ({ allowed: true, preview, tester: false, reason: 'ok', settings: {}, instance: null });

beforeEach(() => { caller.mockReset(); access.mockReset(); loadStory.mockClear(); published = undefined; });

describe('GET /api/birthday-year', () => {
  it('gives nothing while the gate is closed — and never loads the year', async () => {
    caller.mockResolvedValue(runner);
    access.mockResolvedValue({ allowed: false, reason: 'off' });
    expect((await (await get()).json()).story).toBeNull();
    expect(loadStory).not.toHaveBeenCalled();
  });

  it('gives the owner their own once the gate opens', async () => {
    caller.mockResolvedValue(runner);
    access.mockResolvedValue(open());
    expect((await (await get()).json()).story).toMatchObject({ athleteId: 'me', preview: false });
    expect(access.mock.calls[0][1]).toMatchObject({ viewerId: 'me', ownerId: 'me', isAdmin: false, forcePreview: false });
  });

  it('a member asking for somebody else\'s goes through the gate for both', async () => {
    caller.mockResolvedValue(runner);
    access.mockResolvedValue(open());
    await get('?athleteId=shalev&preview=1');
    // preview=1 is ignored for a non-admin
    expect(access.mock.calls[0][1]).toMatchObject({ viewerId: 'me', ownerId: 'shalev', forcePreview: false });
  });

  it('the admin\'s preview=1 asks for a preview; the gate still has the last word', async () => {
    caller.mockResolvedValue(admin);
    access.mockResolvedValue(open(true));
    expect((await (await get('?athleteId=shalev&preview=1')).json()).story).toMatchObject({ athleteId: 'shalev', preview: true });
    expect(access.mock.calls[0][1]).toMatchObject({ isAdmin: true, forcePreview: true });
    access.mockResolvedValue({ allowed: false, reason: 'off' });
    expect((await (await get('?athleteId=shalev&preview=1')).json()).story).toBeNull();
  });

  it('published:true opens nothing; published:false hides it from members, not from the admin preview', async () => {
    caller.mockResolvedValue(runner);
    published = true;
    access.mockResolvedValue({ allowed: false, reason: 'off' });
    expect((await (await get('?athleteId=shalev')).json()).story).toBeNull();
    published = false;
    access.mockResolvedValue(open());
    expect((await (await get('?athleteId=shalev')).json()).story).toBeNull();
    caller.mockResolvedValue(admin);
    access.mockResolvedValue(open(true));
    expect((await (await get('?athleteId=shalev&preview=1')).json()).story).toMatchObject({ athleteId: 'shalev' });
  });
});
