import { addDaysIso } from './meetups';
import type { Db, MeetupRow } from './meetups-server';
import { chatExpired, inSoonWindow, matchGroupActivities } from './together';

import { RUNS_ONLY_OR } from '@/lib/activities/kinds';
/**
 * The three Run-together jobs on cron/tick (every 5 min). Each is idempotent:
 *  - T−60 push (stamped soon_notified_at, so a re-run tick doesn't double-send)
 *  - chat purge 24 h after the run (location coordination should not rest on disk)
 *  - group-run linking for runs from the last two days
 */

export async function sendSoonReminders(db: Db, now: { date: string; minute: number }): Promise<number> {
  const { notifyAthlete } = await import('@/lib/push');
  const { meetupSoonCopy } = await import('@/lib/notifications/copy');
  const { data } = await db.from('run_meetups').select('*').eq('date', now.date).eq('status', 'open').is('soon_notified_at', null);
  const due = ((data || []) as MeetupRow[]).filter((m) => inSoonWindow({ date: m.date, startTime: m.start_time }, now));
  let told = 0;
  for (const m of due) {
    // Stamp first: a slow push must not let the next tick send again.
    const { data: claimed } = await db.from('run_meetups').update({ soon_notified_at: new Date().toISOString() })
      .eq('id', m.id).is('soon_notified_at', null).select('id');
    if (!claimed?.length) continue;
    const { data: reqs } = await db.from('run_meetup_requests').select('athlete_id').eq('meetup_id', m.id).eq('status', 'accepted');
    const going = [...new Set([m.host_athlete_id, ...((reqs || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id)])];
    if (going.length < 2) continue;
    await Promise.all(going.map((athleteId) => notifyAthlete({
      athleteId, kind: 'meetup_soon', url: `/dashboard/run-together/${m.id}`, tag: `meetup-soon-${m.id}`, category: 'teammates',
      copy: (locale) => meetupSoonCopy(locale, { startTime: m.start_time, place: m.location, going: going.length }),
    }).then(() => { told++; }).catch(() => {})));
  }
  return told;
}

export async function purgeExpiredChats(db: Db, now: { date: string; minute: number }): Promise<number> {
  const { data } = await db.from('run_meetups').select('id, date, start_time')
    .gte('date', addDaysIso(now.date, -10)).lte('date', now.date);
  const ids = ((data || []) as Array<{ id: string; date: string; start_time: string }>)
    .filter((m) => chatExpired({ date: m.date, startTime: m.start_time }, now)).map((m) => m.id);
  if (!ids.length) return 0;
  const { data: gone } = await db.from('run_meetup_messages').delete().in('meetup_id', ids).select('id');
  return gone?.length ?? 0;
}

export async function linkGroupRuns(db: Db, today: string): Promise<number> {
  const { data } = await db.from('run_meetups').select('*').gte('date', addDaysIso(today, -2)).lte('date', today).eq('status', 'open');
  const meetups = (data || []) as MeetupRow[];
  let linked = 0;
  for (const m of meetups) {
    const { data: reqs } = await db.from('run_meetup_requests').select('athlete_id').eq('meetup_id', m.id).eq('status', 'accepted');
    const goingIds = [...new Set([m.host_athlete_id, ...((reqs || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id)])];
    if (goingIds.length < 2) continue;
    const { data: acts } = await db.from('athlete_activities').select('id, athlete_id, start_time, start_lat, start_lng').or(RUNS_ONLY_OR)
      .in('athlete_id', goingIds).gte('start_time', `${m.date}T00:00:00`).lte('start_time', `${m.date}T23:59:59`);
    const rows = matchGroupActivities(
      { date: m.date, startTime: m.start_time, lat: m.lat ?? null, lng: m.lng ?? null, goingIds },
      ((acts || []) as Array<{ id: string; athlete_id: string; start_time: string; start_lat: number | null; start_lng: number | null }>).map((a) => ({
        id: a.id, athleteId: a.athlete_id, startTime: a.start_time,
        startLat: a.start_lat == null ? null : Number(a.start_lat), startLng: a.start_lng == null ? null : Number(a.start_lng),
      })),
    );
    // A group run is two or more people who actually ran it together.
    if (rows.length < 2) continue;
    const { error } = await db.from('run_meetup_activities').upsert(
      rows.map((r) => ({ meetup_id: m.id, activity_id: r.activityId, athlete_id: r.athleteId })),
      { onConflict: 'meetup_id,activity_id', ignoreDuplicates: true },
    );
    if (!error) linked += rows.length;
  }
  return linked;
}

