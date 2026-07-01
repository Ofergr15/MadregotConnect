import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'grosfeldofer@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Madregot <onboarding@resend.dev>';

export async function notifyAdminNewUser(user: { name: string; email: string; onboardingStatus: string }) {
  await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `🏃 New user waiting for approval: ${user.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #1e293b;">New User Registration</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b;">Name</td><td style="padding: 8px 0; font-weight: 600;">${user.name}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Email</td><td style="padding: 8px 0;">${user.email}</td></tr>
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
  await resend.emails.send({
    from: FROM_EMAIL,
    to: user.email,
    subject: `✅ Welcome to Madregot! You're approved`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #1e293b;">Welcome, ${user.name}! 🎉</h2>
        <p style="color: #475569; line-height: 1.6;">
          Your account has been approved. You can now access the full Madregot training platform.
        </p>
        <p style="margin-top: 20px;">
          <a href="https://madregot-connect.vercel.app" style="background: #4338ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
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
  await resend.emails.send({
    from: FROM_EMAIL,
    to: admin.email,
    subject: `✅ User approved: ${user.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <p style="color: #475569;">${user.name} (${user.email}) has been approved and notified.</p>
      </div>
    `,
  });
}
