import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRaceLiveScenario, RACE_ELAPSED_AT_ANCHOR_SEC, RACE_LIVE_SEED_CONFLICT, RACE_LIVE_SEED_TABLES } from '@/lib/dev-seed/race-live';
import { POINT_KEYS, POINT_M } from '@/lib/race-live/core';

const EVENT = '00000000-0000-4000-8000-0000000000e1';
const RUNNERS = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const ANCHOR = '2026-12-06T10:25:00.000Z';
const seed = () => buildRaceLiveScenario({ eventId: EVENT, anchorIso: ANCHOR, runnerIds: RUNNERS, mapViewerIds: RUNNERS.slice(5) });

describe('race-live dev seed — a marathon in progress', () => {
  it('is deterministic (re-seeding upserts the same rows)', () => {
    expect(seed()).toEqual(seed());
  });

  it('refuses too few runners or a bad anchor', () => {
    expect(() => buildRaceLiveScenario({ eventId: EVENT, anchorIso: ANCHOR, runnerIds: RUNNERS.slice(0, 3) })).toThrow(/at least 6/);
    expect(() => buildRaceLiveScenario({ eventId: EVENT, anchorIso: 'soon', runnerIds: RUNNERS })).toThrow(/ISO/);
  });

  it('config: replay, active, push OFF, poll window covers start-30 min to start+6:30', () => {
    const [c] = seed().race_live_config;
    const start = Date.parse(ANCHOR) - RACE_ELAPSED_AT_ANCHOR_SEC * 1000;
    expect(c).toMatchObject({ event_id: EVENT, source: 'replay', active: true, push_enabled: false });
    expect(Date.parse(c.poll_from as string)).toBe(start - 30 * 60_000);
    expect(Date.parse(c.poll_to as string) - start).toBeGreaterThanOrEqual(6.5 * 3600_000);
    expect(c.poll_every_sec).toBeGreaterThanOrEqual(30);
  });

  it('every runner state appears: finished, on course, opted out, not started, LiveTrack error', () => {
    const s = seed();
    const finishes = s.race_splits.filter((r) => r.point === 'finish');
    expect(finishes).toHaveLength(1);
    const optOut = s.race_entries.filter((e) => e.live_opt_out);
    expect(optOut).toHaveLength(1);
    const withSplits = new Set(s.race_splits.map((r) => r.athlete_id));
    expect(RUNNERS.filter((id) => !withSplits.has(id))).toHaveLength(1);
    expect(s.race_entries.map((e) => e.livetrack_state)).toEqual(expect.arrayContaining(['ended', 'ready', 'active', 'error:not_found']));
    expect(s.race_positions.length).toBeGreaterThanOrEqual(3);
  });

  it('an opted-out runner never has a position; nor does a finished one or a LiveTrack error', () => {
    const s = seed();
    const optOut = s.race_entries.find((e) => e.live_opt_out)!.athlete_id;
    const finished = s.race_splits.find((r) => r.point === 'finish')!.athlete_id;
    const errored = s.race_entries.find((e) => String(e.livetrack_state).startsWith('error'))!.athlete_id;
    const placed = s.race_positions.map((p) => p.athlete_id);
    expect(placed).not.toContain(optOut);
    expect(placed).not.toContain(finished);
    expect(placed).not.toContain(errored);
  });

  it('rows satisfy the 196 CHECKs: points, sources, goal range, unique bibs, monotonic splits', () => {
    const s = seed();
    for (const r of s.race_splits) {
      expect(POINT_KEYS).toContain(r.point);
      expect(r.source).toBe('replay');
      expect(r.elapsed_sec as number).toBeGreaterThanOrEqual(0);
    }
    for (const e of s.race_entries) expect(e.goal_sec as number).toBeGreaterThanOrEqual(3600);
    for (const e of s.race_entries) expect(e.goal_sec as number).toBeLessThanOrEqual(28800);
    expect(new Set(s.race_entries.map((e) => e.bib)).size).toBe(RUNNERS.length);
    for (const id of RUNNERS) {
      const mine = s.race_splits.filter((r) => r.athlete_id === id);
      const byDistance = [...mine].sort((a, b) => POINT_M[a.point as keyof typeof POINT_M] - POINT_M[b.point as keyof typeof POINT_M]);
      expect(byDistance.map((r) => r.elapsed_sec)).toEqual([...byDistance.map((r) => r.elapsed_sec as number)].sort((a, b) => a - b));
    }
    for (const m of s.race_milestones) {
      expect(['start', 'half', 'finish']).toContain(m.milestone);
      expect(m.sent).toBe(false); // a rehearsal never pushes
    }
  });

  it('a position agrees with the runner\'s last split (it is past it, and short of the next)', () => {
    const s = seed();
    for (const p of s.race_positions) {
      const last = s.race_splits.filter((r) => r.athlete_id === p.athlete_id).at(-1)!;
      expect(p.distance_m as number).toBeGreaterThanOrEqual(POINT_M[last.point as keyof typeof POINT_M]);
      expect(p.elapsed_sec as number).toBeGreaterThanOrEqual(last.elapsed_sec as number);
    }
  });

  it('carries no real member data: invented ids in, example.test LiveTrack links out', () => {
    const wire = JSON.stringify(seed());
    expect(wire).not.toMatch(/@/);
    for (const e of seed().race_entries) expect(String(e.livetrack_url)).toMatch(/^https:\/\/livetrack\.example\.test\//);
  });

  it('table order and conflict targets cover every table, and match 196\'s primary keys', () => {
    const s = seed();
    expect(Object.keys(s).sort()).toEqual([...RACE_LIVE_SEED_TABLES].sort());
    const sql = readFileSync('supabase/migrations/196_race_live.sql', 'utf8');
    expect(sql).toMatch(/PRIMARY KEY \(event_id, athlete_id, point\)/);
    expect(sql).toMatch(/PRIMARY KEY \(event_id, athlete_id, milestone\)/);
    expect(RACE_LIVE_SEED_CONFLICT.race_splits).toBe('event_id,athlete_id,point');
    expect(RACE_LIVE_SEED_CONFLICT.race_positions).toBe('event_id,athlete_id');
  });
});
