import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Who may see a birthday story: its owner once sending is on; the admin anybody's, to prepare it. */

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: () => caller() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const sending = vi.fn(async () => false);
let published: boolean | undefined;
const loadStory = vi.fn(async (_s: unknown, id: string, _t: string, o: { preview?: boolean }) => ({ athleteId: id, preview: !!o.preview, config: { published } }));
vi.mock('@/lib/birthday-year/server', async () => ({
  storyVisible: (await vi.importActual<typeof import('@/lib/birthday-year/server')>('@/lib/birthday-year/server')).storyVisible,
  sendingOn: () => sending(),
  loadStory: (s: unknown, id: string, t: string, o: { preview?: boolean }) => loadStory(s, id, t, o),
}));

const { GET } = await import('@/app/api/birthday-year/route');
const get = (q = '') => GET(new Request(`http://x/api/birthday-year${q}`));
const runner = { denied: null, caller: { athleteId: 'me', role: 'runner', roles: ['runner'], isSuperUser: false, isStaff: false } };
const admin = { denied: null, caller: { athleteId: 'boss', role: 'admin', roles: ['admin'], isSuperUser: false, isStaff: true } };

beforeEach(() => { caller.mockReset(); sending.mockReset(); sending.mockResolvedValue(false); loadStory.mockClear(); published = undefined; });

describe('GET /api/birthday-year', () => {
  it('gives the owner nothing while sending is off', async () => {
    caller.mockResolvedValue(runner);
    expect((await (await get()).json()).story).toBeNull();
  });

  it('gives the owner their own once it is on', async () => {
    caller.mockResolvedValue(runner);
    sending.mockResolvedValue(true);
    expect((await (await get()).json()).story).toMatchObject({ athleteId: 'me', preview: false });
  });

  it('shows any member somebody else\'s during its week, never as a preview', async () => {
    caller.mockResolvedValue(runner);
    sending.mockResolvedValue(true);
    expect((await (await get('?athleteId=shalev')).json()).story).toMatchObject({ athleteId: 'shalev', preview: false });
  });

  it('shows a member nobody\'s while sending is off', async () => {
    caller.mockResolvedValue(runner);
    expect((await (await get('?athleteId=shalev')).json()).story).toBeNull();
  });

  it('lets the admin preview anybody\'s, with sending off', async () => {
    caller.mockResolvedValue(admin);
    const body = await (await get('?athleteId=shalev')).json();
    expect(body.story).toMatchObject({ athleteId: 'shalev', preview: true });
  });

  it('shows a story its own switch turned on, with the club-wide switch off', async () => {
    caller.mockResolvedValue(runner);
    published = true;
    expect((await (await get('?athleteId=shalev')).json()).story).toMatchObject({ athleteId: 'shalev' });
  });

  it('hides a story its own switch turned off, with the club-wide switch on — but not from the admin', async () => {
    sending.mockResolvedValue(true);
    published = false;
    caller.mockResolvedValue(runner);
    expect((await (await get('?athleteId=shalev')).json()).story).toBeNull();
    caller.mockResolvedValue(admin);
    expect((await (await get('?athleteId=shalev')).json()).story).toMatchObject({ athleteId: 'shalev' });
  });
});
