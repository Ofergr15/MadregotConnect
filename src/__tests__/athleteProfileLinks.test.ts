import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

/**
 * Tap a person, get that person.
 *
 * The report was one sentence — "כל לחיצה על בן אדם תוביל לפרויקט שלו" — and the
 * bug behind it was not a broken link. It was that a name being tappable was a
 * property of whichever screen you happened to be looking at: the feed card's
 * author went to a profile, the same person's face in the likes strip went
 * nowhere, their name in a leaderboard went nowhere, their row in the דבוקה list
 * went nowhere. Twenty-odd lists, each written on its own day, each making its
 * own decision.
 *
 * So the fix is a single helper (`teammateHref`) and a single wrapper
 * (`AthleteLink`), and this file is what stops the class of bug from coming back
 * rather than the instances. There is no @testing-library/react in this repo, so
 * component behaviour here is asserted by reading the source — the same
 * technique signOutClearsDevice.test.ts uses for "nobody hand-rolls this again".
 */

const SRC = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, SRC), 'utf8');

// ── the helper itself ─────────────────────────────────────────────────────────
const { teammateHref } = await import('@/lib/athletes/profile-link');

describe('teammateHref', () => {
  it('points at the peer profile route that already exists', () => {
    expect(teammateHref('abc')).toBe('/dashboard/teammate/abc');
  });

  it('returns null instead of a best-effort string when there is no id', () => {
    // This is the whole reason it returns null rather than a template result. A
    // nullable id is normal in this data (a coach-logged benchmark for a trainee
    // with no account, a system-authored feed item, a registration nobody has
    // claimed), and the alternative is a link to /dashboard/teammate/undefined
    // that looks live and 404s.
    expect(teammateHref(null)).toBeNull();
    expect(teammateHref(undefined)).toBeNull();
    expect(teammateHref('')).toBeNull();
    expect(teammateHref('   ')).toBeNull();
  });

  it('rejects the two ids that stringification invents', () => {
    // `${undefined}` and `${null}` in the old hand-built hrefs produced exactly
    // these, and they read as valid ids all the way to the route.
    expect(teammateHref('undefined')).toBeNull();
    expect(teammateHref('null')).toBeNull();
  });

  it('encodes the id, so a stray slash cannot rewrite the path', () => {
    expect(teammateHref('a/b')).toBe('/dashboard/teammate/a%2Fb');
  });
});

// ── every list that shows a person goes through it ────────────────────────────
/**
 * The enumerated sweep. A screen is on this list because it renders ANOTHER
 * member's name or face; being on it means the file must reference AthleteLink or
 * teammateHref. That is deliberately a weak assertion about any single file and a
 * strong one about the app: it cannot prove the right element is wrapped, but it
 * does mean nobody can delete the tappability from one of these screens, and a
 * reviewer adding the twenty-fourth person-list has a list to add themselves to.
 */
const PERSON_LISTS = [
  // Feed and its conversation
  'components/FeedCard.tsx',
  'components/FeedCommentSheet.tsx',
  'components/FeedLikesSheet.tsx',
  'components/FeedBodyText.tsx',
  'components/GroupRunCard.tsx',
  // Leaderboards and standings
  'components/LeaderboardsScreen.tsx',
  'components/WeeklyLeaderboardCard.tsx',
  'components/BenchmarkLeaderboard.tsx',
  'app/(app)/dashboard/groups/page.tsx',
  'app/(app)/dashboard/team-volume/page.tsx',
  // Attendance, RSVP and the דבוקה lists
  'components/AttendanceRoster.tsx',
  'app/(app)/dashboard/practice-attendance/page.tsx',
  'app/(app)/dashboard/calendar/[id]/page.tsx',
  // Coach-facing people lists
  'components/CoachPulse.tsx',
  'app/(app)/dashboard/workout-feedback/page.tsx',
  'components/CoreRunnersManager.tsx',
  // Activities
  'components/ActivityFeed.tsx',
  'app/(app)/dashboard/activities/[activityId]/page.tsx',
  // Academy
  'components/AcademyStats.tsx',
  'components/AcademyResults.tsx',
  'components/academy/AcademyMyView.tsx',
  'components/academy/MemberSheet.tsx',
  // Discovery, search, own profile
  'components/MemberDiscovery.tsx',
  'app/(app)/dashboard/search/page.tsx',
  'app/(app)/dashboard/profile/page.tsx',
  'components/Header.tsx',
  // Admin tables
  'app/(app)/dashboard/athletes/page.tsx',
  'app/(app)/dashboard/entry-queue/page.tsx',
  'app/(app)/dashboard/settings/page.tsx',
  'components/RegistrationsQueue.tsx',
  'components/admin/NotificationRouting.tsx',
];

describe('every person-list links the person', () => {
  it.each(PERSON_LISTS)('%s reaches the profile through the shared helper', (rel) => {
    const src = read(rel);
    expect(/AthleteLink|teammateHref/.test(src)).toBe(true);
  });

  it('nobody hand-builds the profile URL any more', () => {
    // A hardcoded `/dashboard/teammate/${id}` is not wrong on the day it is
    // written — it is wrong six months later, when it is the only one of
    // twenty-three that never learned about the null id, and when "which screens
    // link a person?" has no answer you can grep for.
    const offenders: string[] = [];
    const walk = (dir: URL, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
        const childRel = `${rel}${entry.name}`;
        if (entry.isDirectory()) { walk(child, `${childRel}/`); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/dashboard\/teammate\/\$\{/.test(readFileSync(child, 'utf8'))) offenders.push(childRel);
      }
    };
    walk(SRC, '');
    expect(offenders).toEqual([]);
  });
});

// ── the wrapper's two guarantees ──────────────────────────────────────────────
describe('AthleteLink', () => {
  const src = read('components/AthleteLink.tsx');

  it('degrades to plain text rather than a dead link', () => {
    expect(src).toContain('if (!href) return <span className={className}>{children}</span>;');
  });

  it('is a real anchor, never a span with an onClick', () => {
    // Focusable, Enter-activated, announced as a link, long-pressable. A div with
    // a handler is none of those, and every one of these sits in a list where the
    // keyboard is the only way through.
    expect(src).toContain("import Link from 'next/link'");
  });

  it('can stop a wrapper row from firing on BOTH pointer and keyboard', () => {
    // Half a guard is its own bug: with only the click handler stopped, a thumb
    // behaved correctly and Enter on the focused name navigated AND triggered the
    // row it sits in (GroupRunCard's runner row, ActivityFeed's expanding card,
    // NotificationRouting's accordion).
    expect(src).toContain('onKeyDown={stopPropagation');
    expect(src).toContain('if (stopPropagation) e.stopPropagation();');
  });
});

// ── the accessible name exists in both locales ────────────────────────────────
describe('link labels', () => {
  it('are present in Hebrew and English', () => {
    // The visible child of an AthleteLink is often a bare avatar or a first name,
    // so the aria-label is the only thing a screen reader has to go on. A key
    // missing from one locale renders as the key itself.
    for (const locale of ['he', 'en']) {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));
      expect(messages.common.viewProfileOf).toContain('{name}');
      expect(typeof messages.common.viewProfile).toBe('string');
    }
  });
});
