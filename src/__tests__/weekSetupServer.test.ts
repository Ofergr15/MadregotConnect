import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

/** lib/week-setup/server.ts on an in-memory database (round 6, task 169). */
const pushes: Array<{ athleteId: string; url: string }> = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: async (p: { athleteId: string; url: string }) => { pushes.push(p); return { delivered: 1 }; } }));
vi.mock('@/lib/notifications/approval-server', () => ({ loadApprovals: async () => ({ mode: 'off' }), qualityOf: async () => null }));
vi.mock('@/lib/quality-session/photos-server', () => ({ readFolderLedger: async () => ({ '2026-11-24': { id: 'f1', name: 'x' } }), folderName: (d: string) => `folder ${d}` }));
vi.mock('@/lib/surveys', () => ({ pollsOfWeek: async () => [] }));
const W = await import('@/lib/week-setup/server');
const { COACH_ID } = await import('@/lib/constants');

let db: ReturnType<typeof createMemoryDb>;
const WEEK = '2026-11-22'; // Sunday
beforeEach(() => {
  pushes.length = 0;
  db = createMemoryDb({
    schema: {
      app_settings: ['key', 'value', 'updated_at'],
      weekly_plans: ['coach_id', 'athlete_id', 'week_start_date', 'status', 'created_at', 'parsed_workouts'],
      day_sessions: ['session_date', 'title', 'start_time', 'quality', 'nutrition'],
      program_weeks: ['week_number', 'week_start_date', 'training_pdf_url', 'nutrition_pdf_url'],
      scheduled_notifications: ['id', 'url', 'status', 'last_sent_at', 'kind', 'title_he', 'body_he', 'scheduled_at', 'next_run_at', 'audience_type'],
      athletes: ['id', 'name', 'role', 'extra_roles', 'is_super_user'],
      groups: ['id', 'name', 'coach_id', 'created_at'],
    },
  });
});

describe('settings', () => {
  it('readSetting parses JSON strings and objects, falls back on missing or broken values', async () => {
    db.tables.app_settings.push({ key: 's', value: '{"a":1}' }, { key: 'o', value: { b: 2 } }, { key: 'bad', value: '{nope' });
    expect(await W.readSetting(db.client, 's', null)).toEqual({ a: 1 });
    expect(await W.readSetting(db.client, 'o', null)).toEqual({ b: 2 });
    expect(await W.readSetting(db.client, 'bad', 'fb')).toBe('fb');
    expect(await W.readSetting(db.client, 'none', 'fb')).toBe('fb');
  });

  it('writeSetting upserts by key', async () => {
    await W.writeSetting(db.client, 'k', { v: 1 });
    await W.writeSetting(db.client, 'k', { v: 2 });
    expect(db.tables.app_settings).toHaveLength(1);
    expect(await W.readSetting(db.client, 'k', null)).toEqual({ v: 2 });
  });
});

describe('the week log', () => {
  it('logWeek appends with the actor, trims the detail, ignores a bad week', async () => {
    await W.logWeek(db.client, WEEK, { athleteId: 'a1', name: ' Ofer ' }, 'workouts', 'plan_uploaded' as never, 'x'.repeat(200));
    await W.logWeek(db.client, WEEK, null, 'polls', 'skipped' as never);
    await W.logWeek(db.client, 'not-a-week', null, 'polls', 'skipped' as never);
    const log = await W.loadWeekLog(db.client, WEEK);
    expect(log.map((e) => [e.by, e.name, e.step])).toEqual([['a1', 'Ofer', 'workouts'], [null, 'מדרגות', 'polls']]);
    expect(log[0].detail).toHaveLength(120);
    expect(await W.loadWeekLog(db.client, '2026-01-04')).toEqual([]);
  });

  it('whoOf names the caller, or the club for nobody', async () => {
    db.tables.athletes.push({ id: 'a1', name: 'Dana', role: 'admin', extra_roles: null, is_super_user: false });
    expect(await W.whoOf(db.client, 'a1')).toEqual({ athleteId: 'a1', name: 'Dana' });
    expect(await W.whoOf(db.client, 'ghost')).toEqual({ athleteId: 'ghost', name: 'מדרגות' });
    expect(await W.whoOf(db.client, null)).toEqual({ athleteId: null, name: 'מדרגות' });
  });

  it('tellWeekAdmins pushes to every admin and super user but the actor', async () => {
    db.tables.athletes.push(
      { id: 'a1', name: 'Admin', role: 'admin', extra_roles: null, is_super_user: false },
      { id: 'a2', name: 'Owner', role: 'runner', extra_roles: null, is_super_user: true },
      { id: 'a3', name: 'Coach', role: 'coach', extra_roles: null, is_super_user: false },
    );
    expect(await W.tellWeekAdmins(db.client, WEEK, 'a1', { title: 't', body: 'b' })).toBe(1);
    expect(pushes).toEqual([expect.objectContaining({ athleteId: 'a2', url: `/dashboard/week?week=${WEEK}` })]);
  });

  it('weekStartOf is the Sunday', () => {
    expect(W.weekStartOf('2026-11-26')).toBe(WEEK);
    expect(W.weekStartOf('2026-11-22T10:00:00Z')).toBe(WEEK);
  });
});

