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
  // Every member since 2026-10-16 (was super user only): their OWN row — or a
  // coach's "from Saturday" in the pack sheet, who then tells the member at once.
  it("is the member's own row, or staff's", () => {
    expect(ROUTE).toMatch(/if \(auth\.user\.athleteId !== id && !auth\.user\.isStaff\) \{\s*return NextResponse\.json\(\{ error: 'forbidden' \}, \{ status: 403 \}\);/);
    expect(ROUTE).toMatch(/const from = groupId \? groupChangeDate\(israelToday\(\)\) : null;/);
    expect(ROUTE).toMatch(/if \(groupId && from && auth\.user\.athleteId !== id\) \{[\s\S]{0,200}notifyPackScheduled/);
  });

  // A coach's move used to leave the member's pending change in place, and the
  // tick then applied it on top — undoing the coach.
  it("is cancelled when a coach moves the member, so the tick can't undo the move", () => {
    const route = readFileSync(new URL('../app/api/athletes/route.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/updates\.group_id = groupId;\s*\/\/[\s\S]{0,300}updates\.pending_group_id = null;\s*updates\.pending_group_from = null;/);
  });

  it('is applied by the tick once due, and clears itself', () => {
    expect(TICK).toMatch(/\.lte\('pending_group_from', today\)/);
    expect(TICK).toMatch(/update\(\{ group_id: a\.pending_group_id, pending_group_id: null, pending_group_from: null \}\)/);
  });

  // The pack tiles (mockup pack-change/switch-mockup.html): the button names the
  // pack and the day, so it is the confirmation — no second sheet.
  it('is one button that says the pack and that it starts Saturday', () => {
    expect(PAGE).toMatch(/const changesFromSaturday = true;/);
    expect(PAGE).toMatch(/const groupLocked = hasActivities && !changesFromSaturday;/);
    expect(PAGE).toMatch(/onClick=\{changesFromSaturday \? \(\) => savePendingGroup\(selectedGroupId\) : saveGroup\}/);
    expect(PAGE).toMatch(/tp\('selfButton', \{ n: laneOf\(/);
    expect(PAGE).not.toMatch(/setConfirmGroupChange/);
    const he = JSON.parse(readFileSync('messages/he.json', 'utf8')).packSwitch;
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8')).packSwitch;
    expect(he.selfButton).toMatch(/משבת/);
    expect(en.selfButton).toMatch(/Saturday/);
  });

  it('says when the move lands and which pack they stay in until then', () => {
    expect(PAGE).toMatch(/tp\('selfRule', \{\s*date: dayMonth\(groupChangeDate\(israelToday\(\)\)\),/);
    expect(PAGE).toMatch(/t\('groupChangePendingNote', \{ current:/);
    const he = JSON.parse(readFileSync('messages/he.json', 'utf8'));
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
    for (const m of [he, en]) {
      expect(m.packSwitch.selfRule).toMatch(/\{date\}[\s\S]*\{n\}/);
      expect(m.profile.groupChangePendingNote).toMatch(/\{current\}/);
      expect(m.profile.groupChangeCancel).toBeTruthy();
    }
  });

  it('has a migration of bare DDL, nothing to kill the paste', () => {
    expect(MIGRATION).not.toMatch(/--/);
    expect(MIGRATION.trim().split('\n')).toHaveLength(2);
  });
});
