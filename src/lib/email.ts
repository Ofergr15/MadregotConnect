import nodemailer from 'nodemailer';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'madregot.club@gmail.com';
const GMAIL_USER = process.env.GMAIL_USER || 'madregot.club@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function getTransporter() {
  if (!GMAIL_APP_PASSWORD) throw new Error('GMAIL_APP_PASSWORD not configured');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

export async function notifyAdminNewUser(user: { name: string; email: string; onboardingStatus: string; hasGarmin?: boolean }) {
  const authStatusMap: Record<string, string> = {
    'garmin_authed': '✅ Google + Garmin Connected',
    'google_authed': '⚠️ Google Only (skipped Garmin)',
  };
  const authStatus = authStatusMap[user.onboardingStatus] || (user.hasGarmin ? '✅ Google + Garmin' : '⚠️ Google only');
  await getTransporter().sendMail({
    from: `Madregot <${GMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `🏃 New user waiting for approval: ${user.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #1e293b;">New User Registration</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b;">Name</td><td style="padding: 8px 0; font-weight: 600;">${user.name}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Email</td><td style="padding: 8px 0;">${user.email}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Auth</td><td style="padding: 8px 0; font-weight: 600;">${authStatus}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Status</td><td style="padding: 8px 0;">${user.onboardingStatus}</td></tr>
        </table>
        <p style="margin-top: 20px;">
          <a href="https://madregot-connect.vercel.app/dashboard/settings" style="background: #4338ff; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Review & Approve →
          </a>
        </p>
      </div>
    `,
  });
}

export async function notifyUserApproved(user: { name: string; email: string }) {
  await getTransporter().sendMail({
    from: `Madregot <${GMAIL_USER}>`,
    to: user.email,
    subject: `✅ Welcome to Madregot! You're approved`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #1e293b;">Welcome, ${user.name}! 🎉</h2>
        <p style="color: #475569; line-height: 1.6;">
          Your account has been approved. You can now access the full Madregot training platform.
        </p>
        <p style="margin-top: 20px;">
          <a href="https://madregot-connect.vercel.app/dashboard" style="background: #4338ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Open Madregot →
          </a>
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 30px;">
          Madregot After 2KM Running Club
        </p>
      </div>
    `,
  });
}

export async function notifyAdminUserApproved(admin: { email: string }, user: { name: string; email: string }) {
  await getTransporter().sendMail({
    from: `Madregot <${GMAIL_USER}>`,
    to: admin.email,
    subject: `✅ User approved: ${user.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <p style="color: #475569;">${user.name} (${user.email}) has been approved and notified.</p>
      </div>
    `,
  });
}

// ── Academy weekly report ────────────────────────────────────────────────────

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
  if (rate >= 0.8) return '#10b981';
  if (rate >= 0.5) return '#f59e0b';
  return '#ef4444';
}

/**
 * Weekly academy compliance digest to the coach. Skips silently (returns false)
 * when there's nothing to report or email isn't configured.
 */
export async function sendAcademyWeeklyReport(params: {
  weekStart: string;
  weekEnd: string;
  rows: AcademyReportRow[];
  to?: string;
}): Promise<boolean> {
  const { weekStart, weekEnd, rows } = params;
  if (!GMAIL_APP_PASSWORD || rows.length === 0) return false;

  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const totalPlanned = rows.reduce((a, r) => a + r.plannedCount, 0);
  const totalDone = rows.reduce((a, r) => a + r.completedCount, 0);
  const overall = totalPlanned ? totalDone / totalPlanned : 0;

  const tableRows = rows
    .slice()
    .sort((a, b) => a.completionRate - b.completionRate) // worst first — needs attention
    .map(r => `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${r.name}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #475569;">${r.completedCount}/${r.plannedCount}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: ${rateColor(r.completionRate)};">${pct(r.completionRate)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b;">${pct(r.avgScore)}</td>
      </tr>`)
    .join('');

  await getTransporter().sendMail({
    from: `Madregot <${GMAIL_USER}>`,
    to: params.to || ADMIN_EMAIL,
    subject: `🎓 Academy weekly report — ${fmt(weekStart)}–${fmt(weekEnd)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 640px;">
        <h2 style="color: #1e293b; margin-bottom: 4px;">Academy Weekly Report</h2>
        <p style="color: #64748b; margin-top: 0;">${fmt(weekStart)} – ${fmt(weekEnd)}</p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <span style="font-size: 28px; font-weight: 800; color: ${rateColor(overall)};">${pct(overall)}</span>
          <span style="color: #475569;"> overall sessions completed (${totalDone}/${totalPlanned}) across ${rows.length} athlete${rows.length !== 1 ? 's' : ''}</span>
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
        </table>
        <p style="margin-top: 20px;">
          <a href="https://madregot-connect.vercel.app/dashboard/academy" style="background: #4338ff; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Open Academy →
          </a>
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
          "On-plan" = average share of distance/time/pace targets hit on completed sessions.
          Madregot After 2KM Running Club
        </p>
      </div>
    `,
  });
  return true;
}
