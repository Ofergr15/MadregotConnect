import { describe, expect, it } from 'vitest';
import {
  installAnsweredForPush,
  isSignupDay,
  pickSurface,
  STRIP_EVERY_MS,
  type SurfaceContext,
} from '@/lib/onboarding-surface';

const DAY = 86_400_000;
// 2026-11-17 10:00 Israel time
const NOW = Date.parse('2026-11-17T08:00:00Z');

function ctx(over: Partial<SurfaceContext> = {}): SurfaceContext {
  return {
    now: NOW,
    native: false,
    standalone: false,
    loaded: true,
    memberSince: new Date(NOW - 60 * DAY).toISOString(),
    tourUnseen: false,
    whatsNew: 'none',
    installOffer: false,
    sheetDismissed: false,
    installDismissedForever: false,
    canOffer: true,
    stripHiddenUntil: 0,
    sessionSurface: null,
    ...over,
  };
}
const day0 = new Date(NOW - 2 * 3600_000).toISOString();
const day2 = new Date(NOW - 2 * DAY).toISOString();

describe('pickSurface', () => {
  it('new user on day 0: the tour, and no install sheet even with an offer', () => {
    const c = ctx({ memberSince: day0, tourUnseen: true, installOffer: true, whatsNew: 'pending' });
    expect(pickSurface(c)).toBe('tour');
  });

  it('new user on day 0 after the tour: still no install sheet (signup day)', () => {
    const c = ctx({ memberSince: day0, tourUnseen: false, installOffer: true });
    expect(isSignupDay(day0, NOW)).toBe(true);
    expect(pickSurface(c)).toBeNull();
    // ...and push is unblocked as if install had been answered
    expect(installAnsweredForPush(c, false)).toBe(true);
  });

  it('new user never gets What\'s New', () => {
    expect(pickSurface(ctx({ memberSince: day2, whatsNew: 'pending' }))).toBeNull();
  });

  it('returning user with unseen news: What\'s New, not the install sheet', () => {
    const c = ctx({ whatsNew: 'pending', installOffer: true });
    expect(pickSurface(c)).toBe('whatsNew');
    expect(installAnsweredForPush(c, false)).toBe(true);
  });

  it('returning user who never saw the tour does not get it', () => {
    expect(pickSurface(ctx({ tourUnseen: true }))).toBeNull();
  });

  it('returning user waits for the What\'s New report before install', () => {
    const c = ctx({ whatsNew: 'unknown', installOffer: true });
    expect(pickSurface(c)).toBeNull();
    expect(installAnsweredForPush(c, false)).toBe(false);
  });

  it('day 1+ install: the sheet, and push waits for its answer', () => {
    const c = ctx({ memberSince: day2, installOffer: true });
    expect(isSignupDay(day2, NOW)).toBe(false);
    expect(pickSurface(c)).toBe('installSheet');
    expect(installAnsweredForPush(c, false)).toBe(false);
    expect(installAnsweredForPush(c, true)).toBe(true);
  });

  it('the very next calendar day counts as day 1 even under 24h', () => {
    const lateLastNight = Date.parse('2026-11-16T21:30:00Z'); // 23:30 Israel, 16th
    expect(pickSurface(ctx({ memberSince: new Date(lateLastNight).toISOString(), installOffer: true }))).toBe('installSheet');
  });

  it('strip only after the sheet was dismissed', () => {
    expect(pickSurface(ctx({ sheetDismissed: false }))).toBeNull();
    expect(pickSurface(ctx({ sheetDismissed: true }))).toBe('installStrip');
  });

  it('strip shown within 7 days: hidden; after 7 days: back', () => {
    const shownAt = NOW - 3 * DAY;
    expect(pickSurface(ctx({ sheetDismissed: true, stripHiddenUntil: shownAt + STRIP_EVERY_MS }))).toBeNull();
    const older = NOW - 8 * DAY;
    expect(pickSurface(ctx({ sheetDismissed: true, stripHiddenUntil: older + STRIP_EVERY_MS }))).toBe('installStrip');
  });

  it('strip never after "don\'t offer again"', () => {
    expect(pickSurface(ctx({ sheetDismissed: true, installDismissedForever: true }))).toBeNull();
  });

  it('standalone: no sheet, no strip, even if one claimed the session', () => {
    expect(pickSurface(ctx({ standalone: true, installOffer: true }))).toBeNull();
    expect(pickSurface(ctx({ standalone: true, sheetDismissed: true }))).toBeNull();
    expect(pickSurface(ctx({ standalone: true, sessionSurface: 'installStrip' }))).toBeNull();
  });

  it('native shell suppresses everything, and never blocks push', () => {
    for (const c of [
      ctx({ native: true, memberSince: day0, tourUnseen: true }),
      ctx({ native: true, whatsNew: 'pending' }),
      ctx({ native: true, installOffer: true }),
      ctx({ native: true, sheetDismissed: true }),
      ctx({ native: true, sessionSurface: 'tour' }),
    ]) {
      expect(pickSurface(c)).toBeNull();
      expect(installAnsweredForPush(c, false)).toBe(true);
    }
  });

  it('never two at once: a claimed session keeps its one surface', () => {
    const all = ctx({ memberSince: day2, tourUnseen: true, whatsNew: 'pending', installOffer: true, sheetDismissed: true });
    for (const held of ['tour', 'whatsNew', 'installSheet', 'installStrip'] as const) {
      expect(pickSurface({ ...all, sessionSurface: held })).toBe(held);
    }
    // After the tour ran, the rest of the session stays quiet
    expect(pickSurface({ ...all, tourUnseen: false, sessionSurface: 'tour' })).toBe('tour');
  });

  it('never two at once: exhaustive sweep returns a single surface or none', () => {
    const bools = [false, true];
    for (const memberSince of [day0, day2, null, new Date(NOW - 30 * DAY).toISOString()])
      for (const tourUnseen of bools) for (const installOffer of bools) for (const sheetDismissed of bools)
        for (const whatsNew of ['unknown', 'pending', 'none'] as const) {
          const c = ctx({ memberSince, tourUnseen, installOffer, sheetDismissed, whatsNew });
          const first = pickSurface(c);
          if (!first) continue;
          // Once it claims the session, every other surface is shut out for the visit,
          // even after its own reason goes away.
          const later = pickSurface({ ...c, sessionSurface: first, tourUnseen: false, whatsNew: 'none', installOffer: !installOffer });
          expect(later).toBe(first);
        }
  });

  it('not loaded yet: nothing, and push waits', () => {
    const c = ctx({ loaded: false, installOffer: true });
    expect(pickSurface(c)).toBeNull();
    expect(installAnsweredForPush(c, false)).toBe(false);
  });
});
