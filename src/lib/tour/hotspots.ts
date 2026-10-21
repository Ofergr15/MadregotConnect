import type { TourPrefs } from './prefs';

// The "new here" dots and when they show: once the prefs are known, never after "הבנתי",
// and never while a tour is running.
export const HOTSPOTS = {
  'week-from-club': { title: 'שבוע שלם מהקבוצה', body: 'לוקחים את כל השבוע של הקבוצה, מותאם לקצבים של המתאמן — ואז מתקנים ימים בודדים.' },
  'book-entry': { title: 'ספר האימונים', body: 'נגיעה באימון פותחת אותו: רואים ק״מ, זמן, חימום ושחרור בקצבים של המתאמן, ומתקנים לפני ששולחים.' },
  'zones-edit': { title: 'קצבים לעריכה', body: '✎ ליד כל אזור — משנים את הקצב המוצע למתאמן הזה. השאר ממשיכים לפי הבסיס.' },
} as const;

export type HotspotId = keyof typeof HOTSPOTS;

export function hotspotVisible(id: string, ctx: { ready: boolean; prefs: TourPrefs; tourRunning: boolean }): boolean {
  if (!ctx.ready || ctx.tourRunning) return false;
  return !ctx.prefs.hotspots[id];
}
