import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildSeedClub } from '@/lib/dev-seed/club';
import { ACADEMY_TRAINEES, buildSeedExtras, SEED_CONFLICT, SEED_EXTRA_TABLES } from '@/lib/dev-seed/extras';
import { packChannelId } from '@/lib/packs/server';
import { activityWeekStart } from '@/lib/utils';

/** Round 6, task 173: races, weekly snapshots, academy and chat on top of the seed club. */
const ANCHOR = '2026-11-28';
const club = buildSeedClub({ anchor: ANCHOR });
const x = buildSeedExtras(club, { anchor: ANCHOR });

describe('buildSeedExtras', () => {
  it('is deterministic and does not mutate the club', () => {
    const before = JSON.stringify(club);
    expect(buildSeedExtras(club, { anchor: ANCHOR })).toEqual(x);
    expect(JSON.stringify(club)).toBe(before);
  });

  it('every extra table has a conflict key that matches its rows', () => {
    for (const t of SEED_EXTRA_TABLES) {
      const cols = (SEED_CONFLICT[t] ?? 'id').split(',');
      const keys = x[t].map((r) => cols.map((c) => String(r[c])).join('|'));
      expect(keys.every((k) => !k.includes('undefined')), t).toBe(true);
      expect(new Set(keys).size, t).toBe(keys.length);
    }
  });

  it('races: one finished with splits to the finish, one upcoming with a poll window ≥ start + 6:30', () => {
    const [past, next] = x.events as Array<{ id: string; kind: string; date: string; start_time: string }>;
    expect(past.date < ANCHOR && next.date > ANCHOR).toBe(true);
    expect(x.events.every((e) => e.kind === 'race' && e.location && e.name)).toBe(true);
    const cfg = x.race_live_config.find((c) => c.event_id === next.id) as { poll_from: string; poll_to: string; active: boolean };
    const start = Date.parse(`${next.date}T07:15:00Z`); // 08:15 in Valencia (UTC+1 in December)
    expect(Date.parse(cfg.poll_to) - start).toBeGreaterThanOrEqual(6.5 * 3600_000);
    expect(Date.parse(cfg.poll_from)).toBeLessThan(start);
    expect(cfg.active).toBe(true);
    const finishers = x.race_splits.filter((s) => s.event_id === past.id && s.point === 'finish');
    expect(finishers).toHaveLength(10);
    // Splits only grow along the course.
    for (const e of x.race_entries.filter((r) => r.event_id === past.id)) {
      const t = x.race_splits.filter((s) => s.athlete_id === e.athlete_id).map((s) => s.elapsed_sec as number);
      expect([...t].sort((a, b) => a - b)).toEqual(t);
    }
    expect(x.race_entries.every((r) => (r.goal_sec as number) >= 3600 && (r.goal_sec as number) <= 28800)).toBe(true);
  });

  it('weekly snapshots sum the seeded runs per Monday activity week', () => {
    const acts = club.athlete_activities as Array<{ athlete_id: string; start_time: string; distance: number }>;
    expect(x.weekly_km_snapshots.reduce((n, w) => n + (w.runs as number), 0)).toBe(acts.length);
    expect(x.weekly_km_snapshots.reduce((n, w) => n + (w.distance_m as number), 0)).toBe(acts.reduce((n, a) => n + a.distance, 0));
    for (const w of x.weekly_km_snapshots) expect(new Date(`${w.week_start}T12:00:00Z`).getUTCDay()).toBe(1);
    const a0 = acts[0];
    expect(x.weekly_km_snapshots.some((w) => w.athlete_id === a0.athlete_id && w.week_start === activityWeekStart(a0.start_time))).toBe(true);
  });

  it('academy: staff roles, six trainees paired both ways with the academy coach', () => {
    const staff = x.athletes.filter((a) => !a.group_id);
    expect(staff.map((a) => a.role)).toEqual(['coach', 'academy_coach']);
    const trainees = x.athletes.filter((a) => a.is_academy);
    expect(trainees).toHaveLength(ACADEMY_TRAINEES);
    expect(trainees.every((t) => t.academy_coach_id === staff[1].id)).toBe(true);
    expect(x.academy_trainee_coaches.map((r) => r.athlete_id).sort()).toEqual(trainees.map((t) => t.id).sort());
    expect(x.academy_workouts).toHaveLength(3);
  });

  it('chat: one channel per group with the same key the app uses, authors are members or the coach', () => {
    expect(x.chat).toHaveLength(3);
    for (const c of x.chat) {
      expect(c.channelId).toBe(packChannelId(c.groupId));
      const allowed = new Set(x.athletes.filter((a) => a.group_id === c.groupId || a.role === 'coach').map((a) => a.id));
      expect(c.messages.length).toBeGreaterThan(0);
      expect(c.messages.every((m) => allowed.has(m.userId))).toBe(true);
    }
  });
});

describe('scripts/seed-dev.mts — chat', () => {
  const src = readFileSync('scripts/seed-dev.mts', 'utf8');
  it('posts chat only with --chat and only with the SEED_STREAM_* keys, never the app keys', () => {
    expect(src).toMatch(/args\.includes\('--chat'\)/);
    expect(src).toMatch(/SEED_STREAM_API_KEY/);
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/process\.env\.(NEXT_PUBLIC_)?STREAM_/);
  });
});
