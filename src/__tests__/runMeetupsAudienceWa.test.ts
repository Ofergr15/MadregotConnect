import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { feedHiddenIds, meetupVisibleTo, meetupWaText } from '@/lib/runs/meetups';
import { feedRuns, runsCountLabel } from '@/components/run-together/FeedStrip';
import type { RunMeetup } from '@/lib/runs/meetups';

/**
 * "לרוץ ביחד" (Ofer, 2026-10-20): who sees a run — its host and people going always,
 * beyond them the audience the host chose (club / host's pack), enforced on the list,
 * the run page, joining and the WhatsApp hand-off; the ✕ hides a run from the feed
 * only; and WhatsApp straight to one of the run's people without the number ever being
 * in the meetup payload.
 */

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async () => {}) }));
const who = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireAthlete: async () => (who.id ? { ok: true, user: { athleteId: who.id } } : { ok: false, status: 401, error: 'unauthorized' }),
}));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  requireMember: async () => (who.id ? null : new Response('{}', { status: 401 })),
}));

const list = await import('@/app/api/runs/meetups/route');
const detail = await import('@/app/api/runs/meetups/[id]/route');
const join = await import('@/app/api/runs/meetups/requests/route');
const wa = await import('@/app/api/runs/meetups/[id]/wa/route');
const hide = await import('@/app/api/runs/meetups/hide/route');

const G1 = uid(); const G2 = uid();
const HOST = uid(); const GOER = uid(); const MATE = uid(); const OTHER = uid(); const NOPHONE = uid();
const PACK_RUN = uid(); const CLUB_RUN = uid();
const FUTURE = '2099-01-10';

beforeEach(() => {
  who.id = null;
  db = createMemoryDb({
    schema: {
      athletes: ['id', 'name', 'avatar_url', 'group_id', 'phone', 'status', 'notification_prefs'],
      groups: ['id', 'name'],
      run_meetups: ['id', 'host_athlete_id', 'date', 'start_time', 'location', 'planned_pace', 'distance_km', 'notes', 'status', 'kind', 'lat', 'lng', 'audience'],
      run_meetup_requests: ['id', 'meetup_id', 'athlete_id', 'status'],
      run_meetup_messages: ['id', 'meetup_id', 'athlete_id', 'body', 'created_at'],
      athlete_activities: ['athlete_id', 'distance', 'duration', 'start_time'],
    },
    defaults: { run_meetup_requests: () => ({ id: uid() }) },
  });
  db.tables.groups.push({ id: G1, name: 'Group A - SUB 2:30' }, { id: G2, name: 'Group B - SUB 2:35' });
  const a = (id: string, name: string, group: string | null, phone: string | null) => ({ id, name, avatar_url: null, group_id: group, phone, status: 'active', notification_prefs: { language: 'he' } });
  db.tables.athletes.push(
    a(HOST, 'Amit Lazar', G2, '054-123 4567'), a(GOER, 'Ran Alterman', G1, '0521112222'),
    a(MATE, 'Sahar Azar', G2, '0503334444'), a(OTHER, 'Ido Bar', G1, '0505556666'), a(NOPHONE, 'No Phone', G2, null),
  );
  const run = (id: string, audience: string) => ({ id, host_athlete_id: HOST, date: FUTURE, start_time: '06:00', location: 'הטיילת', planned_pace: '5:10', distance_km: 12, notes: null, status: 'open', kind: 'easy', lat: null, lng: null, audience });
  db.tables.run_meetups.push(run(PACK_RUN, 'pack'), run(CLUB_RUN, 'club'));
  db.tables.run_meetup_requests.push({ id: uid(), meetup_id: PACK_RUN, athlete_id: GOER, status: 'accepted' });
});

const req = (url: string, init?: RequestInit) => new Request(`http://x${url}`, init);
const ids = async (as: string) => { who.id = as; const j = await (await list.GET(req('/api/runs/meetups'))).json(); return (j.meetups as RunMeetup[]).map((m) => m.id); };

