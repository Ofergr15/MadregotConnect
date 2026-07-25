export const COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

// Accounts that must never be deleted (e.g. the club/admin account).
export const PROTECTED_EMAILS = ['madregot.club@gmail.com'];

export function isProtectedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PROTECTED_EMAILS.includes(email.toLowerCase());
}

// Only these accounts may approve new registrations (club + academy sign-ups).
// Gate is enforced server-side in /api/admin/approve; the Settings/Registrations
// UIs also hide the Approve button for anyone not on this list.
export const APPROVER_EMAILS = ['yairgb@gmail.com', 'grosfeldofer@gmail.com'];

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
