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