describe('who sees a run', () => {
  it('pure rule: host and goers always; club to all; pack to the host pack only', () => {
    const m = { hostId: HOST, audience: 'pack' as const, hostPack: 2, goingIds: [GOER] };
    expect(meetupVisibleTo(m, { id: HOST, pack: 2 })).toBe(true);
    expect(meetupVisibleTo(m, { id: GOER, pack: 1 })).toBe(true);
    expect(meetupVisibleTo(m, { id: MATE, pack: 2 })).toBe(true);
    expect(meetupVisibleTo(m, { id: OTHER, pack: 1 })).toBe(false);
    expect(meetupVisibleTo({ ...m, audience: 'club' }, { id: OTHER, pack: 1 })).toBe(true);
    expect(meetupVisibleTo({ ...m, hostPack: null }, { id: OTHER, pack: null })).toBe(false);
    expect(meetupVisibleTo(m, null)).toBe(false);
  });

  it('the list API: host, goer and pack-mate see the pack run; someone outside it does not', async () => {
    expect(await ids(HOST)).toContain(PACK_RUN);
    expect(await ids(GOER)).toContain(PACK_RUN);
    expect(await ids(MATE)).toContain(PACK_RUN);
    const other = await ids(OTHER);
    expect(other).not.toContain(PACK_RUN);
    expect(other).toContain(CLUB_RUN);
  });

  it('the run page and joining answer 404 outside the audience', async () => {
    who.id = OTHER;
    expect((await detail.GET(req(`/api/runs/meetups/${PACK_RUN}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(404);
    const j = await join.POST(req('/api/runs/meetups/requests', { method: 'POST', body: JSON.stringify({ meetupId: PACK_RUN }) }));
    expect(j.status).toBe(404);
    who.id = MATE;
    expect((await detail.GET(req(`/api/runs/meetups/${PACK_RUN}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(200);
  });
});

describe('the feed row', () => {
  const m = (o: Partial<RunMeetup>): RunMeetup => ({ id: uid(), isHost: false, joined: false, date: FUTURE, startTime: '06:00', ...o }) as RunMeetup;
  it('pins my own runs first and drops the ones I hid', () => {
    const mine = m({ joined: true, date: '2099-02-01' });
    const hidden = m({ feedHidden: true });
    const open = m({});
    expect(feedRuns([open, hidden, mine]).map((x) => x.id)).toEqual([mine.id, open.id]);
    // My own run is never hidden, even if a flag says so.
    expect(feedRuns([m({ isHost: true, feedHidden: true })])).toHaveLength(1);
    expect(runsCountLabel(1)).toBe('ריצה אחת השבוע');
    expect(runsCountLabel(3)).toBe('3 ריצות השבוע');
  });

  it('✕ hides the run from the feed only — the run page still opens, other prefs survive', async () => {
    who.id = MATE;
    expect((await hide.POST(req('/api/runs/meetups/hide', { method: 'POST', body: JSON.stringify({ meetupId: CLUB_RUN }) }))).status).toBe(200);
    const prefs = db.tables.athletes.find((x) => x.id === MATE)!.notification_prefs as Record<string, unknown>;
    expect(prefs.language).toBe('he');
    expect(feedHiddenIds(prefs)).toEqual([CLUB_RUN]);
    const j = await (await list.GET(req('/api/runs/meetups'))).json();
    expect((j.meetups as RunMeetup[]).find((x) => x.id === CLUB_RUN)?.feedHidden).toBe(true);
    expect((await detail.GET(req(`/api/runs/meetups/${CLUB_RUN}`), { params: Promise.resolve({ id: CLUB_RUN }) })).status).toBe(200);
  });
});

describe('WhatsApp straight to a person', () => {
  it('no phone number anywhere in the meetup payloads; a boolean instead; none for yourself', async () => {
    who.id = GOER;
    const body = JSON.stringify(await (await list.GET(req('/api/runs/meetups'))).json())
      + JSON.stringify(await (await detail.GET(req(`/api/runs/meetups/${PACK_RUN}`), { params: Promise.resolve({ id: PACK_RUN }) })).json());
    for (const p of ['1234567', '1112222', '3334444', '5556666', '972']) expect(body).not.toContain(p);
    const d = await (await detail.GET(req(`/api/runs/meetups/${PACK_RUN}`), { params: Promise.resolve({ id: PACK_RUN }) })).json();
    expect(d.meetup.host.hasWhatsApp).toBe(true);
    expect(d.meetup.going.find((p: { id: string }) => p.id === GOER).hasWhatsApp).toBe(false);
  });

  it('returns the wa.me link for one of the run’s people, addressed by first name', async () => {
    who.id = GOER;
    const res = await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${HOST}`), { params: Promise.resolve({ id: PACK_RUN }) });
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url.startsWith('https://wa.me/972541234567?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]);
    expect(text).toContain('היי Amit');
    expect(text).toContain('הטיילת');
    expect(text).toContain(`/dashboard/run-together/${PACK_RUN}`);
  });

  it('401 when not signed in; 404 outside the audience; 403 for someone not in the run; 404 without a phone; 400 to yourself', async () => {
    const p = { params: Promise.resolve({ id: PACK_RUN }) };
    expect((await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${HOST}`), p)).status).toBe(401);
    who.id = OTHER;
    expect((await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${HOST}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(404);
    who.id = MATE;
    expect((await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${OTHER}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(403);
    db.tables.run_meetup_requests.push({ id: uid(), meetup_id: PACK_RUN, athlete_id: NOPHONE, status: 'accepted' });
    expect((await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${NOPHONE}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(404);
    expect((await wa.GET(req(`/api/runs/meetups/${PACK_RUN}/wa?to=${MATE}`), { params: Promise.resolve({ id: PACK_RUN }) })).status).toBe(400);
  });

  it('the message text', () => {
    const t = meetupWaText('Ran Alterman', { id: 'r1', date: '2026-10-21', start_time: '06:00', location: 'הטיילת', kind: 'long' }, '2026-10-20');
    expect(t).toBe('היי Ran, לגבי הריצה הארוכה מחר ב־06:00 · הטיילת 👟 https://www.madregot.app/dashboard/run-together/r1');
  });
});
