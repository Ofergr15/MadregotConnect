import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * 72949cd6 — "when I pick somebody else's workout it comes out as though I did
 * it. And sharing, I think, should only be for my own workouts. Look at how
 * Strava handles this whole sharing business."
 *
 * Both sentences are one bug. The share card carries the run and nothing else —
 * no name, no group, no date — on the reasoning that whoever posts it to a story
 * is identified by the account they post it from. That is right for your own run
 * and wrong for a clubmate's: the same absent name that keeps the card clean is
 * what makes a teammate's 21k read as yours once it is on your story.
 *
 * The fix is the gate, not a name on the card, because that is the line Strava
 * draws too: the share image is for your own activity, and someone else's is a
 * link to their page — which a login-gated club app has no equivalent of.
 */

describe('the share card claims the run by omission', () => {
  const card = read('lib/feed/share-image.ts');

  it('puts no athlete on the card', () => {
    // The thing that makes the gate necessary. If a name ever lands here the
    // reasoning above changes and this test should be the one that says so.
    expect(card).not.toMatch(/\bauthor\b/);
    expect(card).not.toMatch(/athleteName|athlete_name/);
  });

  it('is rendered from the feed item, so it cannot self-correct', () => {
    // renderShareCard receives the whole FeedItem — the author is right there and
    // deliberately unused, which is why ownership has to be decided by the caller.
    expect(card).toMatch(/export async function renderShareCard\(/);
  });
});

describe('every surface offers share on your own run only', () => {
  it('the feed row, which is the one that did not', () => {
    const feed = read('components/FeedCard.tsx');
    expect(feed).toMatch(/const isMyActivity = !!myAthleteId && item\.activity\?\.athleteId === myAthleteId/);
    expect(feed).toMatch(/\{item\.activity && isMyActivity && \(/);
    // The old unconditional gate.
    expect(feed).not.toMatch(/\{item\.activity && \(\s*\n\s*<button\s*\n\s*onClick=\{\(\) => setShareOpen\(true\)\}/);
  });

  it('the activity detail page', () => {
    const detail = read('app/(app)/dashboard/activities/[activityId]/page.tsx');
    expect(detail).toMatch(/const isMyActivity = !!myAthleteId && act\.athlete_id === myAthleteId/);
    expect(detail).toMatch(/\{isMyActivity && \(/);
  });

  it('the activity list card', () => {
    const list = read('components/ActivityFeed.tsx');
    expect(list).toMatch(/const isMyActivity = !!myAthleteId && activity\.athlete_id === myAthleteId/);
    expect(list).toMatch(/\{isMyActivity && \(/);
  });

  it('decides ownership by athlete id, never by the card being tappable', () => {
    // A viewer who is staff can open run-chat on anybody's activity; that must
    // not also hand them a share button for it.
    const feed = read('components/FeedCard.tsx');
    expect(feed).toMatch(/const canOpenRunChat = !!item\.activity && \(isMyActivity \|\| isStaff\)/);
    const shareAt = feed.indexOf('{item.activity && isMyActivity && (');
    const shareBlock = feed.slice(shareAt, feed.indexOf('{canOpenRunChat &&'));
    expect(shareBlock).not.toMatch(/isStaff/);
  });
});

describe('cards with no activity never had a share button', () => {
  it('achievement and post rows pass no viewer id, and have nothing to share', () => {
    // They render ActionRow with myAthleteId={null}. Gating on isMyActivity would
    // have hidden a button there — except `item.activity` is already the outer
    // condition and those items have none, so nothing changed for them.
    const feed = read('components/FeedCard.tsx');
    expect(feed.match(/myAthleteId=\{null\}/g)!.length).toBe(2);
    expect(feed).toMatch(/Achievements are never activities/);
    expect(feed).toMatch(/Posts are never activities/);
  });
});
