// QA 25.11 #3 and #4.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createMemoryDb } from './helpers/memory-db';
import { packSession, planPublishedAt } from '@/lib/packs/server';

// #3 — a draft is the coach mid-edit; the pack route must read only a published week (PLAN_STATUSES).
describe('pack route reads only published plans', () => {
  const seed = () => {
    const db = createMemoryDb({
      schema: {
        day_sessions: ['session_date', 'start_time', 'place', 'title', 'pack_paces', 'published_at'],
        weekly_plans: ['id', 'athlete_id', 'week_start_date', 'status', 'parsed_workouts', 'created_at'],
      },
    });
    const wk = (dayName: string) => ({ workouts: [{ dayOfWeek: 2, workoutName: dayName, steps: [] }] });
    db.tables.weekly_plans.push(
      { id: 'p1', athlete_id: null, week_start_date: '2026-11-22', status: 'pushed', parsed_workouts: wk('published'), created_at: '2026-11-21T10:00:00Z' },
      { id: 'p2', athlete_id: null, week_start_date: '2026-11-22', status: 'draft', parsed_workouts: wk('draft'), created_at: '2026-11-23T10:00:00Z' },
    );
    return db;
  };

  it('packSession ignores a newer draft', async () => {
    const s = await packSession(seed().client, '2026-11-24', 1);
    expect(s?.title).toBe('published');
  });

  it('planPublishedAt ignores a newer draft, and is null with only a draft', async () => {
    const db = seed();
    expect(await planPublishedAt(db.client, '2026-11-24')).toBe('2026-11-21T10:00:00Z');
    db.tables.weekly_plans.splice(0, 1);
    expect(await planPublishedAt(db.client, '2026-11-24')).toBeNull();
  });
});

// #4 — academy_payments.period is a DATE: 'YYYY-MM' is rejected by Postgres and safe() swallowed it,
// so "paid this month" always read 0. Pin the filter shape and the month source.
describe('hub retention: paid-this-month filter', () => {
  const src = readFileSync(new URL('../lib/academy/hub-server.ts', import.meta.url), 'utf8');
  it('compares period to the first of the current calendar month', () => {
    expect(src).toMatch(/academy_payments'\)\.select\('athlete_id'\)\.eq\('period', `\$\{month\}-01`\)/);
    expect(src).toMatch(/const month = monthKey\(now\)/);
    expect(src).not.toMatch(/const month = weekStart\.slice/);
  });
});
