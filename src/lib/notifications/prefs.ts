// Per-user notification category preferences. Categories map to the push
// categories in src/lib/push.ts. A missing key = opted IN (receive everything),
// so defaults are all-on and nothing is silenced unless explicitly turned off.
export const CATEGORIES = ['workouts', 'coach', 'achievements', 'program', 'teammates', 'news', 'events'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULTS: Record<Category, boolean> = {
  workouts: true, coach: true, achievements: true, program: true, teammates: true, news: true, events: true,
};

// Only a genuinely-unmigrated column should read as "everything on" — a
// blanket check here used to catch EVERY DB error (a transient hiccup
// included) and silently show all-defaults, which looked exactly like a
// saved "off" preference randomly flipping back to "on" on its own.
export function isMigrationMissing(error: { message?: string; code?: string } | null): boolean {
  return !!error && (/notification_prefs/.test(error.message || '') || error.code === '42703');
}

// Merge a partial saved map over the all-on defaults so any category the
// athlete has never touched still reads as enabled.
export function mergeWithDefaults(saved: Partial<Record<Category, boolean>> | null | undefined): Record<Category, boolean> {
  return { ...DEFAULTS, ...(saved || {}) };
}
