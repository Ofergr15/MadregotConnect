import type { createServerClient } from '@/lib/supabase/server';
import { resolveGroup } from '@/lib/utils';
import type { MeetupKind, MeetupPerson, RunMeetup } from './meetups';

// The reads behind "לרוץ ביחד" shared by /api/runs/meetups and /api/runs/meetups/:id
// (a route file may export only its handlers).

export type Db = ReturnType<typeof createServerClient>;
export interface MeetupRow {
  id: string; host_athlete_id: string; date: string; start_time: string; location: string;
  planned_pace: string | null; distance_km: number | null; notes: string | null; status: string;
  kind?: string | null; lat?: number | null; lng?: number | null; audience?: string | null;
}
export interface AthleteRow { id: string; name: string | null; avatar_url: string | null; group_id: string | null; status?: string }

/** Everyone's face and pack, once: a run shows a few people and the roster is small. */
export async function roster(db: Db): Promise<Map<string, MeetupPerson>> {
  const [{ data: people }, { data: groups }] = await Promise.all([
    db.from('athletes').select('id, name, avatar_url, group_id'),
    db.from('groups').select('id, name'),
  ]);
  const groupName = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  return new Map(((people || []) as AthleteRow[]).map((a) => {
    const g = a.group_id ? resolveGroup(groupName.get(a.group_id) || '') : null;
    return [a.id, { id: a.id, name: (a.name || '').trim(), avatarUrl: a.avatar_url, pack: g && g.index >= 0 ? g.index + 1 : null }];
  }));
}

export function toMeetup(m: MeetupRow, joinedIds: string[], people: Map<string, MeetupPerson>, viewerId: string | null, messageCount = 0): RunMeetup {
  const person = (id: string): MeetupPerson => people.get(id) ?? { id, name: '', avatarUrl: null, pack: null };
  const host = person(m.host_athlete_id);
  return {
    id: m.id,
    host,
    date: m.date,
    startTime: m.start_time,
    location: m.location,
    lat: m.lat ?? null,
    lng: m.lng ?? null,
    kind: (m.kind as MeetupKind | null) ?? null,
    plannedPace: m.planned_pace,
    distanceKm: m.distance_km === null ? null : Number(m.distance_km),
    notes: m.notes,
    audience: m.audience === 'pack' ? 'pack' : 'club',
    pack: host.pack,
    going: [host, ...joinedIds.filter((id) => id !== m.host_athlete_id).map(person)],
    isHost: !!viewerId && viewerId === m.host_athlete_id,
    joined: !!viewerId && joinedIds.includes(viewerId),
    messageCount,
  };
}


/**
 * The evening before (20:00, api/cron/tick): everyone going on tomorrow's open runs
 * hears when and where. Returns how many were told.
 */
export async function sendMeetupReminders(db: Db, tomorrow: string): Promise<number> {
  const { notifyAthlete } = await import('@/lib/push');
  const { meetupReminderCopy } = await import('@/lib/notifications/copy');
  const { data: rows } = await db.from('run_meetups').select('*').eq('date', tomorrow).eq('status', 'open');
  const meetups = (rows || []) as MeetupRow[];
  if (!meetups.length) return 0;
  const [{ data: reqs }, people] = await Promise.all([
    db.from('run_meetup_requests').select('meetup_id, athlete_id, status').in('meetup_id', meetups.map((m) => m.id)).eq('status', 'accepted'),
    roster(db),
  ]);
  let told = 0;
  for (const m of meetups) {
    const joined = ((reqs || []) as Array<{ meetup_id: string; athlete_id: string }>).filter((r) => r.meetup_id === m.id).map((r) => r.athlete_id);
    // A run nobody joined is still the host's plan — but there is nobody to meet, so no reminder.
    if (!joined.length) continue;
    const going = [...new Set([m.host_athlete_id, ...joined])];
    await Promise.all(going.map((athleteId) => notifyAthlete({
      athleteId,
      kind: 'meetup_reminder',
      url: `/dashboard/run-together/${m.id}`,
      tag: `meetup-remind-${m.id}`,
      category: 'teammates',
      copy: (locale) => meetupReminderCopy(locale, { hostName: people.get(m.host_athlete_id)?.name, startTime: m.start_time, place: m.location, going: going.length, isHost: athleteId === m.host_athlete_id }),
    }).then(() => { told++; }).catch(() => {})));
  }
  return told;
}
