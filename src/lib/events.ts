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

/** A course map is an https link to a GPX file (migration 181), or null to clear it. */
export function isCourseGpxUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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
