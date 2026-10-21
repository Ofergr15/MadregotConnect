import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { IDLE, currentStep, targetsOf, tourReducer, wasOffered, type TourState } from '@/lib/tour/engine';
import { COACH_TOUR, PRACTICE_THRESHOLD_SEC, SAMPLE_WORKOUT } from '@/lib/tour/coach-tour';
import { practiceAnswer, startPractice, stopPractice, isPracticeActive } from '@/lib/tour/practice';
import { applyTourChange, mergePrefs, readTourPrefs } from '@/lib/tour/prefs';
import { hotspotVisible, HOTSPOTS } from '@/lib/tour/hotspots';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ who: null as string | null, db: null as unknown as ReturnType<typeof createMemoryDb> }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => h.db.client }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireAthlete: async () => (h.who ? { ok: true, user: { athleteId: h.who } } : { ok: false, status: 401, error: 'unauthorized' }),
}));

// The coach tour (mockups/coach-intro/v2.html): its state machine, the practice run that
// writes nothing, and "seen once" — persisted, replayable, never pushed again.

const run = (s: TourState, ...actions: Parameters<typeof tourReducer>[1][]) => actions.reduce((st, a) => tourReducer(st, a, COACH_TOUR), s);

describe('the tour state machine', () => {
  it('offers, then walks six steps, then closes', () => {
    let s = run(IDLE, { type: 'OFFER', tour: 'coach' });
    expect(s.phase).toBe('opening');
    s = run(s, { type: 'BEGIN' });
    expect(currentStep(s, COACH_TOUR)?.id).toBe('waiting');
    s = run(s, { type: 'NEXT' });
    expect(currentStep(s, COACH_TOUR)?.id).toBe('trainee');
    s = run(s, { type: 'TARGET_TAPPED', target: 'coach-trainee' });
    s = run(s, { type: 'TARGET_TAPPED', target: 'week-add-day' });
    s = run(s, { type: 'NEXT' }, { type: 'NEXT' });
    expect(currentStep(s, COACH_TOUR)?.id).toBe('send');
    s = run(s, { type: 'TARGET_TAPPED', target: 'day-send' });
    expect(s.phase).toBe('closing');
    s = run(s, { type: 'FINISH' });
    expect(s).toMatchObject({ phase: 'done', ended: 'done' });
  });

  it('a "do" step moves on ONLY when its own target is tapped', () => {
    let s = run(IDLE, { type: 'START', tour: 'coach' }, { type: 'NEXT' });
    expect(currentStep(s, COACH_TOUR)?.kind).toBe('do');
    expect(run(s, { type: 'NEXT' })).toEqual(s);
    expect(run(s, { type: 'TARGET_TAPPED', target: 'week-add-day' })).toEqual(s);
    expect(run(s, { type: 'TARGET_TAPPED', target: 'somewhere-else' })).toEqual(s);
    s = run(s, { type: 'TARGET_TAPPED', target: 'coach-trainee' });
    expect(currentStep(s, COACH_TOUR)?.id).toBe('day');
  });

  it('a "see" step ignores taps on its target and moves on with הבא', () => {
    const s = run(IDLE, { type: 'START', tour: 'coach' });
    expect(run(s, { type: 'TARGET_TAPPED', target: 'coach-waiting' })).toEqual(s);
    expect(currentStep(run(s, { type: 'NEXT' }), COACH_TOUR)?.id).toBe('trainee');
  });

  it('"אחר כך" and "דילוג" end it, and both count as offered', () => {
    const later = run(IDLE, { type: 'OFFER', tour: 'coach' }, { type: 'LATER' });
    expect(later).toMatchObject({ phase: 'done', ended: 'later' });
    const skipped = run(IDLE, { type: 'START', tour: 'coach' }, { type: 'NEXT' }, { type: 'SKIP' });
    expect(skipped).toMatchObject({ phase: 'done', ended: 'skipped' });
    expect(['done', 'later', 'skipped'].every(wasOffered)).toBe(true);
    expect(wasOffered(undefined)).toBe(false);
  });

  it('a replay starts at step 1 with no question, and the first step has a fallback target', () => {
    const s = run(IDLE, { type: 'START', tour: 'coach' });
    expect(s.phase).toBe('step');
    expect(targetsOf(COACH_TOUR.steps[0])).toEqual(['coach-waiting', 'coach-trainees']);
    expect(COACH_TOUR.steps.map((x) => x.kind)).toEqual(['see', 'do', 'do', 'see', 'see', 'do']);
  });
});

