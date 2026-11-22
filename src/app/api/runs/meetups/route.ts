import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { meetupPostedCopy, meetupCancelledCopy } from '@/lib/notifications/copy';
import { CLUB_SPOTS, KIND_LABEL, validateMeetupDraft, sortMeetups, usualPace, addDaysIso, feedHiddenIds, paceToSeconds } from '@/lib/runs/meetups';
import { rosterFull, toMeetup, factsFor, visibleTo, runBand, type MeetupRow, type RequestRow } from '@/lib/runs/meetups-server';
import { clubSpots, hostStarts, cancelRun } from '@/lib/runs/together-server';
import { createFanout, changeFanout, distanceM, homeProximityWarning, jitterArea, parseVisibility, sortNear } from '@/lib/runs/together';

export const dynamic = 'force-dynamic';

/**
 * "ריצות משותפות" — the board. v3 (migration 190, prototype approved 2026-11-21):
 * visibility club | squad | private, filtered HERE; the exact meeting point reaches only
 * the host and the people who joined (toMeetup strips it before serialisation, so it is
 * never in a non-joiner's response); writes take the host from the session.
 */

async function safeRows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  return error ? [] : ((data || []) as T[]);
}

// GET /api/runs/meetups[?v=3&scope=squad|near|club&lat&lng]
//   → { meetups, today, viewer: { id, pack, groupId, pace }, spots }
// lat/lng (scope=near) are used to sort only and are never echoed or stored.
export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const v3 = url.searchParams.get('v') === '3';
    const scope = url.searchParams.get('scope') || 'club';
    const auth = await requireAthlete(request);
    const viewerId = auth.ok ? auth.user.athleteId : null;
    const db = createServerClient();
    const today = israelToday();
    const [{ data: rows, error }, ros, recent, { data: me }, spots] = await Promise.all([
      db.from('run_meetups').select('*').gte('date', today).order('date'),
      rosterFull(db),
      viewerId
        ? db.from('athlete_activities').select('distance, duration').eq('athlete_id', viewerId)
          .gte('start_time', `${addDaysIso(today, -45)}T00:00:00`).order('start_time', { ascending: false }).limit(40)
        : Promise.resolve({ data: [] }),
      viewerId ? db.from('athletes').select('notification_prefs').eq('id', viewerId).maybeSingle() : Promise.resolve({ data: null }),
      clubSpots(db),
    ]);
    if (error) throw error;
    const allRows = (rows || []) as MeetupRow[];
    const allIds = allRows.map((m) => m.id);
    const [reqs, invites, msgs] = await Promise.all([
      allIds.length ? safeRows<RequestRow>(db.from('run_meetup_requests').select('meetup_id, athlete_id, status, created_at').in('meetup_id', allIds)) : [],
      allIds.length ? safeRows<{ meetup_id: string; athlete_id: string }>(db.from('run_meetup_invites').select('meetup_id, athlete_id').in('meetup_id', allIds)) : [],
      allIds.length ? safeRows<{ meetup_id: string }>(db.from('run_meetup_messages').select('meetup_id').in('meetup_id', allIds)) : [],
    ]);
    const groupId = viewerId ? ros.groupOf.get(viewerId) ?? null : null;
    const viewer = viewerId ? { id: viewerId, groupId } : null;
    const hidden = new Set(feedHiddenIds((me as { notification_prefs?: unknown } | null)?.notification_prefs));
    const msgCount = new Map<string, number>();
    for (const m of msgs) msgCount.set(m.meetup_id, (msgCount.get(m.meetup_id) || 0) + 1);

    let out = allRows.flatMap((m) => {
      const f = factsFor(m, reqs, invites, viewerId);
      if (!visibleTo(m, f, viewer, ros.groupOf.get(m.host_athlete_id))) return [];
      const involved = !!viewerId && (m.host_athlete_id === viewerId || f.myStatus === 'accepted' || f.myStatus === 'waitlist' || f.myStatus === 'pending');
      // A cancelled run stays on the board, greyed, for the people it was cancelled ON (v3 only).
      if (m.status === 'cancelled' && !(v3 && involved)) return [];
      if (v3 && scope === 'squad') {
        const inSquad = (m.squad_id && m.squad_id === groupId) || (groupId && ros.groupOf.get(m.host_athlete_id) === groupId);
        if (!inSquad && !involved) return [];
      }
      return [{ ...toMeetup(m, f.joinedIds, ros.people, viewerId, msgCount.get(m.id) || 0, f), feedHidden: hidden.has(m.id) }];
    });
    out = sortMeetups(out);
    const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
    if (v3 && scope === 'near' && Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) {
      // Day sections stay in order; within a day, nearest area first.
      const days = [...new Set(out.map((m) => m.date))];
      out = days.flatMap((d) => sortNear(out.filter((m) => m.date === d), { lat, lng }));
    }

    return NextResponse.json({
      meetups: out,
      today,
      viewer: viewerId ? { ...(ros.people.get(viewerId) ?? { id: viewerId, name: '', avatarUrl: null, pack: null }), groupId, pace: usualPace((recent.data || []) as Array<{ distance: number; duration: number }>) } : null,
      // Club-curated public places only. Hosts' custom pins are never offered to others
      // (they used to be — a home corner one host used became everyone's chip).
      spots: spots.map((s) => ({ id: s.id, name: s.name, areaLabel: s.areaLabel, lat: s.lat, lng: s.lng })),
    });
  } catch (err: unknown) {
    console.error('Meetups fetch error:', err);
    return NextResponse.json({ error: 'Failed to load meetups' }, { status: 500 });
  }
}

