/**
 * Round 6, task 173 — the rest of a demo club on top of `buildSeedClub` (#233): races,
 * weekly summaries, the academy, and group chat. Pure and deterministic like club.ts: fixed
 * ids, no network, no clock. scripts/seed-dev.mts writes it after assertSeedTarget.
 *
 *   races     — two `events` of kind race: one finished two weeks before the anchor (entries,
 *               splits to the finish, live config switched off) and one eight days after it
 *               (entries with bib + goal, live config with the poll window the race-live
 *               settings require: poll_to ≥ start + 6:30).
 *   weekly    — `weekly_km_snapshots` per runner per Monday activity week, summed from the
 *               seeded runs, the same shape cron/sync writes (lib/weekly-snapshots.ts).
 *               The weekly summary screens compute from the runs themselves, so the runs
 *               already cover them; these rows are the durable history.
 *   academy   — the second staff member becomes an `academy_coach`, the first a club `coach`;
 *               six runners are academy trainees paired with that coach (legacy column and
 *               academy_trainee_coaches), and a three-workout library.
 *   chat      — a few messages per group channel. Chat lives in Stream, not in the database,
 *               so these are written only when the script is given a dev Stream app
 *               explicitly (see scripts/seed-dev.mts); the default run never touches Stream.
 */
import { COACH_ID } from '@/lib/constants';
import { activityWeekStart } from '@/lib/utils';
// Same key as lib/packs/server.ts packChannelId (pinned by seedDev.test.ts); importing it
// would pull the plans/attendance modules into the seed.
const packChannelId = (groupId: string) => `academy-pack-${groupId}`;
import { SEED_GROUPS, seedId, type SeedClub } from './club';

type Row = Record<string, unknown>;

export interface SeedExtras {
  /** The club's athletes with roles and academy fields added — upsert these instead of club.athletes. */
  athletes: Row[];
  events: Row[];
  race_live_config: Row[];
  race_entries: Row[];
  race_splits: Row[];
  weekly_km_snapshots: Row[];
  academy_trainee_coaches: Row[];
  academy_workouts: Row[];
  /** Stream messages, by channel id. Not a table. */
  chat: Array<{ channelId: string; groupId: string; messages: Array<{ id: string; userId: string; text: string }> }>;
}

/** Upsert conflict target per table; anything not listed upserts on `id`. */
export const SEED_CONFLICT: Record<string, string> = {
  race_live_config: 'event_id',
  race_entries: 'event_id,athlete_id',
  race_splits: 'event_id,athlete_id,point',
  // cron/sync may already have written a row for the same athlete-week under another id.
  weekly_km_snapshots: 'athlete_id,week_start',
  academy_trainee_coaches: 'athlete_id,coach_id',
};

/** Parents before children. */
export const SEED_EXTRA_TABLES = [
  'events', 'race_live_config', 'race_entries', 'race_splits',
  'weekly_km_snapshots', 'academy_workouts', 'academy_trainee_coaches',
] as const;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const SPLITS: Array<[string, number]> = [
  ['start', 0], ['5k', 5000], ['10k', 10000], ['15k', 15000], ['20k', 20000], ['half', 21097],
];

export const ACADEMY_TRAINEES = 6;