describe('practice mode writes nothing', () => {
  const real = vi.fn(async () => new Response('{"real":true}'));
  beforeEach(() => {
    real.mockClear();
    (globalThis as unknown as { window: unknown }).window = { fetch: real };
  });
  afterEach(() => { stopPractice(); delete (globalThis as { window?: unknown }).window; });

  it('holds back every non-GET to the API, answers the day-plan send, and lets reads through', async () => {
    startPractice();
    expect(isPracticeActive()).toBe(true);
    const w = (globalThis as unknown as { window: { fetch: typeof fetch } }).window;
    const sent = await w.fetch('/api/academy/day-plan', { method: 'POST', body: JSON.stringify({ recipients: ['a1'] }) });
    expect(await sent.json()).toMatchObject({ practice: true, results: [{ athleteId: 'a1', status: 'saved' }] });
    for (const path of ['/api/academy/library', '/api/garmin/push-workouts', '/api/academy/threads/messages', '/api/plans']) {
      const r = await w.fetch(path, { method: 'POST', body: '{}' });
      expect(await r.json()).toMatchObject({ practice: true });
    }
    await w.fetch('/api/academy/day-plan', { method: 'DELETE' });
    expect(real).not.toHaveBeenCalled();
    await w.fetch('/api/academy/day-plan?athleteId=x&date=2026-10-21');
    expect(real).toHaveBeenCalledTimes(1);
    // The tour's own "seen" flag is the one write that goes through.
    await w.fetch('/api/tours', { method: 'POST', body: '{"tour":"coach","state":"done"}' });
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('puts the real fetch back when practice ends', async () => {
    startPractice();
    stopPractice();
    const w = (globalThis as unknown as { window: { fetch: typeof fetch } }).window;
    await w.fetch('/api/plans', { method: 'POST' });
    expect(real).toHaveBeenCalledTimes(1);
    expect(practiceAnswer('/api/plans', 'GET', null)).toBeNull();
    expect(practiceAnswer('/somewhere', 'POST', null)).toBeNull();
  });

  it('the planner skips its request entirely in practice, with a stand-in threshold', () => {
    const src = readFileSync('src/components/academy/book/DayPlanner.tsx', 'utf8');
    expect(src).toMatch(/if \(practice\) \{[\s\S]*?go\('send'\);\s*return;/);
    expect(src).toContain('PRACTICE_THRESHOLD_SEC');
    expect(PRACTICE_THRESHOLD_SEC).toBe(270);
    expect(SAMPLE_WORKOUT).toContain('5×1');
  });
});

describe('seen once: persistence, replay and the blue dots', () => {
  it('stores how a tour ended and which dots were dismissed, keeping every other pref', () => {
    const base = { language: 'he', feedHiddenMeetups: ['m1'] };
    const a = applyTourChange(base, { tour: 'coach', state: 'later' })!;
    const b = applyTourChange(a, { hotspot: 'week-from-club' })!;
    expect(b).toMatchObject({ language: 'he', feedHiddenMeetups: ['m1'] });
    expect(readTourPrefs(b)).toEqual({ tours: { coach: 'later' }, hotspots: { 'week-from-club': true } });
    expect(readTourPrefs(applyTourChange(b, { reset: 'coach' }))).toEqual({ tours: {}, hotspots: { 'week-from-club': true } });
    expect(applyTourChange(b, { tour: 'coach', state: 'whatever' })).toBeNull();
    expect(applyTourChange(b, { hotspot: 'BAD KEY!' })).toBeNull();
  });

  it('seen on the device or on the server means seen', () => {
    const merged = mergePrefs({ tours: {}, hotspots: { 'book-entry': true } }, { tours: { coach: 'done' }, hotspots: {} });
    expect(merged).toEqual({ tours: { coach: 'done' }, hotspots: { 'book-entry': true } });
  });

  it('a dot shows once the prefs are known, never after הבנתי, never during a tour', () => {
    const none = { tours: {}, hotspots: {} };
    expect(hotspotVisible('zones-edit', { ready: false, prefs: none, tourRunning: false })).toBe(false);
    expect(hotspotVisible('zones-edit', { ready: true, prefs: none, tourRunning: false })).toBe(true);
    expect(hotspotVisible('zones-edit', { ready: true, prefs: none, tourRunning: true })).toBe(false);
    expect(hotspotVisible('zones-edit', { ready: true, prefs: { tours: {}, hotspots: { 'zones-edit': true } }, tourRunning: false })).toBe(false);
    expect(Object.keys(HOTSPOTS)).toEqual(['week-from-club', 'book-entry', 'zones-edit']);
  });
});

describe('/api/tours', () => {
  const ME = uid();
  beforeEach(() => {
    h.db = createMemoryDb({ schema: { athletes: ['id', 'notification_prefs'] } });
    h.db.tables.athletes.push({ id: ME, notification_prefs: { language: 'he' } });
    h.who = ME;
  });
  const req = (body?: unknown) => new Request('http://x/api/tours', body ? { method: 'POST', body: JSON.stringify(body) } : undefined);

  it('saves the end state and the dots, and reads them back', async () => {
    const route = await import('@/app/api/tours/route');
    expect(await (await route.GET(req())).json()).toEqual({ tours: {}, hotspots: {} });
    expect((await route.POST(req({ tour: 'coach', state: 'done' }))).status).toBe(200);
    expect((await route.POST(req({ hotspot: 'book-entry' }))).status).toBe(200);
    expect(await (await route.GET(req())).json()).toEqual({ tours: { coach: 'done' }, hotspots: { 'book-entry': true } });
    expect(h.db.tables.athletes[0].notification_prefs).toMatchObject({ language: 'he' });
    expect((await route.POST(req({ tour: 'coach', state: 'nope' }))).status).toBe(400);
  });

  it('refuses without a session', async () => {
    h.who = null;
    const route = await import('@/app/api/tours/route');
    expect((await route.GET(req())).status).toBe(401);
  });
});
