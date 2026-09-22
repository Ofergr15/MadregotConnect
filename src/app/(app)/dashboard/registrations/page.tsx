import { redirect } from 'next/navigation';

/**
 * /dashboard/registrations → מחכים להיכנס (the entry queue).
 *
 * ── WHY THIS MOVED, AND WHY IT IS THE WHOLE BUG ──────────────────────────────
 * Two screens answered "who is waiting for me to let them in", and which one you
 * got depended entirely on how you arrived. Browsing — the Settings landing row,
 * Coach Tools, the athletes list — took you to the entry queue. But every ALERT
 * took you to the old הרשמות list: the admin email, both push notifications, and
 * the "pending registrations" card on the home screen. So the answer to "sometimes
 * I see this screen and sometimes the one with the stage graphs" was: whenever you
 * tap the notification, versus whenever you go looking yourself.
 *
 * All of them now land here, and this URL keeps working because old mail in an
 * inbox has to. The old list is still reachable — one labelled link at the bottom
 * of the entry queue — for the paperwork it alone holds: the full submission log
 * including rejections, re-sending a join link, copying an invite link by hand.
 */
export default function RegistrationsRedirect() {
  redirect('/dashboard/entry-queue?at=mine');
}
