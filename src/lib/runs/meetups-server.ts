import type { createServerClient } from '@/lib/supabase/server';
import { resolveGroup } from '@/lib/utils';
import { waPhone } from '@/lib/academy/manage';
import { CLUB_SPOTS, paceToSeconds, type MeetupKind, type MeetupPerson, type RunMeetup } from './meetups';
import {
  canSeeExact, canSeeRun, distanceM, jitterArea, parseVisibility, projectPlace,
  type ProjectedPlace, type RequestStatus, type Visibility,
} from './together';

// The reads behind "לרוץ ביחד" shared by /api/runs/meetups and /api/runs/meetups/:id
// (a route file may export only its handlers).

export type Db = ReturnType<typeof createServerClient>;
export interface MeetupRow {
  id: string; host_athlete_id: string; date: string; start_time: string; location: string;
  planned_pace: string | null; distance_km: number | null; notes: string | null; status: string;
  kind?: string | null; lat?: number | null; lng?: number | null; audience?: string | null;
  // 190
  visibility?: string | null; squad_id?: string | null; capacity?: number | null;
  plan_id?: string | null; plan_day?: number | null; spot_id?: string | null;
  area_label?: string | null; area_lat?: number | null; area_lng?: number | null;
  planned_pace_to?: string | null; updated_time_at?: string | null; previous_start_time?: string | null;
  cancel_note?: string | null; soon_notified_at?: string | null;
}
export interface AthleteRow { id: string; name: string | null; avatar_url: string | null; group_id: string | null; status?: string; phone?: string | null }
export interface RequestRow { meetup_id: string; athlete_id: string; status: RequestStatus; created_at?: string; id?: string }

export interface Roster {
  people: Map<string, MeetupPerson>;
  groupOf: Map<string, string | null>;
  groupName: Map<string, string>;
}

/** Everyone's face and pack, once: a run shows a few people and the roster is small. */
export async function roster(db: Db): Promise<Map<string, MeetupPerson>> {
  return (await rosterFull(db)).people;
}

export async function rosterFull(db: Db): Promise<Roster> {
  const [{ data: people }, { data: groups }] = await Promise.all([
    db.from('athletes').select('id, name, avatar_url, group_id, phone'),
    db.from('groups').select('id, name'),
  ]);
  const groupName = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const rows = (people || []) as AthleteRow[];
  return {
    groupName,
    groupOf: new Map(rows.map((a) => [a.id, a.group_id])),
    people: new Map(rows.map((a) => {
      const g = a.group_id ? resolveGroup(groupName.get(a.group_id) || '') : null;
      // The phone is read only to say whether WhatsApp can open a chat — it is never put on the person.
      return [a.id, { id: a.id, name: (a.name || '').trim(), avatarUrl: a.avatar_url, pack: g && g.index >= 0 ? g.index + 1 : null, hasWhatsApp: !!waPhone(a.phone) }];
    })),
  };
}

/** The area a non-joiner sees, for rows written before 190 had area_* filled. */
export function areaOf(m: MeetupRow): { label: string | null; lat: number | null; lng: number | null } {
  if (m.area_lat != null && m.area_lng != null) return { label: m.area_label ?? null, lat: m.area_lat, lng: m.area_lng };
  if (m.lat == null || m.lng == null) return { label: m.area_label ?? null, lat: null, lng: null };
  const j = jitterArea(m.lat, m.lng, m.id);
  const near = CLUB_SPOTS.find((s) => distanceM(s, { lat: m.lat!, lng: m.lng! }) < 1500);
  return { label: m.area_label ?? (near ? `ליד ${near.name}` : null), lat: j.lat, lng: j.lng };
}

export interface RunFacts {
  joinedIds: string[];
  waitlistIds: string[];
  pendingIds: string[];
  invitedIds: string[];
  myStatus: RequestStatus | null;
}

export function factsFor(m: MeetupRow, reqs: RequestRow[], invites: Array<{ meetup_id: string; athlete_id: string }>, viewerId: string | null): RunFacts {
  const mine = reqs.filter((r) => r.meetup_id === m.id);
  const by = (s: RequestStatus) => mine.filter((r) => r.status === s)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).map((r) => r.athlete_id);
  return {
    joinedIds: by('accepted').filter((id) => id !== m.host_athlete_id),
    waitlistIds: by('waitlist'),
    pendingIds: by('pending'),
    invitedIds: invites.filter((i) => i.meetup_id === m.id).map((i) => i.athlete_id),
    myStatus: viewerId ? (mine.find((r) => r.athlete_id === viewerId)?.status ?? null) : null,
  };
}

/** `hostGroup` covers squad runs written before 190 filled squad_id (they meant the host's pack). */
export function visibleTo(m: MeetupRow, f: RunFacts, viewer: { id: string; groupId: string | null } | null, hostGroup?: string | null): boolean {
  return canSeeRun({
    hostId: m.host_athlete_id, visibility: parseVisibility(m.visibility, m.audience),
    squadId: m.squad_id ?? hostGroup ?? null, joinedIds: f.joinedIds, invitedIds: f.invitedIds,
  }, viewer);
}

/** v3 additions to the legacy RunMeetup shape. */
export interface RunTogetherExtras {
  visibility: Visibility;
  squadId: string | null;
  status: 'open' | 'cancelled';
  cancelNote: string | null;
  capacity: number | null;
  full: boolean;
  waitlistCount: number;
  myStatus: RequestStatus | null;
  /** Area for everybody; `exact` only for host + joined. */
  place: ProjectedPlace;
  plannedPaceTo: string | null;
  planDay: number | null;
  planId: string | null;
  timeChanged: { from: string; to: string; at: string } | null;
  /** Host only: who's asking (private runs) and who's waiting. */
  requests?: Array<{ person: MeetupPerson; status: RequestStatus }>;
}

