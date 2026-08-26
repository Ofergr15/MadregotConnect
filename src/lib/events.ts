/**
 * Shared constants for the generic events/calendar API (roadmap Phase 3 —
 * #4 Calendar, #8 Dedicated Event Pages, #15 Event Registration).
 *
 * Kept in sync with the `events.kind` CHECK constraint in
 * supabase/migrations/055_events.sql.
 */

export const EVENT_KINDS = [
  'race',
  'camp',
  'lecture',
  'social',
  'photo_shoot',
  'sponsor',
  'workout',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value);
}

export type EventRegistrationStatus = 'registered' | 'waitlisted' | 'cancelled';

/** Hebrew label + emoji per kind, for the "new event" push and any future calendar UI that wants one place to stay in sync with EVENT_KINDS. */
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  race: '🏆 מרוץ',
  camp: '🏕️ מחנה אימונים',
  lecture: '🎤 הרצאה',
  social: '🎉 אירוע חברתי',
  photo_shoot: '📸 צילומים',
  sponsor: '🤝 אירוע ספונסר',
  workout: '🏃 אימון מיוחד',
};
