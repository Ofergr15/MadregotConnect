import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { meetupMessageCopy, meetupTimeChangedCopy } from '@/lib/notifications/copy';
import { rosterFull, toMeetup, factsFor, visibleTo, planBlockFor, type MeetupRow, type RequestRow } from '@/lib/runs/meetups-server';
import { canSeeExact, changeFanout, distanceM, jitterArea } from '@/lib/runs/together';
import { clubSpots, cancelRun } from '@/lib/runs/together-server';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE = 400;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

type Params = { params: Promise<{ id: string }> };

async function load(id: string, viewerId: string | null) {
  const db = createServerClient();
  const [{ data: row }, ros, { data: reqs }, invitesRes] = await Promise.all([
    db.from('run_meetups').select('*').eq('id', id).maybeSingle(),
    rosterFull(db),
    db.from('run_meetup_requests').select('meetup_id, athlete_id, status, created_at').eq('meetup_id', id),
    db.from('run_meetup_invites').select('meetup_id, athlete_id').eq('meetup_id', id),
  ]);
  if (!row) return null;
  const m = row as MeetupRow;
  const f = factsFor(m, (reqs || []) as RequestRow[], invitesRes.error ? [] : (invitesRes.data || []) as Array<{ meetup_id: string; athlete_id: string }>, viewerId);
  const visible = visibleTo(m, f, viewerId ? { id: viewerId, groupId: ros.groupOf.get(viewerId) ?? null } : null, ros.groupOf.get(m.host_athlete_id));
  const insider = canSeeExact({ hostId: m.host_athlete_id, joinedIds: f.joinedIds }, viewerId);
  return { db, m, f, ros, visible, insider };
}

// GET /api/runs/meetups/:id → { meetup, messages, plan }
// messages: joiners + host only (empty array for anyone else — the chat is coordination
// about the exact place). plan: the plan block in the viewer's own lane.
export async function GET(request: Request, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { id } = await params;
  const auth = await requireAthlete(request);
  const viewerId = auth.ok ? auth.user.athleteId : null;
  const got = await load(id, viewerId);
  // Outside the run's audience it doesn't exist for you — the same answer as a wrong id.
  if (!got || !got.visible) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  let messages: unknown[] = [];
  if (got.insider) {
    const { data: msgs, error } = await got.db.from('run_meetup_messages').select('*').eq('meetup_id', id).order('created_at');
    if (!error) messages = ((msgs || []) as Array<{ id: string; athlete_id: string; body: string; created_at: string; kind?: string }>).map((x) => ({
      id: x.id, body: x.body, createdAt: x.created_at, kind: x.kind === 'system' ? 'system' : 'user',
      from: got.ros.people.get(x.athlete_id) ?? { id: x.athlete_id, name: '', avatarUrl: null, pack: null }, mine: x.athlete_id === viewerId,
    }));
  }
  const lane = viewerId ? got.ros.people.get(viewerId)?.pack ?? null : null;
  const plan = await planBlockFor(got.db, got.m.plan_id ?? null, got.m.plan_day ?? null, lane).catch(() => null);
  return NextResponse.json({
    meetup: { ...toMeetup(got.m, got.f.joinedIds, got.ros.people, viewerId, messages.length, got.f), over: got.m.date < israelToday() },
    messages,
    plan,
  });
}