export function buildSeedExtras(club: SeedClub, opts: { anchor: string }): SeedExtras {
  const runners = club.athletes.filter((a) => a.group_id);
  const staff = club.athletes.filter((a) => !a.group_id);
  const [clubCoach, academyCoach] = staff;
  const trainees = new Set(runners.slice(0, ACADEMY_TRAINEES).map((a) => a.id));
  const joined = addDays(opts.anchor, -60);

  const athletes = club.athletes.map((a) => {
    if (a.id === clubCoach?.id) return { ...a, role: 'coach' };
    if (a.id === academyCoach?.id) return { ...a, role: 'academy_coach' };
    if (trainees.has(a.id)) {
      return { ...a, is_academy: true, academy_joined_on: joined, academy_coach_id: academyCoach?.id ?? null };
    }
    return a;
  });

  // ── Races ──
  const past = { id: seedId('event:race:past'), date: addDays(opts.anchor, -14) };
  const next = { id: seedId('event:race:next'), date: addDays(opts.anchor, 8) };
  const events: Row[] = [
    {
      id: past.id, kind: 'race', name: 'Seed Half Marathon', date: past.date, start_time: '06:00',
      location: 'Tel Aviv Port', lat: 32.0973, lng: 34.7733, distances: ['21.1'], status: 'published',
    },
    {
      id: next.id, kind: 'race', name: 'Seed City Marathon', date: next.date, start_time: '08:15',
      location: 'Valencia — Ciudad de las Artes', lat: 39.4561, lng: -0.3545, distances: ['42.2'], status: 'published',
    },
  ];
  // The half starts 06:00 Israel (UTC+2 in winter); the marathon 08:15 Spain (UTC+1).
  const pastStart = Date.parse(`${past.date}T04:00:00Z`);
  const nextStart = Date.parse(`${next.date}T07:15:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString();
  const race_live_config: Row[] = [
    { event_id: past.id, source: 'manual', active: false, push_enabled: false, poll_from: iso(pastStart - 30 * 60_000), poll_to: iso(pastStart + 4 * 3600_000) },
    { event_id: next.id, source: 'manual', active: true, push_enabled: false, poll_from: iso(nextStart - 30 * 60_000), poll_to: iso(nextStart + 6.5 * 3600_000) },
  ];

  const paceOf = (i: number) => SEED_GROUPS[i % SEED_GROUPS.length].pace;
  const race_entries: Row[] = [];
  const race_splits: Row[] = [];
  runners.slice(0, 10).forEach((a, i) => {
    const pace = paceOf(i) - 10; // race day is a bit quicker than training
    race_entries.push({ event_id: past.id, athlete_id: a.id, bib: String(1000 + i), goal_sec: Math.round(21.0975 * pace) });
    for (const [point, m] of SPLITS) {
      race_splits.push({ event_id: past.id, athlete_id: a.id, point, elapsed_sec: Math.round((m / 1000) * pace), source: 'manual', recorded_at: iso(pastStart + (m / 1000) * pace * 1000) });
    }
    race_splits.push({ event_id: past.id, athlete_id: a.id, point: 'finish', elapsed_sec: Math.round(21.0975 * pace) + 20, source: 'manual', recorded_at: iso(pastStart + (21.0975 * pace + 20) * 1000) });
  });
  runners.slice(5, 17).forEach((a, i) => {
    race_entries.push({ event_id: next.id, athlete_id: a.id, bib: String(20_000 + i), goal_sec: Math.round(42.195 * (paceOf(i + 5) + 5)) });
  });

  // ── Weekly summaries ──
  const weeks = new Map<string, { athlete_id: unknown; group_id: unknown; week_start: string; distance_m: number; runs: number; duration_s: number }>();
  const groupOf = new Map(club.athletes.map((a) => [a.id, a.group_id]));
  for (const act of club.athlete_activities as Array<{ athlete_id: string; start_time: string; distance: number; duration: number }>) {
    const week = activityWeekStart(act.start_time);
    const key = `${act.athlete_id}:${week}`;
    const w = weeks.get(key) ?? { athlete_id: act.athlete_id, group_id: groupOf.get(act.athlete_id) ?? null, week_start: week, distance_m: 0, runs: 0, duration_s: 0 };
    w.distance_m += act.distance; w.runs += 1; w.duration_s += act.duration;
    weeks.set(key, w);
  }
  const weekly_km_snapshots = [...weeks.entries()].map(([key, w]) => ({ id: seedId(`wk:${key}`), ...w }));

  // ── Academy ──
  const academy_trainee_coaches: Row[] = academyCoach
    ? [...trainees].map((athlete_id) => ({ athlete_id, coach_id: academyCoach.id, since: joined }))
    : [];
  const step = (order: number, type: string, durationType: string, durationValue: number, targetZone?: string) =>
    ({ order, type, durationType, durationValue, targetType: targetZone ? 'pace' : 'no_target', ...(targetZone ? { targetZone } : {}) });
  const academy_workouts: Row[] = [
    { id: seedId('aw:tempo'), coach_id: COACH_ID, name: 'Tempo 3 × 2 km', workout: { name: 'Tempo 3 × 2 km', steps: [step(1, 'warmup', 'time', 900), step(2, 'interval', 'distance', 2000, 'tempo'), step(3, 'recovery', 'time', 120), step(4, 'interval', 'distance', 2000, 'tempo'), step(5, 'recovery', 'time', 120), step(6, 'interval', 'distance', 2000, 'tempo'), step(7, 'cooldown', 'time', 600)] } },
    { id: seedId('aw:intervals'), coach_id: COACH_ID, name: '8 × 400', workout: { name: '8 × 400', steps: [step(1, 'warmup', 'time', 900), ...Array.from({ length: 8 }, (_, i) => [step(2 + i * 2, 'interval', 'distance', 400, 'interval'), step(3 + i * 2, 'recovery', 'time', 90)]).flat(), step(18, 'cooldown', 'time', 600)] } },
    { id: seedId('aw:long'), coach_id: COACH_ID, name: 'Long run 18 km', workout: { name: 'Long run 18 km', steps: [step(1, 'active', 'distance', 18000, 'easy')] } },
  ];

  // ── Chat (Stream) ──
  const LINES = ['Who is in for Friday 06:00?', 'Me! Meeting at the usual spot.', 'Easy pace tomorrow, legs are heavy.', 'Great tempo today, thanks coach.', 'Running late, start without me.'];
  const chat = SEED_GROUPS.map((g, gi) => {
    const groupId = seedId(`group:${g.key}`);
    const members = runners.filter((a) => a.group_id === groupId);
    return {
      channelId: packChannelId(groupId),
      groupId,
      messages: LINES.map((text, i) => ({
        id: seedId(`chat:${g.key}:${i}`),
        userId: String((i === 3 && clubCoach ? clubCoach : members[(i + gi) % Math.max(1, members.length)])?.id ?? ''),
        text,
      })).filter((m) => m.userId),
    };
  });

  return { athletes, events, race_live_config, race_entries, race_splits, weekly_km_snapshots, academy_trainee_coaches, academy_workouts, chat };
}
