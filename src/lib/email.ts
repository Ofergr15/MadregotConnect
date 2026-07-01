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

export async function notifyAdminNewUser(user: { name: string; email: string; onboardingStatus: string }) {
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
          <a href="https://madregot-connect.vercel.app/dashboard/program" style="background: #4338ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
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
