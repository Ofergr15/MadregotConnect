import { describe, expect, it, vi } from 'vitest';

/**
 * Staff mails are on the academy design (Hebrew, RTL, sunset header) like every
 * member mail. Four of them — the new-joiner alert first — stayed on the old English
 * left-to-right shell after 2026-10-10.
 */

const h = vi.hoisted(() => ({ sent: [] as Array<{ template: string; subject: string; html: string }> }));
vi.mock('@/lib/email/send', () => ({ sendEmail: async (m: { template: string; subject: string; html: string }) => { h.sent.push(m); return { ok: true }; } }));

import { notifyAdminNewSignupRequest, notifyAdminNewUser, notifyAdminUserApproved, sendAcademyWeeklyReport } from '@/lib/email';

describe('staff mails', () => {
  it('are all in Hebrew on the academy shell', async () => {
    h.sent = [];
    await notifyAdminNewSignupRequest({ email: 'dana@example.com', name: 'Dana Levi', groupName: 'Group B - SUB 2:35' });
    await notifyAdminNewUser({ name: 'Dana Levi', email: 'dana@example.com', onboardingStatus: 'garmin_authed' });
    await notifyAdminUserApproved({ email: 'a@x.com' }, { name: 'Dana Levi', email: 'dana@example.com' });
    await sendAcademyWeeklyReport({ weekStart: '2026-10-04', weekEnd: '2026-10-10', rows: [{ name: 'Shay', plannedCount: 4, completedCount: 3, completionRate: 0.75, avgScore: 0.8 } as never] });
    expect(h.sent).toHaveLength(4);
    for (const m of h.sent) {
      expect(m.html, m.template).toMatch(/dir="rtl"/);
      expect(m.html, m.template).toMatch(/logo-white\.png/);
      expect(m.subject, m.template).toMatch(/[֐-׿]/);
    }
  });

  it('names the pack the way the app does now', async () => {
    h.sent = [];
    await notifyAdminNewSignupRequest({ email: 'dana@example.com', name: 'Dana Levi', groupName: 'Group B - SUB 2:35' });
    expect(h.sent[0].html).toContain('דבוקה 2');
    expect(h.sent[0].subject).toBe('🏃 הצטרפות חדשה מחכה לאישור: Dana Levi');
  });

  it('still never prints a synthetic Strava address as if it were one', async () => {
    h.sent = [];
    await notifyAdminNewSignupRequest({ email: 'strava_1@strava.madregot.local', name: null, groupName: null });
    expect(h.sent[0].html).not.toContain('strava.madregot.local');
    expect(h.sent[0].subject).toContain('Strava');
  });
});