// POST /api/runs/meetups { date, startTime, spotId? | (location, lat, lng), kind?, plannedPace?, plannedPaceTo?,
//   distanceKm?, notes?, visibility?, capacity?, planId?, planDay?, invitedIds?, ackHomeWarning? }
//   → { id } | 409 { error: 'home_proximity' }
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json().catch(() => ({}));
    const db = createServerClient();
    const today = israelToday();
    const hostId = auth.user.athleteId;

    // A club spot fills the place; a custom pin keeps the host's own name for it.
    const spots = await clubSpots(db);
    const spot = typeof body.spotId === 'string' ? spots.find((s) => s.id === body.spotId) : undefined;
    const draft = spot ? { ...body, location: spot.name, lat: spot.lat, lng: spot.lng } : body;
    const parsed = validateMeetupDraft(draft, today);
    if (!parsed.ok) return NextResponse.json({ error: 'invalid', field: parsed.field, reason: parsed.reason }, { status: 400 });
    const v = parsed.value;
    const visibility = parseVisibility(body.visibility, body.audience);
    const paceTo = typeof body.plannedPaceTo === 'string' && paceToSeconds(body.plannedPaceTo) != null ? body.plannedPaceTo.trim() : null;
    const capacity = Number.isInteger(body.capacity) && body.capacity >= 2 && body.capacity <= 60 ? body.capacity : null;
    const planDay = Number.isInteger(body.planDay) && body.planDay >= 0 && body.planDay <= 6 ? body.planDay : null;
    const planId = typeof body.planId === 'string' && planDay != null ? body.planId : null;
    const invitedIds: string[] = visibility === 'private' && Array.isArray(body.invitedIds)
      ? [...new Set((body.invitedIds as unknown[]).filter((x): x is string => typeof x === 'string' && x !== hostId))].slice(0, 40) : [];

    // Custom pin near where the host usually starts = probably home. Warn once; the
    // host may still go ahead (ackHomeWarning) — the exact point only reaches joiners.
    if (!spot && v.lat != null && v.lng != null && body.ackHomeWarning !== true) {
      if (homeProximityWarning({ lat: v.lat, lng: v.lng }, await hostStarts(db, hostId, today))) {
        return NextResponse.json({ error: 'home_proximity' }, { status: 409 });
      }
    }

    const ros = await rosterFull(db);
    const hostGroup = ros.groupOf.get(hostId) ?? null;
    let area: { label: string; lat: number | null; lng: number | null };
    if (spot) area = { label: spot.areaLabel, lat: spot.areaLat, lng: spot.areaLng };
    else if (v.lat != null && v.lng != null) {
      const near = spots.find((s) => distanceM(s, { lat: v.lat!, lng: v.lng! }) < 2000);
      // The jitter seed must not be guessable from the point; a random per-run seed.
      const j = jitterArea(v.lat, v.lng, crypto.randomUUID());
      area = { label: near ? near.areaLabel : 'אזור המפגש', lat: j.lat, lng: j.lng };
    } else area = { label: 'אזור המפגש', lat: null, lng: null };

    const base = {
      host_athlete_id: hostId, date: v.date, start_time: v.startTime, location: v.location,
      planned_pace: v.plannedPace, distance_km: v.distanceKm, notes: v.notes,
    };
    let res = await db.from('run_meetups').insert({
      ...base, kind: v.kind, lat: v.lat, lng: v.lng, audience: visibility === 'squad' ? 'pack' : 'club',
      visibility, squad_id: visibility === 'squad' ? hostGroup : null, capacity, plan_id: planId, plan_day: planDay,
      spot_id: spot?.id ?? null, area_label: area.label, area_lat: area.lat, area_lng: area.lng, planned_pace_to: paceTo,
    }).select('id').single();
    // Before migration 190 the new columns are missing. A private run can't be honoured
    // without them, so refuse rather than post it to the club.
    if (res.error && (res.error as { code?: string }).code === '42703') {
      if (visibility === 'private') return NextResponse.json({ error: 'Private runs need migration 190' }, { status: 503 });
      res = await db.from('run_meetups').insert({ ...base, kind: v.kind, lat: v.lat, lng: v.lng, audience: visibility === 'squad' ? 'pack' : 'club' }).select('id').single();
    }
    if (res.error) throw res.error;
    const id = (res.data as { id: string }).id;
    if (invitedIds.length) await db.from('run_meetup_invites').insert(invitedIds.map((a) => ({ meetup_id: id, athlete_id: a })));

    let notified = 0;
    try {
      const { data: active } = await db.from('athletes').select('id, group_id').eq('status', 'active');
      const { data: acts } = await db.from('athlete_activities').select('athlete_id, distance, duration')
        .gte('start_time', `${addDaysIso(today, -30)}T00:00:00`).limit(1000);
      const byAthlete = new Map<string, Array<{ distance: number; duration: number }>>();
      for (const a of (acts || []) as Array<{ athlete_id: string; distance: number; duration: number }>) byAthlete.set(a.athlete_id, [...(byAthlete.get(a.athlete_id) || []), a]);
      const to = createFanout({
        visibility, squadId: visibility === 'squad' ? hostGroup : null, hostId, invitedIds,
        athletes: ((active || []) as Array<{ id: string; group_id: string | null }>).map((a) => ({ id: a.id, groupId: a.group_id, paceSec: paceToSeconds(usualPace(byAthlete.get(a.id) || [])) })),
        band: runBand({ planned_pace: v.plannedPace, planned_pace_to: paceTo }),
      });
      const host = ros.people.get(hostId);
      await Promise.all(to.map((athleteId) => notifyAthlete({
        athleteId, kind: 'meetup_posted', actorAthleteId: hostId, url: `/dashboard/run-together/${id}`, tag: `meetup-${id}`,
        category: 'teammates', icon: host?.avatarUrl || undefined,
        // The AREA, never the exact point: recipients haven't joined.
        copy: (locale) => meetupPostedCopy(locale, {
          name: host?.name, date: v.date, startTime: v.startTime, place: area.label,
          kind: v.kind ? KIND_LABEL[v.kind] : null, km: v.distanceKm, pace: v.plannedPace, today,
        }),
      }).then(() => { notified++; }).catch(() => {})));
    } catch { /* best-effort */ }
    return NextResponse.json({ id, notified });
  } catch (err: unknown) {
    console.error('Meetup create error:', err);
    return NextResponse.json({ error: 'Failed to create meetup' }, { status: 500 });
  }
}

// DELETE /api/runs/meetups?id=<id>[&note=…] — the host cancels. Kept, not deleted (see migration 107).
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const sp = new URL(request.url).searchParams;
    const id = (sp.get('id') || '').trim();
    const note = (sp.get('note') || '').trim().slice(0, 200) || null;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    return await cancelRun(createServerClient(), id, auth.user.athleteId, note);
  } catch (err: unknown) {
    console.error('Meetup cancel error:', err);
    return NextResponse.json({ error: 'Failed to cancel meetup' }, { status: 500 });
  }
}

