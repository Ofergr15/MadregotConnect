import { describe, it, expect } from 'vitest';
import { toCelebration, celebrationText } from '@/lib/feed/celebration';

/** The compact celebration card (Ofer, 2026-10-18): a birthday, or any celebration, with an optional video. */
describe('toCelebration', () => {
  it('reads a birthday post, with or without a video', () => {
    expect(toCelebration({ birthdayOf: 'a1', honoreeId: 'a1', date: '2026-10-18' })).toEqual({ type: 'birthday', honorees: ['a1'], video: null });
    expect(toCelebration({ birthdayOf: 'a1', videoLink: 'https://youtu.be/x' })?.video).toBe('https://youtu.be/x');
  });
  it('reads a celebration made by hand; an unknown type is "other"', () => {
    expect(toCelebration({ kind: 'celebration', celebrationType: 'wedding', honoreeIds: ['a2'] })).toMatchObject({ type: 'wedding', honorees: ['a2'] });
    expect(toCelebration({ kind: 'celebration', celebrationType: 'graduation' })?.type).toBe('other');
  });
  it('a pasted script never becomes the watch button', () => {
    expect(toCelebration({ birthdayOf: 'a1', videoLink: 'javascript:alert(1)' })?.video).toBeNull();
  });
  it('leaves every other announcement alone', () => {
    expect(toCelebration({ notificationId: 'n1' })).toBeNull();
    expect(toCelebration({ kind: 'session_photos' })).toBeNull();
  });
});

describe('celebrationText', () => {
  it('drops the emoji the badge already shows', () => {
    expect(celebrationText('🎂 היום יום ההולדת של @[שלו](x)! מזל טוב 🎉', 'birthday')).toBe('היום יום ההולדת של @[שלו](x)! מזל טוב 🎉');
    expect(celebrationText('מזל טוב!', 'wedding')).toBe('מזל טוב!');
  });
});

describe('isCelebrationActive — the row at the top shows today only, or as long as set', async () => {
  const { isCelebrationActive } = await import('@/lib/feed/celebration');
  it('a birthday is on its own day only', () => {
    expect(isCelebrationActive({ birthdayOf: 'a', date: '2026-10-18' }, '2026-10-18')).toBe(true);
    expect(isCelebrationActive({ birthdayOf: 'a', date: '2026-10-18' }, '2026-10-19')).toBe(false);
  });
  it('a celebration made by hand runs from its day through `until`', () => {
    const p = { kind: 'celebration', celebrationType: 'wedding', date: '2026-10-18', until: '2026-10-20' };
    expect(isCelebrationActive(p, '2026-10-17')).toBe(false);
    expect(isCelebrationActive(p, '2026-10-20')).toBe(true);
    expect(isCelebrationActive(p, '2026-10-21')).toBe(false);
  });
  it('an `until` before the day is ignored — it is the day itself', () => {
    expect(isCelebrationActive({ kind: 'celebration', date: '2026-10-18', until: '2026-10-01' }, '2026-10-18')).toBe(true);
  });
  it('the feed never lists a celebration — it lives in the row at the top', async () => {
    const { readFileSync } = await import('fs');
    const page = readFileSync('src/app/(app)/feed/page.tsx', 'utf8');
    expect(page).toMatch(/!\(item\.type === 'announcement' && toCelebration\(item\.payload\)\)/);
    expect(page.indexOf('<CelebrationStories')).toBeLessThan(page.indexOf('<QualitySessionRow'));
  });
});

describe('cheers from Content are celebrations too', async () => {
  const { toCelebration, isCelebrationActive } = await import('@/lib/feed/celebration');
  it('a race cheer is a race, a record an achievement', () => {
    expect(toCelebration({ cheerFor: 's1', honoreeId: 's1', reason: 'race' })).toMatchObject({ type: 'race', honorees: ['s1'] });
    expect(toCelebration({ cheerFor: 's1', reason: 'record' })?.type).toBe('achievement');
    expect(toCelebration({ cheerFor: 's1', reason: 'comeback' })?.type).toBe('other');
  });
  it('a cheer is on the row the day it was published', () => {
    expect(isCelebrationActive({ cheerFor: 's1', reason: 'race' }, '2026-10-18', '2026-10-18')).toBe(true);
    expect(isCelebrationActive({ cheerFor: 's1', reason: 'race' }, '2026-10-19', '2026-10-18')).toBe(false);
  });
});
