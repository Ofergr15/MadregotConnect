import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pendingReminderCopy } from '@/lib/notifications/copy';
import { requiresApproval } from '@/lib/auth/approval-gate';

/**
 * Reaching the member who waits for approval, and the approvers who must not
 * forget them (analysis 2026-10-10: everyone who waited days was lost).
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('pending-approval reminder copy', () => {
  it('names real names only, counts the rest, says how long the oldest waited', () => {
    const c = pendingReminderCopy('he', { names: ['Noa Levi', 'Strava Athlete', null, 'Dan Cohen', 'Yael Bar', 'Eli Mor'], count: 6, oldestDays: 27 });
    expect(c.title).toContain('6');
    expect(c.body).toContain('27');
    expect(c.body).not.toContain('Strava Athlete');
    expect(c.body).not.toMatch(/strava\.madregot\.local/);
  });
  it('one waiting member reads as one', () => {
    expect(pendingReminderCopy('en', { names: ['Noa Levi'], count: 1, oldestDays: 1 }).title).toMatch(/Someone/);
  });
});

describe('a pending member can leave an email', () => {
  it('the route is reachable before approval', () => {
    expect(requiresApproval('/api/onboarding/notify-email')).toBe(false);
  });
  it('the approval mails that address when the member\'s own is synthetic, and never writes it onto the athlete row', () => {
    const approve = read('app/api/admin/approve/route.ts');
    expect(approve).toMatch(/if \(isSynthetic\(athlete\.email\)\) \{[\s\S]{0,400}notify_email[\s\S]{0,300}notifyUserApproved\(\{ name: athlete\.name, email: to \}\)/);
    const route = read('app/api/onboarding/notify-email/route.ts');
    expect(route).toMatch(/from\('signup_requests'\)/);
    expect(route).not.toMatch(/from\('athletes'\)/);
  });
  it('the daily reminder runs from the tick at 09:00', () => {
    expect(read('app/api/cron/tick/route.ts')).toMatch(/if \(hour === 9\) \{\s+try \{\s+const waiting = await runPendingReminders/);
  });
});