// POST /api/runs/meetups/:id { body } — a message to the people going. Host + joined only.
// Push: to the host only (joiners are muted by default — a 6-person chat shouldn't buzz 6 phones).
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const { id } = await params;
  const { body } = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body === 'string' ? body.trim().slice(0, MAX_MESSAGE) : '';
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const got = await load(id, auth.user.athleteId);
  if (!got || !got.visible) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  if (!got.insider) return NextResponse.json({ error: 'Join the run to write' }, { status: 403 });
  const { error } = await got.db.from('run_meetup_messages').insert({ meetup_id: id, athlete_id: auth.user.athleteId, body: text });
  if (error) { console.error('[api/runs/meetups/[id]]', error); return NextResponse.json({ error: 'failed' }, { status: 500 }); }
  if (got.m.host_athlete_id !== auth.user.athleteId) {
    const me = got.ros.people.get(auth.user.athleteId);
    await notifyAthlete({
      athleteId: got.m.host_athlete_id, kind: 'meetup_message', actorAthleteId: auth.user.athleteId,
      url: `/dashboard/run-together/${id}`, tag: `meetup-msg-${id}`, category: 'teammates', icon: me?.avatarUrl || undefined,
      copy: (locale) => meetupMessageCopy(locale, { name: me?.name, body: text }),
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/runs/meetups/:id — host only, host from the session.
//   { startTime }            move the time: joiners stay joined, are pushed, chat gets a system line
//   { spotId | location,lat,lng }  move the place (area recomputed server-side)
//   { transferTo }           hand the run to an accepted joiner
//   { cancel: true, note? }  call it off
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const { id } = await params;
  const hostId = auth.user.athleteId;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const got = await load(id, hostId);
    if (!got) return NextResponse.json({ error: 'No such run' }, { status: 404 });
    if (got.m.host_athlete_id !== hostId) return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
    if (got.m.status === 'cancelled') return NextResponse.json({ error: 'This run is cancelled' }, { status: 409 });
    const { db, m } = got;

    if (body.cancel === true) {
      return await cancelRun(db, id, hostId, typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null);
    }

    if (typeof body.transferTo === 'string') {
      const to = body.transferTo;
      if (!got.f.joinedIds.includes(to)) return NextResponse.json({ error: 'Only someone who joined can host' }, { status: 400 });
      const { data, error } = await db.from('run_meetups').update({ host_athlete_id: to }).eq('id', id).eq('host_athlete_id', hostId).select('id');
      if (error) throw error;
      if (!data?.length) return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
      // The old host is now a joiner (still going, still sees the exact spot).
      await db.from('run_meetup_requests').upsert({ meetup_id: id, athlete_id: hostId, status: 'accepted' }, { onConflict: 'meetup_id,athlete_id' });
      return NextResponse.json({ ok: true, hostId: to });
    }

    const patch: Record<string, unknown> = {};
    let timeChange: { from: string; to: string } | null = null;
    if (typeof body.startTime === 'string') {
      if (!TIME_RE.test(body.startTime.trim())) return NextResponse.json({ error: 'invalid', field: 'startTime' }, { status: 400 });
      const t = body.startTime.trim().padStart(5, '0');
      if (t !== m.start_time) {
        timeChange = { from: m.start_time, to: t };
        Object.assign(patch, { start_time: t, previous_start_time: m.start_time, updated_time_at: new Date().toISOString(), soon_notified_at: null });
      }
    }
    if (typeof body.spotId === 'string' || (typeof body.lat === 'number' && typeof body.lng === 'number')) {
      const spots = await clubSpots(db);
      const spot = spots.find((s) => s.id === body.spotId);
      if (spot) Object.assign(patch, { spot_id: spot.id, location: spot.name, lat: spot.lat, lng: spot.lng, area_label: spot.areaLabel, area_lat: spot.areaLat, area_lng: spot.areaLng });
      else {
        const lat = body.lat as number, lng = body.lng as number;
        if (!(lat > 29 && lat < 34 && lng > 34 && lng < 36)) return NextResponse.json({ error: 'invalid', field: 'location' }, { status: 400 });
        const name = typeof body.location === 'string' && body.location.trim() ? body.location.trim().slice(0, 80) : m.location;
        const near = spots.find((s) => distanceM(s, { lat, lng }) < 2000);
        const j = jitterArea(lat, lng, crypto.randomUUID());
        Object.assign(patch, { spot_id: null, location: name, lat, lng, area_label: near ? near.areaLabel : 'אזור המפגש', area_lat: j.lat, area_lng: j.lng });
      }
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true, changed: false });
    const { error } = await db.from('run_meetups').update(patch).eq('id', id).eq('host_athlete_id', hostId);
    if (error) throw error;

    if (timeChange) {
      const host = got.ros.people.get(hostId);
      const tc = timeChange;
      await db.from('run_meetup_messages').insert({ meetup_id: id, athlete_id: hostId, body: `השעה השתנתה: ${tc.from} ← ${tc.to}`, kind: 'system' })
        .then(() => {}, () => {});
      const { data: reqs } = await db.from('run_meetup_requests').select('athlete_id, status').eq('meetup_id', id);
      const to = changeFanout({ hostId, rows: ((reqs || []) as Array<{ athlete_id: string; status: RequestRow['status'] }>).map((r) => ({ athleteId: r.athlete_id, status: r.status })) });
      await Promise.all(to.map((athleteId) => notifyAthlete({
        athleteId, kind: 'meetup_time_changed', actorAthleteId: hostId, url: `/dashboard/run-together/${id}`, tag: `meetup-${id}`, category: 'teammates',
        copy: (locale) => meetupTimeChangedCopy(locale, { hostName: host?.name, from: tc.from, to: tc.to, title: locale === 'he' ? 'הריצה' : 'the run' }),
      }).catch(() => {})));
      return NextResponse.json({ ok: true, changed: true, notified: to.length });
    }
    return NextResponse.json({ ok: true, changed: true });
  } catch (err: unknown) {
    console.error('Meetup edit error:', err);
    return NextResponse.json({ error: 'Failed to edit meetup' }, { status: 500 });
  }
}
