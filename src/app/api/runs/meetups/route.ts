import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { meetupPostedCopy } from '@/lib/notifications/copy';
import { CLUB_SPOTS, KIND_LABEL, validateMeetupDraft, sortMeetups, usualPace, addDaysIso, meetupVisibleTo, feedHiddenIds } from '@/lib/runs/meetups';
import { roster, toMeetup, type AthleteRow, type MeetupRow } from '@/lib/runs/meetups-server';

export const dynamic = 'force-dynamic';

/**
 * "לרוץ ביחד" — the board (mockup ~/.cache/madregot/run-together-v2.html, Ofer
 * 2026-10-19). A run is seen by its host and the people going, and beyond them by the
 * audience the host chose — the whole club or the host's pack (meetupVisibleTo, 2026-10-20);
 * the same rule gates the run's own page. Faces, first names and pack colours, never an email. Writes
 * take the host from the session, never the body.
 */

// GET /api/runs/meetups → { meetups, today, viewer: { id, pack, pace }, spots }
export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const auth = await requireAthlete(request);
    const viewerId = auth.ok ? auth.user.athleteId : null;
    const db = createServerClient();
    const today = israelToday();
    const [{ data: rows, error }, people, recent, { data: past }, { data: me }] = await Promise.all([
      db.from('run_meetups').select('*').gte('date', today).eq('status', 'open').order('date'),
      roster(db),
      viewerId
        ? db.from('athlete_activities').select('distance, duration').eq('athlete_id', viewerId)
          .gte('start_time', `${addDaysIso(today, -45)}T00:00:00`).order('start_time', { ascending: false }).limit(40)
        : Promise.resolve({ data: [] }),
      db.from('run_meetups').select('*').gte('date', addDaysIso(today, -120)).limit(300),
      viewerId ? db.from('athletes').select('notification_prefs').eq('id', viewerId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (error) throw error;
    const allRows = (rows || []) as MeetupRow[];
    const allIds = allRows.map((m) => m.id);
    const [{ data: reqs }, { data: msgs }] = await Promise.all([
      allIds.length ? db.from('run_meetup_requests').select('meetup_id, athlete_id, status').in('meetup_id', allIds) : Promise.resolve({ data: [] }),
      allIds.length ? db.from('run_meetup_messages').select('meetup_id').in('meetup_id', allIds) : Promise.resolve({ data: [] }),
    ]);
    const joined = new Map<string, string[]>();
    for (const r of (reqs || []) as Array<{ meetup_id: string; athlete_id: string; status: string }>) {
      if (r.status === 'accepted') joined.set(r.meetup_id, [...(joined.get(r.meetup_id) || []), r.athlete_id]);
    }
    const viewerPerson = viewerId ? people.get(viewerId) : undefined;
    const viewer = viewerId ? { id: viewerId, pack: viewerPerson?.pack ?? null } : null;
    const meetupRows = allRows.filter((m) => meetupVisibleTo({
      hostId: m.host_athlete_id, audience: m.audience === 'pack' ? 'pack' : 'club',
      hostPack: people.get(m.host_athlete_id)?.pack ?? null, goingIds: joined.get(m.id) || [],
    }, viewer));
    const hidden = new Set(feedHiddenIds((me as { notification_prefs?: unknown } | null)?.notification_prefs));
    const msgCount = new Map<string, number>();
    for (const m of (msgs || []) as Array<{ meetup_id: string }>) msgCount.set(m.meetup_id, (msgCount.get(m.meetup_id) || 0) + 1);

    // The post sheet's places: the club's spots, then any other named point a host used.
    const spots = [...CLUB_SPOTS];
    for (const m of (past || []) as MeetupRow[]) {
      if (m.lat == null || m.lng == null || !m.location) continue;
      if (spots.some((s) => s.name === m.location || (Math.abs(s.lat - m.lat!) < 0.002 && Math.abs(s.lng - m.lng!) < 0.002))) continue;
      spots.push({ name: m.location, lat: m.lat, lng: m.lng });
    }

    return NextResponse.json({
      meetups: sortMeetups(meetupRows.map((m) => ({ ...toMeetup(m, joined.get(m.id) || [], people, viewerId, msgCount.get(m.id) || 0), startTime: m.start_time, feedHidden: hidden.has(m.id) }))),
      today,
      viewer: viewerId ? { ...(people.get(viewerId) ?? { id: viewerId, name: '', avatarUrl: null, pack: null }), pace: usualPace((recent.data || []) as Array<{ distance: number; duration: number }>) } : null,
      spots: spots.slice(0, 8),
    });
  } catch (err: unknown) {
    console.error('Meetups fetch error:', err);
    return NextResponse.json({ error: 'Failed to load meetups' }, { status: 500 });
  }
}

// POST /api/runs/meetups { date, startTime, location, lat?, lng?, kind?, plannedPace?, distanceKm?, notes?, audience? }
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = validateMeetupDraft(body, israelToday());
    if (!parsed.ok) return NextResponse.json({ error: 'invalid', field: parsed.field, reason: parsed.reason }, { status: 400 });
    const v = parsed.value;
    const db = createServerClient();
    const base = {
      host_athlete_id: auth.user.athleteId, date: v.date, start_time: v.startTime, location: v.location,
      planned_pace: v.plannedPace, distance_km: v.distanceKm, notes: v.notes,
    };
    let res = await db.from('run_meetups').insert({ ...base, kind: v.kind, lat: v.lat, lng: v.lng, audience: v.audience }).select('id').single();
    // Before migration 157 the new columns are missing: the run still goes up, without them.
    if (res.error && (res.error as { code?: string }).code === '42703') res = await db.from('run_meetups').insert(base).select('id').single();
    if (res.error) throw res.error;
    const id = (res.data as { id: string }).id;

    // Tell them: the host's pack, or the whole club. Best-effort, never blocks the post.
    try {
      const people = await roster(db);
      const host = people.get(auth.user.athleteId);
      const { data: active } = await db.from('athletes').select('id, group_id').eq('status', 'active');
      const hostGroup = ((active || []) as AthleteRow[]).find((a) => a.id === auth.user.athleteId)?.group_id ?? null;
      const to = ((active || []) as AthleteRow[])
        .filter((a) => a.id !== auth.user.athleteId && (v.audience === 'club' || (hostGroup && a.group_id === hostGroup)))
        .map((a) => a.id);
      await Promise.all(to.map((athleteId) => notifyAthlete({
        athleteId,
        kind: 'meetup_posted',
        actorAthleteId: auth.user.athleteId,
        url: `/dashboard/run-together/${id}`,
        tag: `meetup-${id}`,
        category: 'teammates',
        icon: host?.avatarUrl || undefined,
        copy: (locale) => meetupPostedCopy(locale, {
          name: host?.name, date: v.date, startTime: v.startTime, place: v.location,
          kind: v.kind ? KIND_LABEL[v.kind] : null, km: v.distanceKm, pace: v.plannedPace, today: israelToday(),
        }),
      }).catch(() => {})));
    } catch { /* best-effort */ }
    return NextResponse.json({ id });
  } catch (err: unknown) {
    console.error('Meetup create error:', err);
    return NextResponse.json({ error: 'Failed to create meetup' }, { status: 500 });
  }
}

// DELETE /api/runs/meetups?id=<id> — the host cancels. Kept, not deleted (see migration 107).
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const id = (new URL(request.url).searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { data, error } = await createServerClient().from('run_meetups').update({ status: 'cancelled' })
      .eq('id', id).eq('host_athlete_id', auth.user.athleteId).select('id');
    if (error) throw error;
    if ((data || []).length === 0) return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    console.error('Meetup cancel error:', err);
    return NextResponse.json({ error: 'Failed to cancel meetup' }, { status: 500 });
  }
}
