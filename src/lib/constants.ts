export const COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

// Accounts that must never be deleted (e.g. the club/admin account).
export const PROTECTED_EMAILS = ['madregot.club@gmail.com'];

export function isProtectedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PROTECTED_EMAILS.includes(email.toLowerCase());
}
