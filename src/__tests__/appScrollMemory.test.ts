import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeBackNavigation,
  forgetAppScroll,
  noteBackNavigation,
  recallAppScroll,
  rememberAppScroll,
  nextRestoreStep,
  RESTORE_DEADLINE_MS,
} from '@/lib/app-scroll';

/**
 * Back-navigation scroll restoration, as two pure pieces.
 *
 * The app shell has to do this by hand: <main> is the scroll container, not the
 * window, so the browser's own restoration restores an element that never moved.
 * Reported by a member 2026-09-08 — open a teammate from the feed, come back,
 * and the feed is at the top again.
 *
 * The DOM half (attaching listeners, reading the element) is exercised by using
 * the app; what is worth pinning here is the arithmetic, because both of its
 * failure modes are silent. Give up too early and the restore lands at 0 on any
 * screen that fetches its content; give up too late and the app yanks the list
 * out from under a user who has started scrolling.
 */

describe('app scroll memory', () => {
  beforeEach(() => forgetAppScroll());

  it('gives back what it was told', () => {
    rememberAppScroll('/feed', 1240);
    expect(recallAppScroll('/feed')).toBe(1240);
  });

  // A screen never visited is at its top, which is also the right answer for a
  // screen visited before the memory filled up and dropped it.
  it('answers zero for a screen it has never seen', () => {
    expect(recallAppScroll('/dashboard/practice')).toBe(0);
  });

  it('keeps only the newest offset per screen', () => {
    rememberAppScroll('/feed', 300);
    rememberAppScroll('/feed', 900);
    expect(recallAppScroll('/feed')).toBe(900);
  });

  // The container clamps a negative assignment to 0 anyway; storing one would
  // only make the memory disagree with the DOM.
  it('never remembers a negative offset', () => {
    rememberAppScroll('/feed', -40);
    expect(recallAppScroll('/feed')).toBe(0);
  });

  it('forgets one screen without forgetting the rest', () => {
    rememberAppScroll('/feed', 100);
    rememberAppScroll('/dashboard', 200);
    forgetAppScroll('/feed');
    expect(recallAppScroll('/feed')).toBe(0);
    expect(recallAppScroll('/dashboard')).toBe(200);
  });

  // The map is per tab and never garbage-collected by a route change, so it is
  // capped. The cap drops the least recently WRITTEN screen, and re-visiting a
  // screen counts as writing it — otherwise the feed, the one screen worth
  // remembering, would age out behind a walk through twenty dashboard tabs.
  it('drops the oldest screens once past its limit, keeping the recent ones', () => {
    for (let i = 0; i < 40; i++) rememberAppScroll(`/screen-${i}`, i + 1);
    expect(recallAppScroll('/screen-0')).toBe(0);
    expect(recallAppScroll('/screen-39')).toBe(40);
    expect(recallAppScroll('/screen-38')).toBe(39);
  });

  it('renews a screen it re-remembers rather than letting it age out', () => {
    rememberAppScroll('/feed', 500);
    for (let i = 0; i < 20; i++) rememberAppScroll(`/screen-${i}`, i + 1);
    rememberAppScroll('/feed', 600); // visited again, back to the front
    for (let i = 20; i < 40; i++) rememberAppScroll(`/screen-${i}`, i + 1);
    expect(recallAppScroll('/feed')).toBe(600);
  });
});

/**
 * The escape hatch for a back affordance that has to push.
 *
 * /dashboard/review can't use `router.back()` — it is reached from the More sheet,
 * a link and a cold tab — so it pushes its origin path, and the shell read that as
 * a forward navigation and reset the destination to the top. Filing a bug report
 * from halfway down the feed cost you your place in the feed (71806857).
 */
describe('back-intent', () => {
  beforeEach(() => consumeBackNavigation());

  it('is not set by default', () => {
    expect(consumeBackNavigation()).toBe(false);
  });

  it('reports a declared intent', () => {
    noteBackNavigation();
    expect(consumeBackNavigation()).toBe(true);
  });

  // Once, or a single tap of "back to the feed" would also restore the scroll of
  // whatever screen the user opened next.
  it('answers only once', () => {
    noteBackNavigation();
    expect(consumeBackNavigation()).toBe(true);
    expect(consumeBackNavigation()).toBe(false);
  });

  // The navigation it belongs to happens immediately. An intent still standing a
  // second later belongs to nothing, and spending it on the next forward
  // navigation would restore a screen the user meant to open fresh.
  it('expires rather than waiting for a navigation that never came', () => {
    noteBackNavigation(1_000);
    expect(consumeBackNavigation(1_000 + 999)).toBe(true);
    noteBackNavigation(1_000);
    expect(consumeBackNavigation(1_000 + 1_001)).toBe(false);
  });
});