describe('loadWeek', () => {
  it('an empty week: no plan, default team days, week number 1, nothing ready', async () => {
    const w = await W.loadWeek(db.client, WEEK);
    expect(w.plan).toEqual({ status: 'none', createdAt: null });
    expect(w.teamDays).toEqual([2, 5]);
    expect(w.days).toHaveLength(7);
    expect(w.days[2].team).toBe(true);
    expect(w.weekNumber).toBe(1);
    expect(w.watches).toBeNull();
    expect(w.approvalMode).toBe('off');
    expect(w.folders).toEqual({ '2026-11-24': { id: 'f1', name: 'x' } });
  });

  it('reads the pushed plan on the middle lane, day sessions, PDFs, the quality pick and the staff', async () => {
    db.tables.weekly_plans.push(
      { coach_id: COACH_ID, athlete_id: null, week_start_date: WEEK, status: 'draft', created_at: '2026-11-20T00:00:00Z', parsed_workouts: {} },
      { coach_id: COACH_ID, athlete_id: null, week_start_date: WEEK, status: 'pushed', created_at: '2026-11-21T00:00:00Z', parsed_workouts: { group2: { workouts: [{ dayOfWeek: 2, name: 'Tempo', expectedDistanceM: 12_340 }, { dayOfWeek: 6, name: 'Easy', optional: true }] } } },
    );
    db.tables.day_sessions.push({ session_date: '2026-11-24', title: 'Track', start_time: '05:30:00', quality: true, nutrition: [{ when: 'before', text: 'gel' }] });
    db.tables.program_weeks.push({ week_number: 7, week_start_date: '2026-11-08', training_pdf_url: null, nutrition_pdf_url: null });
    db.tables.app_settings.push(
      { key: 'reminder_config', value: JSON.stringify({ teamDays: [2, 4], workoutHour: 6 }) },
      { key: 'quality_plan_days', value: JSON.stringify({ [WEEK]: [4] }) },
    );
    db.tables.athletes.push(
      { id: 's1', name: 'Coach', role: 'coach', extra_roles: null, is_super_user: false },
      { id: 's2', name: 'test admin', role: 'admin', extra_roles: null, is_super_user: false },
      { id: 's3', name: 'Owner', role: 'runner', extra_roles: null, is_super_user: true },
    );
    db.tables.groups.push({ id: 'g1', name: 'A', coach_id: COACH_ID, created_at: '2026-01-01' });

    const w = await W.loadWeek(db.client, WEEK);
    expect(w.plan.status).toBe('pushed');
    expect(w.days[2].sessions).toEqual([expect.objectContaining({ name: 'Tempo', km: 12.3, optional: false })]);
    expect(w.days[6].sessions[0].optional).toBe(true);
    expect(w.days[2].daySession).toEqual({ title: 'Track', startTime: '05:30', quality: true, nutrition: [{ when: 'before', text: 'gel' }] });
    expect(w.teamDays).toEqual([2, 4]);
    expect(w.workoutHour).toBe(6);
    // The hand pick wins over the day session's own quality flag.
    expect(w.qualityDays).toEqual([4]);
    expect(w.qualityPicked).toBe(true);
    // Two weeks after week 7.
    expect(w.weekNumber).toBe(9);
    expect(w.staff).toEqual([{ id: 's1', name: 'Coach', role: 'coach' }, { id: 's3', name: 'Owner', role: 'admin' }]);
    expect(w.groups).toEqual([{ id: 'g1', name: 'A' }]);
    expect(w.readiness).toBeTruthy();
  });
});
