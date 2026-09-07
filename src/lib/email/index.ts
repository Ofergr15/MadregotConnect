import { APP_URL, APPROVER_EMAILS } from '@/lib/constants';
import { renderEmail, esc } from './template';
import { sendEmail, type SendResult } from './send';

/**
 * Every email this app sends, one function each.
 *
 * The import path is unchanged (`@/lib/email`) so no caller moved, but the contract
 * did, and it is the point of the whole exercise:
 *
 *   **Every function returns a `SendResult`. None of them throws, and none of them
 *   returns `void`.**
 *
 * They used to return `undefined` and swallow both "no API key" and Resend's
 * `{ error }` refusals, which is how an approval came to report a delivered link to
 * somebody who never got one. A caller can now only be wrong on purpose.
 *
 * Layout, colours and escaping live in ./template. Sending, logging and the honest
 * result live in ./send. This file is only *what each mail says* — which is where it
 * should be possible to make a change without thinking about infrastructure.
 */

export { isEmailConfigured, diagnoseEmail, readEmailConfig, SANDBOX_FROM_ADDRESS } from './config';
export type { EmailConfig, EmailHealth, EmailHealthLevel } from './config';
export { sendEmail } from './send';
export type { SendResult, SendStatus, OutboundEmail } from './send';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'madregot.club@gmail.com';

// ── Legacy Google/Garmin onboarding ──────────────────────────────────────────────

export async function notifyAdminNewUser(user: {
  name: string;
  email: string;
  onboardingStatus: string;
  hasGarmin?: boolean;
}): Promise<SendResult> {
  const authStatusMap: Record<string, string> = {
    garmin_authed: '✅ Google + Garmin connected',
    google_authed: '⚠️ Google only (skipped Garmin)',
  };
  const authStatus =
    authStatusMap[user.onboardingStatus] || (user.hasGarmin ? '✅ Google + Garmin' : '⚠️ Google only');

  return sendEmail({
    template: 'admin_new_user',
    to: ADMIN_EMAIL,
    subject: `🏃 New user waiting for approval: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New user registration',
      rows: [['Name', user.name], ['Email', user.email], ['Auth', authStatus], ['Status', user.onboardingStatus]],
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/settings` },
    }),
  });
}

export async function notifyUserApproved(user: { name: string; email: string }): Promise<SendResult> {
  return sendEmail({
    template: 'user_approved',
    to: user.email,
    subject: '✅ Welcome to Madregot! You\'re approved',
    html: renderEmail({
      dir: 'ltr',
      title: `Welcome, ${user.name}! 🎉`,
      paragraphs: ['Your account has been approved. You can now access the full Madregot training platform.'],
      cta: { label: 'Open Madregot →', href: `${APP_URL}/dashboard` },
    }),
  });
}