describe('nextRestoreStep', () => {
  const tall = { at: 0, scrollHeight: 8000, clientHeight: 800 };

  it('scrolls straight to the offset when the content is already there', () => {
    expect(nextRestoreStep(1200, tall, 0, RESTORE_DEADLINE_MS, null))
      .toEqual({ set: 1200, retry: false });
  });

  // The screen mounts with a skeleton, one viewport tall: 1200 is not reachable
  // yet and assigning it would silently become 0. So it scrolls as far as it can
  // and comes back next frame.
  it('scrolls as far as it can and asks to be called again', () => {
    const short = { at: 0, scrollHeight: 900, clientHeight: 800 };
    expect(nextRestoreStep(1200, short, 16, RESTORE_DEADLINE_MS, null))
      .toEqual({ set: 100, retry: true });
  });

  it('stops asking once the content has caught up', () => {
    const grown = { at: 100, scrollHeight: 4000, clientHeight: 800 };
    expect(nextRestoreStep(1200, grown, 120, RESTORE_DEADLINE_MS, 100))
      .toEqual({ set: 1200, retry: false });
  });

  // A screen whose content never arrives — offline, or a list that came back
  // shorter than it was — must not spin for the rest of the session.
  it('gives up at the deadline, leaving the list where it can reach', () => {
    const short = { at: 100, scrollHeight: 900, clientHeight: 800 };
    expect(nextRestoreStep(1200, short, RESTORE_DEADLINE_MS + 1, RESTORE_DEADLINE_MS, 100))
      .toEqual({ set: 100, retry: false });
  });

  // The user is faster than the fetch: they land back on the feed and start
  // scrolling while the restore is still waiting for content. Their scroll wins.
  it('yields to a user who has started scrolling', () => {
    const moved = { at: 2400, scrollHeight: 8000, clientHeight: 800 };
    expect(nextRestoreStep(1200, moved, 200, RESTORE_DEADLINE_MS, 100))
      .toEqual({ set: 2400, retry: false });
  });

  // ...but not to the browser's own clamp, which lands a pixel or two off and is
  // not a user. Treating that as "hands off" would abandon every restore that
  // needed a second frame.
  it('is not fooled by the clamp landing a couple of pixels off', () => {
    const clamped = { at: 98, scrollHeight: 900, clientHeight: 800 };
    expect(nextRestoreStep(1200, clamped, 30, RESTORE_DEADLINE_MS, 100))
      .toEqual({ set: 100, retry: true });
  });

  // First frame: there is nothing to compare against yet, so "the offset is not
  // where I put it" cannot be a takeover.
  it('does not read the starting position as a takeover', () => {
    const scrolled = { at: 3000, scrollHeight: 8000, clientHeight: 800 };
    expect(nextRestoreStep(1200, scrolled, 0, RESTORE_DEADLINE_MS, null))
      .toEqual({ set: 1200, retry: false });
  });

  // Forward navigation goes through the same call with 0, and must be one plain
  // assignment with no retry loop behind it.
  it('treats a target of zero as a single reset', () => {
    expect(nextRestoreStep(0, tall, 0, RESTORE_DEADLINE_MS, null))
      .toEqual({ set: 0, retry: false });
  });

  it('never scrolls past the end of the content', () => {
    const short = { at: 0, scrollHeight: 1000, clientHeight: 800 };
    expect(nextRestoreStep(50_000, short, 0, RESTORE_DEADLINE_MS, null).set).toBe(200);
  });

  // A container that doesn't overflow at all: clientHeight can exceed
  // scrollHeight by a sub-pixel rounding, and a negative scrollTop is not a thing.
  it('never asks for a negative offset', () => {
    const flat = { at: 0, scrollHeight: 799, clientHeight: 800 };
    expect(nextRestoreStep(600, flat, 0, RESTORE_DEADLINE_MS, null).set).toBe(0);
  });
});