/**
 * The run as THIS viewer may receive it. Non-joiners: `location` is the area label,
 * `lat`/`lng` are null, `place.exact` is null — the exact point is never serialised.
 */
export function toMeetup(
  m: MeetupRow, joinedIds: string[], people: Map<string, MeetupPerson>, viewerId: string | null, messageCount = 0,
  facts?: RunFacts,
): RunMeetup & RunTogetherExtras {
  const person = (id: string): MeetupPerson => {
    const p = people.get(id) ?? { id, name: '', avatarUrl: null, pack: null };
    // No WhatsApp to yourself.
    return id === viewerId ? { ...p, hasWhatsApp: false } : p;
  };
  const f: RunFacts = facts ?? { joinedIds, waitlistIds: [], pendingIds: [], invitedIds: [], myStatus: null };
  const exactOk = canSeeExact({ hostId: m.host_athlete_id, joinedIds: f.joinedIds }, viewerId);
  const area = areaOf(m);
  const place = projectPlace({ location: m.location, lat: m.lat ?? null, lng: m.lng ?? null, areaLabel: area.label, areaLat: area.lat, areaLng: area.lng }, exactOk);
  const host = person(m.host_athlete_id);
  const visibility = parseVisibility(m.visibility, m.audience);
  const capacity = m.capacity ?? null;
  const isHost = !!viewerId && viewerId === m.host_athlete_id;
  return {
    id: m.id,
    host,
    date: m.date,
    startTime: m.start_time,
    location: exactOk ? m.location : place.area.label,
    lat: exactOk ? (m.lat ?? null) : null,
    lng: exactOk ? (m.lng ?? null) : null,
    kind: (m.kind as MeetupKind | null) ?? null,
    plannedPace: m.planned_pace,
    distanceKm: m.distance_km === null ? null : Number(m.distance_km),
    notes: m.notes,
    audience: visibility === 'squad' ? 'pack' : 'club',
    pack: host.pack,
    going: [host, ...f.joinedIds.map(person)],
    isHost,
    joined: !!viewerId && f.joinedIds.includes(viewerId),
    // Chat is joiners-only; a count is all a non-joiner may know about it, and not even that.
    messageCount: exactOk ? messageCount : 0,
    visibility,
    squadId: m.squad_id ?? null,
    status: m.status === 'cancelled' ? 'cancelled' : 'open',
    cancelNote: m.cancel_note ?? null,
    capacity,
    full: capacity != null && f.joinedIds.length + 1 >= capacity,
    waitlistCount: f.waitlistIds.length,
    myStatus: isHost ? 'accepted' : f.myStatus,
    place,
    plannedPaceTo: m.planned_pace_to ?? null,
    planDay: m.plan_day ?? null,
    planId: m.plan_id ?? null,
    timeChanged: m.updated_time_at && m.previous_start_time
      ? { from: m.previous_start_time, to: m.start_time, at: m.updated_time_at } : null,
    ...(isHost ? { requests: [...f.pendingIds.map((id) => ({ person: person(id), status: 'pending' as const })), ...f.waitlistIds.map((id) => ({ person: person(id), status: 'waitlist' as const }))] } : {}),
  };
}

/** The pace band a run asks for, in s/km, for fan-out matching. */
export function runBand(m: { planned_pace: string | null; planned_pace_to?: string | null }): { min: number; max: number } | null {
  const a = paceToSeconds(m.planned_pace);
  if (a == null) return null;
  const b = paceToSeconds(m.planned_pace_to ?? null) ?? a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * The plan block for a plan-linked run, in the VIEWER's lane: each joiner sees their
 * own group's pace. Null when the plan or day can't be read.
 */
export async function planBlockFor(db: Db, planId: string | null, planDay: number | null, lane: number | null): Promise<{ title: string; description: string | null; pace: { min: number; max: number } | null; lane: number } | null> {
  if (!planId || planDay == null) return null;
  const { data } = await db.from('weekly_plans').select('parsed_workouts').eq('id', planId).maybeSingle();
  const parsed = (data as { parsed_workouts?: Record<string, unknown> } | null)?.parsed_workouts;
  if (!parsed) return null;
  const l = lane && lane >= 1 && lane <= 3 ? lane : 1;
  type W = { dayOfWeek: number; name?: string; workoutName?: string; description?: string };
  const grouped = (parsed as Record<string, { workouts?: W[] }>)[`group${l}`]?.workouts;
  const list: W[] = grouped ?? ((parsed as { workouts?: W[] }).workouts || []);
  const day = list.filter((w) => w.dayOfWeek === planDay);
  if (!day.length) return null;
  const { lanePaceFromNotes } = await import('@/lib/ai/splitGroups');
  const description = day.map((w) => w.description).filter(Boolean).join(' · ') || null;
  return {
    title: day.map((w) => w.workoutName || w.name).filter(Boolean).join(' + '),
    description,
    pace: lanePaceFromNotes(description, l as 1 | 2 | 3),
    lane: l,
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
      // Only people going are told, so the exact place is theirs to read.
      copy: (locale) => meetupReminderCopy(locale, { hostName: people.get(m.host_athlete_id)?.name, startTime: m.start_time, place: m.location, going: going.length, isHost: athleteId === m.host_athlete_id }),
    }).then(() => { told++; }).catch(() => {})));
  }
  return told;
}
