import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { feedFocusFromParams, FOCUS_PARAMS } from '@/lib/feed/deep-link';

/**
 * Tapping a notification has to land on the thing the notification was about.
 *
 * Four senders write `/feed?item=<feed_item id>` — the like and comment pushes
 * (lib/feed/notify), the new-post push (POST /api/feed/posts) and the "see it in
 * the feed" link on a profile — and `/feed` read `?activity=` and `?kudos=` only.
 * So every one of those links opened the top of the feed instead, which for a
 * comment on a run from last week is the same as not linking at all. Reported as
 * "the notification doesn't take me to the comment".
 *
 * A sender and a reader that disagree about a param name is invisible in every
 * screenshot and in every type check, so the list is asserted from both ends
 * here: the resolver's `FOCUS_PARAMS`, and the URLs the senders actually build.
 */

const params = (q: string) => new URLSearchParams(q);
const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('feedFocusFromParams', () => {
  it('resolves a run by its activity id', () => {
    expect(feedFocusFromParams(params('activity=act-1'))).toEqual({ by: 'activity', id: 'act-1' });
  });

  it('still reads the legacy spelling sitting in old notification rows', () => {
    expect(feedFocusFromParams(params('kudos=act-1'))).toEqual({ by: 'activity', id: 'act-1' });
  });

  it('resolves a like/comment/post link by its feed item id', () => {
    // The fix: this used to be null, and null is the top of the feed.
    expect(feedFocusFromParams(params('item=fi-9'))).toEqual({ by: 'item', id: 'fi-9' });
  });

  it('prefers the activity id when a link carries both', () => {
    // The more specific of the two, and the one a run's own push sends.
    expect(feedFocusFromParams(params('item=fi-9&activity=act-1'))).toEqual({ by: 'activity', id: 'act-1' });
  });

  it('is null for a plain visit, and for an empty param', () => {
    expect(feedFocusFromParams(params(''))).toBeNull();
    expect(feedFocusFromParams(params('filter=runs'))).toBeNull();
    expect(feedFocusFromParams(params('item='))).toBeNull();
  });
});

describe('the senders and the feed page agree on the param names', () => {
  // Everything that deep-links into the feed. If a new sender appears with a new
  // param, this list is where it gets noticed.
  const SENDERS = [
    'lib/feed/notify.ts',
    'app/api/feed/posts/route.ts',
    'components/profile/ProfileOverview.tsx',
  ];

  it('emits no feed param the resolver cannot read', () => {
    const emitted = new Set<string>();
    for (const path of SENDERS) {
      // Links only — `/api/feed?types=…` is a fetch, not somewhere to send a reader.
      for (const m of src(path).matchAll(/(?<!\/api)\/(?:dashboard\/)?feed\?(\w+)=/g)) emitted.add(m[1]);
    }
    // Sanity: the scan found the senders at all, rather than passing on nothing.
    expect(emitted.size).toBeGreaterThan(0);
    expect([...emitted].filter((p) => !(FOCUS_PARAMS as readonly string[]).includes(p))).toEqual([]);
  });

  it('reads the params through the shared resolver, not a hand-written list', () => {
    // The whole bug was the page keeping its own copy of this reading.
    const page = src('app/(app)/feed/page.tsx');
    expect(page).toContain('feedFocusFromParams');
    expect(page).not.toContain("searchParams.get('activity')");
  });

  it('keeps the /dashboard/feed compat redirect, which old rows still point at', () => {
    // Those URLs are in the notifications table forever.
    expect(src('app/(app)/dashboard/feed/page.tsx')).toContain('redirect(');
  });
});
