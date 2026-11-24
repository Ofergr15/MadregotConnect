import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MOMENT_KINDS, cleanMomentInput, draftFor, isMomentKind, momentState, onTime, windowOf } from '@/lib/academy/week-moments';
import { israelOffsetOn } from '@/lib/academy/week-moments-server';

const W = '2026-11-29'; // a plan week (Sunday)
const OFF = '+02:00';

describe('windows (doc p.2–3: Sat / Mon evening / Thu evening / Fri noon)', () => {
  it('places each moment on its day and hour, in Israel time', () => {
    expect(windowOf(W, 'plan', OFF)).toEqual({ date: '2026-11-28', at: '2026-11-28T20:00:00+02:00', by: '2026-11-28T21:00:00+02:00' });
    expect(windowOf(W, 'prep_tue', OFF).date).toBe('2026-11-30');
    expect(windowOf(W, 'prep_fri', OFF).date).toBe('2026-12-03');
    expect(windowOf(W, 'summary', OFF)).toMatchObject({ date: '2026-12-04', by: '2026-12-04T14:00:00+02:00' });
    expect(MOMENT_KINDS).toEqual(['plan', 'prep_tue', 'prep_fri', 'summary']);
    expect(isMomentKind('summary')).toBe(true);
    expect(isMomentKind('anything')).toBe(false);
  });
  it('knows Israel summer and winter time', () => {
    expect(israelOffsetOn('2026-12-01')).toBe('+02:00');
    expect(israelOffsetOn('2026-07-01')).toBe('+03:00');
  });
});

describe('state and on time', () => {
  const win = windowOf(W, 'prep_tue', OFF); // Mon 30.11, by 21:00
  it('upcoming → due → late, unless sent or scheduled', () => {
    expect(momentState(null, win, '2026-11-29T10:00:00+02:00', OFF)).toBe('upcoming');
    expect(momentState(null, win, '2026-11-30T08:00:00+02:00', OFF)).toBe('due');
    expect(momentState(null, win, '2026-11-30T21:30:00+02:00', OFF)).toBe('late');
    expect(momentState({ sent_at: '2026-11-30T19:31:00+02:00' }, win, '2026-12-01T09:00:00+02:00', OFF)).toBe('sent');
    expect(momentState({ scheduled_at: '2026-11-30T20:00:00+02:00' }, win, '2026-11-30T18:00:00+02:00', OFF)).toBe('scheduled');
  });
  it('on time is decided only once sent or past the deadline', () => {
    expect(onTime({ sent_at: '2026-11-30T20:59:00+02:00' }, win, '2026-12-01T00:00:00+02:00')).toBe(true);
    expect(onTime({ sent_at: '2026-11-30T21:05:00+02:00' }, win, '2026-12-01T00:00:00+02:00')).toBe(false);
    expect(onTime(null, win, '2026-11-30T20:00:00+02:00')).toBeNull();
    expect(onTime(null, win, '2026-11-30T22:00:00+02:00')).toBe(false);
  });
});

describe('drafts are drafts (doc p.1: nothing changes on its own)', () => {
  it('pre-writes from the plan and leaves the words to the coach', () => {
    expect(draftFor('prep_tue', { session: '6×1000' }).body).toBe('מחר 6×1000. ');
    expect(draftFor('prep_fri', {}).body).toContain('בשישי');
    const plan = draftFor('plan', { plannedKm: 48, sessions: 5 });
    expect(plan.body).toContain('48 ק״מ');
    expect(plan.goals[0].text).toBe('5 מתוך 5 אימונים');
    expect(draftFor('summary', { done: 31, planned: 40, km: 312.4 }).body).toBe('השבוע: 31 מתוך 40 אימונים בוצעו, 312 ק״מ. ');
  });
  it('the tick sends only what a coach scheduled', () => {
    const s = readFileSync(join(process.cwd(), 'src/lib/academy/week-moments-server.ts'), 'utf8');
    const d = s.slice(s.indexOf('export async function dispatchScheduledMoments'));
    expect(d).toContain(".not('scheduled_at', 'is', null)");
    expect(d).toContain(".lte('scheduled_at', nowIso)");
  });
  it('sending is claimed once (two presses, or a press plus the tick, send once)', () => {
    const s = readFileSync(join(process.cwd(), 'src/lib/academy/week-moments-server.ts'), 'utf8');
    expect(s).toContain(".update({ sent_at: nowIso, updated_at: nowIso }).eq('id', row.id).is('sent_at', null)");
  });
});

describe('input cleaning', () => {
  it('keeps only body, goals and notes keyed by an id', () => {
    const c = cleanMomentInput({ body: 'x'.repeat(5000), goals: [{ text: ' a ' }, { text: '' }, 3], notes: { 'not-an-id': 'n', '11111111-1111-1111-1111-111111111111': ' hi ' }, author_id: 'evil' });
    expect(typeof c).toBe('object');
    if (typeof c === 'string') return;
    expect(c.body.length).toBe(4000);
    expect(c.goals).toEqual([{ text: 'a' }]);
    expect(c.notes).toEqual({ '11111111-1111-1111-1111-111111111111': 'hi' });
    expect('author_id' in c).toBe(false);
    expect(cleanMomentInput({})).toBe('body is required');
  });
});

describe('identity comes from the JWT on every route', () => {
  const dir = join(process.cwd(), 'src/app/api/academy/week-moments');
  const files = ['route.ts', ...readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `${d.name}/route.ts`)];
  it.each(files)('%s gates on a verified caller and reads no author/athlete id from the body', (f) => {
    const s = readFileSync(join(dir, f), 'utf8');
    expect(s).toMatch(/requireStaffCaller|resolveVerifiedCaller|requireAcademyManager/);
    expect(s).not.toMatch(/b\.(authorId|author_id|athleteId|coachId|coach_id|email)\b/);
    expect(s).not.toMatch(/searchParams\.get\('(athleteId|coachId|authorId)'\)/);
  });
  it('migration 212 creates both tables with RLS on', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/212_academy_week_moments.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS academy_week_moments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS academy_week_moment_receipts');
    expect(sql).toContain('ALTER TABLE academy_week_moments ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('UNIQUE (week_start, kind, author_id)');
  });
});
