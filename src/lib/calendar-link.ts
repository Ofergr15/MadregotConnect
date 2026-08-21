// Small, self-contained "add to calendar" helper. Generates a Google Calendar
// "quick add" link (opens a pre-filled event in the browser/app) — no download,
// no external library, works cross-device. If Apple/Outlook .ics support is
// ever needed, add a sibling buildIcs() here; kept out for now (unused code).
export interface CalendarEventInput {
  title: string;
  description?: string;
  location?: string;
  /** Local wall-clock date the event falls on (only the Y/M/D is used). */
  date: Date;
  /** Event start hour, local time (0-23). Defaults to 18 (typical team workout hour). */
  hour?: number;
  minute?: number;
  /** Defaults to 90 minutes — a typical training-session length. */
  durationMinutes?: number;
}

function eventBounds({ date, hour = 18, minute = 0, durationMinutes = 90 }: CalendarEventInput): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return { start, end };
}

// Google Calendar wants UTC timestamps as YYYYMMDDTHHMMSSZ.
function toUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Build a Google Calendar "render" URL that pre-fills a new event. */
export function googleCalendarUrl(input: CalendarEventInput): string {
  const { start, end } = eventBounds(input);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
    details: input.description ?? '',
    location: input.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
