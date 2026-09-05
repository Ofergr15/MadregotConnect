import { redirect } from 'next/navigation';

/**
 * /dashboard/registrations → Settings → הרשמות.
 *
 * The approval queue now lives inside Settings (one admin surface, next to User
 * Manager and the rest of the management screens) rather than on a page of its
 * own. This route stays because the "someone registered" admin email links to
 * it (src/lib/email.ts) — old mails in an inbox have to keep working.
 */
export default function RegistrationsRedirect() {
  redirect('/dashboard/settings?tab=registrations');
}
