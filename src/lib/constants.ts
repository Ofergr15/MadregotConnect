export const COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

/**
 * The canonical public origin, for links we put in front of a user: invite links,
 * email links, the Garmin SSO callback.
 *
 * The fallback matters, because NEXT_PUBLIC_APP_URL is NOT set in the production
 * Vercel environment (checked with `vercel env ls production`). Five call sites
 * each carried their own copy of the literal, and all five said
 * `https://madregot-connect.vercel.app` — which is a live alias serving 200 with
 * no redirect to the canonical host, so nothing looked broken while every invite
 * email quietly sent people to the wrong origin.
 *
 * Wrong origin is not cosmetic here. Sessions and localStorage are per-origin, so
 * a member who follows an invite link and adds THAT page to their home screen
 * gets a PWA pinned to an origin their later www.madregot.app sign-in can't reach
 * — the same class of breakage as the standalone-PWA regression. One constant, so
 * the next call site can't diverge again.
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.madregot.app').replace(/\/$/, '');

// Accounts that must never be deleted (e.g. the club/admin account).
export const PROTECTED_EMAILS = ['madregot.club@gmail.com'];

export function isProtectedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PROTECTED_EMAILS.includes(email.toLowerCase());
}

// Only these accounts may approve new registrations (club + academy sign-ups).
// Gate is enforced server-side in /api/admin/approve; the Settings/Registrations
// UIs also hide the Approve button for anyone not on this list.
export const APPROVER_EMAILS = ['yairgb@gmail.com', 'grosfeldofer@gmail.com', 'madregot.club@gmail.com'];

export function canApprove(email: string | null | undefined): boolean {
  if (!email) return false;
  return APPROVER_EMAILS.includes(email.toLowerCase().trim());
}

// Only this account may promote a user to the 'admin' role. Enforced server-side
// in PUT /api/admin/users; the Settings role dropdown also hides the Admin option
// for anyone else. The account is also protected from being demoted, so it can
// never lock itself out of granting admin.
export const ADMIN_GRANTER_EMAIL = 'madregot.club@gmail.com';

export function canGrantAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().trim() === ADMIN_GRANTER_EMAIL;
}

// The super user may "view as" any member — a read-only preview of exactly what
// that person sees on their phone (including the maintenance screen). Only this
// account gets the view-as switcher; the preview never writes data. See
// src/lib/impersonation.ts and src/components/ImpersonationBar.tsx.
export const SUPER_USER_EMAIL = 'grosfeldofer@gmail.com';

export function isSuperUser(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().trim() === SUPER_USER_EMAIL;
}
