import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { groupChangeDate, groupChangeDue } from '@/lib/groups/pending-change';

/**
 * A MEMBER CHANGES THEIR OWN PACE GROUP, FROM SATURDAY (feedback #96), for the
 * super user until rollout.
 */

const ROUTE = readFileSync('src/app/api/athletes/route.ts', 'utf8');
const TICK = readFileSync('src/app/api/cron/tick/route.ts', 'utf8');
const PAGE = readFileSync('src/app/(app)/dashboard/profile/page.tsx', 'utf8');
const MIGRATION = readFileSync('supabase/migrations/125_pending_group_change.sql', 'utf8');

describe('the Saturday a change takes effect', () => {
  it('is the next Saturday, and a week on when asked for on one', () => {
    expect(groupChangeDate('2026-09-30')).toBe('2026-10-03'); // Wednesday
    expect(groupChangeDate('2026-09-27')).toBe('2026-10-03'); // Sunday
    expect(groupChangeDate('2026-10-02')).toBe('2026-10-03'); // Friday
    expect(groupChangeDate('2026-10-03')).toBe('2026-10-10'); // Saturday
  });

  it('is due on that day and after, never before', () => {
    expect(groupChangeDue('2026-10-03', '2026-10-02')).toBe(false);
    expect(groupChangeDue('2026-10-03', '2026-10-03')).toBe(true);
    expect(groupChangeDue('2026-10-03', '2026-10-05')).toBe(true);
    expect(groupChangeDue(null, '2026-10-05')).toBe(false);
  });
});

describe('the change', () => {
  it('is the super user\'s own row only', () => {
    expect(ROUTE).toMatch(/if \(!auth\.user\.isSuperUser \|\| auth\.user\.athleteId !== id\) \{\s*return NextResponse\.json\(\{ error: 'forbidden' \}, \{ status: 403 \}\);/);
    expect(ROUTE).toMatch(/const from = groupId \? groupChangeDate\(israelToday\(\)\) : null;/);
  });

  it('is applied by the tick once due, and clears itself', () => {
    expect(TICK).toMatch(/\.lte\('pending_group_from', today\)/);
    expect(TICK).toMatch(/update\(\{ group_id: a\.pending_group_id, pending_group_id: null, pending_group_from: null \}\)/);
  });

  it('asks first, and says why it waits for Saturday', () => {
    expect(PAGE).toMatch(/const changesFromSaturday = useIsSuperUser\(\);/);
    expect(PAGE).toMatch(/const groupLocked = hasActivities && !changesFromSaturday;/);
    expect(PAGE).toMatch(/onClick=\{changesFromSaturday \? \(\) => setConfirmGroupChange\(true\) : saveGroup\}/);
    const he = JSON.parse(readFileSync('messages/he.json', 'utf8')).profile;
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8')).profile;
    for (const k of ['groupChangeTitle', 'groupChangeBody', 'groupChangeConfirm', 'groupChangePending', 'groupChangeCancel', 'groupChangeFromSat', 'cancel']) {
      expect(he[k], k).toBeTruthy();
      expect(en[k], k).toBeTruthy();
    }
  });

  it('says the new group shows on Saturday, before saving and while it waits', () => {
    expect(PAGE).toMatch(/\{changesFromSaturday && hasChanges && !groupLocked && \(\s*<p[^>]*>\s*\{t\('groupChangeShowsSat'/);
    expect(PAGE).toMatch(/t\('groupChangePendingNote', \{ current:/);
    expect(PAGE).toMatch(/\{changesFromSaturday && !groupLocked && \(\s*<div[^>]*>\s*<CalendarClock[\s\S]*?t\('groupChangeRuleTitle'\)[\s\S]*?t\('groupChangeRuleBody'\)/);
    const he = JSON.parse(readFileSync('messages/he.json', 'utf8')).profile;
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8')).profile;
    for (const k of ['groupChangeRuleTitle', 'groupChangeRuleBody']) { expect(he[k], k).toMatch(/שבת/); expect(en[k], k).toMatch(/Saturday/); }
    for (const k of ['groupChangeShowsSat', 'groupChangePendingNote']) {
      expect(he[k], k).toMatch(k === 'groupChangeShowsSat' ? /\{date\}/ : /\{current\}/);
      expect(en[k], k).toMatch(k === 'groupChangeShowsSat' ? /\{date\}/ : /\{current\}/);
    }
    expect(he.groupChangeBody).toMatch(/תופיע בפרופיל שלך בשבת/);
    expect(en.groupChangeBody).toMatch(/shows in your profile on Saturday/);
  });

  it('has a migration of bare DDL, nothing to kill the paste', () => {
    expect(MIGRATION).not.toMatch(/--/);
    expect(MIGRATION.trim().split('\n')).toHaveLength(2);
  });
});
