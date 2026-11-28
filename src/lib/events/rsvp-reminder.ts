// RSVP reminder data (task 92): who hasn't answered an event yet, for staff. Pure — the route
// reads the roster and the registrations; nothing here sends. Default-off flag
// `event_rsvp_reminder`; the push itself is a later step the owner approves.
//
// "Answered" = any registration row for the event: registered, waitlisted, OR cancelled (a
// cancel is an answer — "not coming" — and must not be nagged). Not answered = an active,
// non-test club account with no row.

export interface ReminderAthlete { id: string; name: string | null; status: string | null; role?: string | null }
export interface ReminderRegistration { athlete_id: string; status: string }

export function unansweredFor(roster: ReminderAthlete[], registrations: ReminderRegistration[]): Array<{ athleteId: string; name: string }> {
  const answered = new Set(registrations.map((r) => r.athlete_id));
  return roster
    .filter((a) => a.status === 'active' && !/^test /i.test(a.name ?? '') && !answered.has(a.id))
    .map((a) => ({ athleteId: a.id, name: a.name ?? '' }))
    .sort((x, y) => x.name.localeCompare(y.name, 'he') || x.athleteId.localeCompare(y.athleteId));
}

export function rsvpCounts(registrations: ReminderRegistration[]): { registered: number; waitlisted: number; cancelled: number } {
  const c = { registered: 0, waitlisted: 0, cancelled: 0 };
  for (const r of registrations) if (r.status in c) c[r.status as keyof typeof c]++;
  return c;
}

/** Only an upcoming event (today or later, Israel date) is worth a reminder. */
export function isRemindable(event: { date: string; status?: string | null }, today: string): boolean {
  return (event.status ?? 'published') === 'published' && event.date >= today;
}

export function reminderCopy(locale: 'he' | 'en', p: { name: string; date: string }): { title: string; body: string } {
  return locale === 'he'
    ? { title: 'מגיעים?', body: `${p.name} · ${p.date} — סמנו אם אתם באים` }
    : { title: 'Coming?', body: `${p.name} · ${p.date} — let us know if you're in` };
}
