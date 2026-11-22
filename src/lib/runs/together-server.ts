import { NextResponse } from 'next/server';
import type { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { meetupCancelledCopy } from '@/lib/notifications/copy';
import { CLUB_SPOTS, addDaysIso } from './meetups';
import { rosterFull, type MeetupRow, type RequestRow } from './meetups-server';
import { changeFanout, jitterArea } from './together';

// Server helpers for Run together v3 shared by the meetups routes.

export interface Spot { id: string | null; name: string; areaLabel: string; lat: number; lng: number; areaLat: number; areaLng: number }

export async function clubSpots(db: ReturnType<typeof createServerClient>): Promise<Spot[]> {
  const { data, error } = await db.from('run_spots').select('id, name, area_label, lat, lng, area_lat, area_lng').eq('active', true).order('sort');
  if (!error && data?.length) {
    return (data as Array<{ id: string; name: string; area_label: string; lat: number; lng: number; area_lat: number; area_lng: number }>)
      .map((s) => ({ id: s.id, name: s.name, areaLabel: s.area_label, lat: s.lat, lng: s.lng, areaLat: s.area_lat, areaLng: s.area_lng }));
  }
  // Pre-190: the hardcoded club spots, area = jittered centre.
  return CLUB_SPOTS.map((s) => { const j = jitterArea(s.lat, s.lng, s.name); return { id: null, name: s.name, areaLabel: s.name, lat: s.lat, lng: s.lng, areaLat: j.lat, areaLng: j.lng }; });
}

/** Recent run starts of one athlete — read only to warn them, never returned. */
export async function hostStarts(db: ReturnType<typeof createServerClient>, athleteId: string, today: string) {
  const { data } = await db.from('athlete_activities').select('start_lat, start_lng').eq('athlete_id', athleteId)
    .gte('start_time', `${addDaysIso(today, -90)}T00:00:00`).not('start_lat', 'is', null).limit(120);
  return ((data || []) as Array<{ start_lat: number; start_lng: number }>).map((a) => ({ lat: Number(a.start_lat), lng: Number(a.start_lng) }));
}

export async function cancelRun(db: ReturnType<typeof createServerClient>, id: string, hostId: string, note: string | null) {
  let { data, error } = await db.from('run_meetups').update({ status: 'cancelled', cancel_note: note })
    .eq('id', id).eq('host_athlete_id', hostId).select('*');
  if (error && (error as { code?: string }).code === '42703') {
    ({ data, error } = await db.from('run_meetups').update({ status: 'cancelled' }).eq('id', id).eq('host_athlete_id', hostId).select('*'));
  }
  if (error) throw error;
  const row = (data || [])[0] as MeetupRow | undefined;
  if (!row) return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
  try {
    const { data: reqs } = await db.from('run_meetup_requests').select('athlete_id, status').eq('meetup_id', id);
    const ros = await rosterFull(db);
    const to = changeFanout({ hostId, rows: ((reqs || []) as Array<{ athlete_id: string; status: RequestRow['status'] }>).map((r) => ({ athleteId: r.athlete_id, status: r.status })) });
    await Promise.all(to.map((athleteId) => notifyAthlete({
      athleteId, kind: 'meetup_cancelled', actorAthleteId: hostId, url: `/dashboard/run-together/${id}`, tag: `meetup-${id}`, category: 'teammates',
      copy: (locale) => meetupCancelledCopy(locale, { hostName: ros.people.get(hostId)?.name, startTime: row.start_time, note }),
    }).catch(() => {})));
  } catch { /* best-effort */ }
  return NextResponse.json({ cancelled: true });
}
