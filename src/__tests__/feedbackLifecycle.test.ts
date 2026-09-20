import { describe, expect, it } from 'vitest';
import {
  compareAppVersions, feedbackView, FEEDBACK_VIEWS, groupDuplicates,
  reporterNeedsReload, viewCounts, type LifecycleRow,
} from '@/lib/feedback/lifecycle';

/**
 * The bug panel's drawers.
 *
 * Every rule pinned here is one the old panel got wrong: a fixed bug reading as
 * untouched, one bug appearing four times, a wish inflating the red count, and a
 * report that belonged to no view at all and so was invisible.
 */

const row = (over: Partial<LifecycleRow> = {}): LifecycleRow => ({ id: 'r1', ...over });

describe('which drawer a report is in', () => {
  it('puts a fresh bug in the inbox', () => {
    expect(feedbackView(row({ status: 'new', category: 'bug_report' }))).toBe('inbox');
  });

  it('puts a fresh WISH in ideas, so the red count stays about things that are broken', () => {
    expect(feedbackView(row({ status: 'new', category: 'feature_request' }))).toBe('ideas');
  });

  it('puts anything with a branch in flight', () => {
    expect(feedbackView(row({ status: 'sprint' }))).toBe('flight');
  });

  it('separates shipped-but-unconfirmed from confirmed', () => {
    expect(feedbackView(row({ status: 'done' }))).toBe('shipped');
    expect(feedbackView(row({ status: 'done', verified_at: '2026-09-19T08:00:00Z' }))).toBe('archive');
  });

  it('files a denial rather than leaving it in the pile to be re-decided', () => {
    expect(feedbackView(row({ status: 'denied' }))).toBe('archive');
  });

  it('never leaves a merged copy as its own thing to triage', () => {
    expect(feedbackView(row({ status: 'new', duplicate_of: 'r0' }))).toBe('archive');
  });

  it('lets an explicit archive beat every other reading', () => {
    expect(feedbackView(row({ status: 'new', archived_at: '2026-09-01T00:00:00Z' }))).toBe('archive');
  });

  it('treats a pre-migration row exactly as status alone would have', () => {
    // Every 116 column null: this is the whole of the degrade-gracefully promise.
    expect(feedbackView(row({ status: 'new' }))).toBe('inbox');
    expect(feedbackView(row({ status: null }))).toBe('inbox');
  });

  it('gives every report exactly one drawer', () => {
    const all: LifecycleRow[] = [
      row({ id: 'a', status: 'new' }), row({ id: 'b', status: 'sprint' }),
      row({ id: 'c', status: 'done' }), row({ id: 'd', status: 'denied' }),
      row({ id: 'e', status: 'idea' }),
    ];
    const counts = viewCounts(all);
    expect(FEEDBACK_VIEWS.reduce((n, v) => n + counts[v], 0)).toBe(all.length);
  });

  it('counts the empty drawers as zero rather than leaving them out', () => {
    // The switcher renders all five; a missing key would shift the chips sideways
    // every time a report changed state.
    expect(Object.keys(viewCounts([]))).toHaveLength(FEEDBACK_VIEWS.length);
  });
});

describe('comparing app versions', () => {
  it('orders by number, not by string — 2.40.9 is older than 2.40.10', () => {
    expect(compareAppVersions('2.40.9', '2.40.10')).toBeLessThan(0);
    expect(compareAppVersions('2.40.94', '2.40.94')).toBe(0);
    expect(compareAppVersions('2.41.0', '2.40.99')).toBeGreaterThan(0);
  });

  it('treats a missing or unreadable version as zeros instead of throwing', () => {
    expect(compareAppVersions(null, undefined)).toBe(0);
    expect(compareAppVersions('', '0.0.0')).toBe(0);
    expect(compareAppVersions('dev', '2.40.94')).toBeLessThan(0);
  });

  it('compares a short version against a long one', () => {
    expect(compareAppVersions('2.40', '2.40.1')).toBeLessThan(0);
  });
});

describe('whether the reporter still has the bug', () => {
  it('is true when they filed it on a build older than the fix', () => {
    expect(reporterNeedsReload(row({
      status: 'done', fixed_in_version: '2.40.35', context: { appVersion: '2.40.31' },
    }))).toBe(true);
  });

  it('is false once they are on the fix or past it', () => {
    expect(reporterNeedsReload(row({
      status: 'done', fixed_in_version: '2.40.35', context: { appVersion: '2.40.35' },
    }))).toBe(false);
  });

  it('says nothing when it cannot know — no nudge on no evidence', () => {
    expect(reporterNeedsReload(row({ status: 'done', context: { appVersion: '2.40.31' } }))).toBe(false);
    expect(reporterNeedsReload(row({ status: 'done', fixed_in_version: '2.40.35' }))).toBe(false);
    expect(reporterNeedsReload(row({ status: 'done', fixed_in_version: '2.40.35', context: null }))).toBe(false);
  });
});

describe('one issue, N reports', () => {
  const rows: LifecycleRow[] = [
    row({ id: 'primary', status: 'new' }),
    row({ id: 'copy1', duplicate_of: 'primary' }),
    row({ id: 'copy2', duplicate_of: 'primary' }),
    row({ id: 'other', status: 'new' }),
  ];

  it('returns one row per thing, with the copies attached', () => {
    const issues = groupDuplicates(rows);
    expect(issues.map(i => i.primary.id)).toEqual(['primary', 'other']);
    expect(issues[0].duplicates.map(d => d.id)).toEqual(['copy1', 'copy2']);
    expect(issues[0].reporterCount).toBe(3);
    expect(issues[1].reporterCount).toBe(1);
  });

  it('keeps a copy visible when its primary is not on the page', () => {
    // The list is capped at 100 rows. A copy pointing off the end of it must not
    // disappear from every view — invisible is worse than duplicated.
    const orphan = groupDuplicates([row({ id: 'copy', duplicate_of: 'gone' })]);
    expect(orphan.map(i => i.primary.id)).toEqual(['copy']);
  });

  it('cannot be hung by a row that points at itself', () => {
    expect(groupDuplicates([row({ id: 'x', duplicate_of: 'x' })]).map(i => i.primary.id)).toEqual(['x']);
  });

  it('cannot be hung by a cycle written by a bad paste', () => {
    const cycle = groupDuplicates([
      row({ id: 'a', duplicate_of: 'b' }),
      row({ id: 'b', duplicate_of: 'a' }),
    ]);
    // Both are copies of each other, so neither is a primary and the panel shows
    // no issue rather than looping forever. Wrong, but recoverable by editing
    // either row — and it terminates, which is the property being pinned.
    expect(cycle).toHaveLength(0);
  });
});
