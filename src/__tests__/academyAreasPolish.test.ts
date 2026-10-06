import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The academy areas' audit fixes: nothing a manager or trainee reads is developer text or
 * raw English, the funnel folds its empty stages, and the trainee's own pending results are
 * fetched with the session the route now requires.
 */

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('TestRegistry', () => {
  const src = read('components/academy/TestRegistry.tsx');

  it('never tells the manager to run a migration', () => {
    expect(src).not.toMatch(/מיגרציה/);
    expect(src).toContain('הטסטים עוד לא מוגדרים');
  });

  it('keeps the per-trainee rows behind the summary', () => {
    expect(src).toContain('aria-expanded={showRows}');
    expect(src).toMatch(/\{showRows && <div/);
  });

  it('exposes the pending count for the shell\'s badge', async () => {
    const mod = await import('@/components/academy/TestRegistry');
    expect(typeof mod.usePendingTestsCount).toBe('function');
    expect(mod.pendingCountOf({ pending: [{}, {}] })).toBe(2);
    expect(mod.pendingCountOf({})).toBe(0);
    expect(mod.pendingCountOf(null)).toBe(0);
    expect(mod.pendingCountOf(undefined)).toBe(0);
  });
});

describe('raw English never reaches the screen', () => {
  it('registrations hide intake keys with no Hebrew label', () => {
    const src = read('components/AcademyRegistrations.tsx');
    expect(src).not.toContain('LABELS[k] || k');
    expect(src).toContain('k in LABELS');
  });

  it('the thread panel does not render Stream\'s own error', () => {
    const src = read('components/academy/AcademyThreadPanel.tsx');
    expect(src).not.toMatch(/setError\(e instanceof Error \? e\.message : String\(e\)\)/);
  });
});

describe('CandidateFunnel', () => {
  const src = read('components/academy/CandidateFunnel.tsx');

  it('folds empty stages into one line instead of a section each', async () => {
    expect(src).not.toContain(">אין אף אחד<");
    expect(src).toContain('column.candidates.length > 0');
    const { emptyStageLabel } = await import('@/components/academy/CandidateFunnel');
    expect(emptyStageLabel('ממתין לשיחת היכרות')).toBe('שיחת היכרות');
    expect(emptyStageLabel('ממתין לטסט 30 דקות')).toBe('טסט 30 דקות');
  });

  it('keeps the ?candidate= deep link, and reaches the registrations', () => {
    expect(src).toContain(".get('candidate')");
    expect(src).toContain('<AcademyRegistrations />');
  });
});

describe('ProfileBest', () => {
  it('fetches the trainee\'s own pending results with the session', () => {
    const src = read('components/ProfileBest.tsx');
    const pending = src.slice(src.indexOf('status=pending'), src.indexOf('setPending('));
    expect(pending).toContain('headers: await apiHeaders()');
  });
});

describe('the resend buttons', () => {
  it('watches screen and plans screen share one button', () => {
    const dispatch = read('components/academy/WatchDispatch.tsx');
    expect(dispatch).toContain("import { BuildButton, ResendButton } from './PlansWeekStatus'");
    expect(dispatch).toContain('<ResendButton');
    const week = read('components/academy/PlansWeekStatus.tsx');
    expect(week).toContain("'/api/academy/dispatch/resend'");
  });
});