export async function notifyAdminUserApproved(
  admin: { email: string },
  user: { name: string; email: string },
): Promise<SendResult> {
  return sendEmail({
    template: 'admin_user_approved',
    to: admin.email,
    subject: `✅ User approved: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'User approved',
      paragraphs: [`${user.name} (${user.email}) has been approved and notified.`],
    }),
  });
}

// ── Public /register form (migration 083, signup_requests) ───────────────────────
//
// Two mails, one each side of the approval:
//   notifyAdminNewSignupRequest  → the approvers, "someone registered"
//   notifyRegistrationApproved   → the applicant, WITH the link to finish
//
// The second is the whole point of the feature, and it is why this is not
// notifyUserApproved: that one links to /dashboard, which a person who has only ever
// given an email address cannot use. They have no name and no watch connected, so
// what they need is /join/{token} — the flow that asks for both.

export async function notifyAdminNewSignupRequest(req: {
  email: string;
  groupName?: string | null;
}): Promise<SendResult> {
  return sendEmail({
    template: 'admin_new_signup_request',
    // The approver list, not just ADMIN_EMAIL: whoever is nearest their phone should
    // be able to let a new runner in.
    to: APPROVER_EMAILS,
    subject: `🏃 New registration waiting: ${req.email}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New registration',
      rows: [['Email', req.email], ['Group', req.groupName || '—']],
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/settings?tab=registrations` },
      notes: ['They cannot enter the app until someone approves this.'],
    }),
  });
}

/**
 * The approval mail — Hebrew, because the recipient is a club member and the app is
 * Hebrew-first. This is the ONE email here that somebody reads before they have an
 * account, so it carries the link and nothing else to do.
 *
 * ⚠️ If this one fails, a person is approved, waiting, and has no idea. That is why
 * its result is read by both callers and surfaced on the registrations screen, and why
 * the queue also shows the link so it can be sent by hand.
 */
export async function notifyRegistrationApproved(user: {
  email: string;
  token: string;
  groupName?: string | null;
  athleteId?: string | null;
  signupRequestId?: string | null;
}): Promise<SendResult> {
  return sendEmail({
    template: 'registration_approved',
    to: user.email,
    subject: '✅ ההרשמה שלך למדרגות אושרה',
    athleteId: user.athleteId ?? null,
    signupRequestId: user.signupRequestId ?? null,
    html: renderEmail({
      title: 'אושרת! 🎉',
      paragraphs: [
        `ההרשמה שלך למדרגות אושרה${user.groupName ? ` — ${user.groupName}` : ''}. נשאר רק להשלים כמה פרטים ולהתחבר עם Strava, וזה הכל.`,
        'מי שהשעון שלו כבר מחובר אצלנו — נזהה את זה ונדלג על השלב.',
      ],
      cta: { label: 'להשלמת ההרשמה →', href: `${APP_URL}/join/${user.token}` },
      notes: ['הקישור אישי — אל תעבירו אותו לאף אחד.'],
    }),
  });
}

// ── Academy ──────────────────────────────────────────────────────────────────────

export async function notifyAdminNewAcademyRegistration(user: {
  name: string;
  email: string;
  phone?: string;
}): Promise<SendResult> {
  return sendEmail({
    template: 'admin_new_academy_registration',
    to: ADMIN_EMAIL,
    subject: `🎓 New academy registration: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New academy registration',
      rows: [['Name', user.name], ['Email', user.email], ['Phone', user.phone || '—']],
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/settings` },
    }),
  });
}

export async function notifyAcademyApproved(user: {
  name: string;
  email: string;
  token: string;
}): Promise<SendResult> {
  return sendEmail({
    template: 'academy_approved',
    to: user.email,
    subject: '✅ You\'re in the Madregot Academy — connect your watch',
    html: renderEmail({
      dir: 'ltr',
      title: `Welcome to the Academy, ${user.name}! 🎉`,
      paragraphs: [
        'Your registration was approved. One last step: connect your Garmin watch so your coach can send you workouts and track your progress.',
      ],
      cta: { label: 'Connect Garmin →', href: `${APP_URL}/join/academy/${user.token}` },
    }),
  });
}

// ── Academy weekly report ────────────────────────────────────────────────────────

export interface AcademyReportRow {
  name: string;
  completedCount: number;
  plannedCount: number;
  completionRate: number; // 0..1
  avgScore: number; // 0..1
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function rateColor(rate: number): string {
  if (rate >= 0.8) return '#16a34a';
  if (rate >= 0.5) return '#FF5315';
  return '#D74E4E';
}

export async function sendAcademyWeeklyReport(params: {
  weekStart: string;
  weekEnd: string;
  rows: AcademyReportRow[];
  to?: string;
}): Promise<SendResult> {
  const { weekStart, weekEnd, rows } = params;
  if (rows.length === 0) {
    return { ok: false, status: 'skipped', code: 'no-rows', reason: 'No athletes to report on', logId: null };
  }

  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const totalPlanned = rows.reduce((a, r) => a + r.plannedCount, 0);
  const totalDone = rows.reduce((a, r) => a + r.completedCount, 0);
  const overall = totalPlanned ? totalDone / totalPlanned : 0;

  // Worst first: the point of the digest is who needs a phone call.
  const tableRows = rows
    .slice()
    .sort((a, b) => a.completionRate - b.completionRate)
    .map(r => `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; font-weight: 600; color: #1D1E26;">${esc(r.name)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #2D2E38;">${r.completedCount}/${r.plannedCount}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; font-weight: 700; color: ${rateColor(r.completionRate)};">${pct(r.completionRate)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #656565;">${pct(r.avgScore)}</td>
      </tr>`)
    .join('');

  return sendEmail({
    template: 'academy_weekly_report',
    to: params.to || ADMIN_EMAIL,
    subject: `🎓 Academy weekly report — ${fmt(weekStart)}–${fmt(weekEnd)}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'Academy weekly report',
      paragraphs: [`${fmt(weekStart)} – ${fmt(weekEnd)}`],
      bodyHtml: `
        <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <span style="font-size: 28px; font-weight: 800; color: ${rateColor(overall)};">${pct(overall)}</span>
          <span style="color: #2D2E38;"> overall sessions completed (${totalDone}/${totalPlanned}) across ${rows.length} athlete${rows.length !== 1 ? 's' : ''}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="text-align: left; color: #94a3b8; font-size: 12px;">
              <th style="padding: 8px;">Athlete</th>
              <th style="padding: 8px; text-align: center;">Done</th>
              <th style="padding: 8px; text-align: center;">Completion</th>
              <th style="padding: 8px; text-align: center;">On-plan</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`,
      cta: { label: 'Open Academy →', href: `${APP_URL}/dashboard/academy` },
      notes: ['"On-plan" = average share of distance/time/pace targets hit on completed sessions.'],
    }),
  });
}
