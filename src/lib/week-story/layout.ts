// What the weekly story shows, decided ON the story (mockup week-story-v2/v3.html, Ofer
// 2026-10-23 "נראה מעולה"): the admin hides whole slides or parts of a slide, picks the
// club's default workout (the week's quality session or its long run) and the background.
// Each member may switch their own story's workout (only between that week's two) and
// background. Pure, so the server, the player and the tests read one set of rules.

export type WorkoutPick = 'quality' | 'long';
export type ThemeKey = 'blue' | 'night' | 'ocean' | 'graphite' | 'royal' | 'berry' | 'ember' | 'aurora';
/** A preset, or a colour of one's own as `#rrggbb` (the gradient is derived from it). */
export type Theme = ThemeKey | `#${string}`;

/**
 * The backgrounds, each three stops drifting at 135deg (mockup week-story-v2/themes.html;
 * Ofer 2026-10-23 took all eight, in this order). Swap the hex here, nothing else holds them.
 * The white text is checked against every stop (tests).
 */
export const THEMES: Record<ThemeKey, { label: string; stops: [string, string, string] }> = {
  blue: { label: 'כחול מדרגות', stops: ['#1525FF', '#0A1080', '#3B4BFF'] },
  night: { label: 'לילה', stops: ['#312E81', '#0F172A', '#5B21B6'] },
  ocean: { label: 'אוקיינוס', stops: ['#075985', '#0C2A4A', '#0E6E8C'] },
  graphite: { label: 'גרפיט', stops: ['#1F2937', '#030712', '#1E3A8A'] },
  royal: { label: 'מלכותי', stops: ['#4338CA', '#1E1B4B', '#6D28D9'] },
  berry: { label: 'פטל', stops: ['#6D28D9', '#3B0764', '#9D174D'] },
  ember: { label: 'גחלים', stops: ['#9A3412', '#3F1206', '#B4410C'] },
  aurora: { label: 'זוהר', stops: ['#1D4ED8', '#2E1065', '#0F766E'] },
};
export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];
/** Quick hues beside the colour input of "צבע משלך". */
export const QUICK_COLOURS = ['#E11D48', '#F59E0B', '#FDE68A', '#10B981', '#06B6D4', '#EC4899', '#8B5CF6', '#6B7280'];

const HEX = /^#[0-9a-f]{6}$/i;
export const isCustom = (t: string): t is `#${string}` => HEX.test(t);

// ── colour maths (HSL ↔ hex, WCAG contrast) ───────────────────────────────────────────────
function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** The colour, made only as dark as it must be for white text at 4.7:1 (a margin over 4.5). */
function readable(h: number, s: number, l: number): string {
  let hex = toHex(h, s, l);
  while (contrastRatio('#ffffff', hex) < 4.7 && l > 0) { l = Math.max(0, l - 0.01); hex = toHex(h, s, l); }
  return hex;
}
/** One chosen colour → the presets' shape: the colour, a deep dark of it, and a neighbour hue. */
export function deriveStops(hex: string): [string, string, string] {
  const [h, s0, l] = toHsl(hex);
  const s = Math.min(1, Math.max(s0, s0 > 0.08 ? 0.55 : s0));
  return [readable(h, s, l), readable(h, s, Math.min(l, 0.5) * 0.4), readable((h + 28) % 360, s, l)];
}
export function themeStops(t: Theme): [string, string, string] {
  return isCustom(t) ? deriveStops(t) : THEMES[t as ThemeKey]?.stops ?? THEMES.blue.stops;
}
/** The darkest stop: the slides' accent on white (the "me" row, the buttons) and the ring's fill. */
export function themeAccent(t: Theme): string {
  const st = themeStops(t);
  return st.reduce((a, b) => (contrastRatio('#ffffff', b) > contrastRatio('#ffffff', a) ? b : a));
}

/** The slides that can be hidden, and the parts of each that can be (intro and summary stay). */
export const SLIDE_PARTS: Record<string, string[]> = {
  km: ['hero', 'diff', 'days', 'line'],
  plan: ['sessions', 'ring', 'missed'],
  record: ['hero'],
  workout: ['title', 'chart', 'pve', 'verdict'],
  pack: ['rank', 'moved', 'table'],
  coach: ['title', 'score'],
  next: ['title'],
  club: ['km', 'runners', 'records', 'marathons'],
};
export const FIXED_SLIDES = ['intro', 'summary'];

export interface StoryLayout {
  hiddenSlides: string[];
  hiddenParts: Record<string, string[]>;
  /** The club's default workout slide; null = the quality session, else the long run. */
  workout: WorkoutPick | null;
  theme: Theme;
}
export const DEFAULT_LAYOUT: StoryLayout = { hiddenSlides: [], hiddenParts: {}, workout: null, theme: 'blue' };

/** Hex kept upper-case so the same colour compares equal. */
export const normTheme = (t: Theme): Theme => (isCustom(t) ? (t.toUpperCase() as Theme) : t);
export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && ((THEME_KEYS as string[]).includes(v) || HEX.test(v));
const isPick = (v: unknown): v is WorkoutPick => v === 'quality' || v === 'long';

/** A stored layout (or nothing, or junk) as one the player can trust. A missing column is the default. */
export function cleanLayout(raw: unknown): StoryLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_LAYOUT, hiddenParts: {} };
  const r = raw as Record<string, unknown>;
  const hiddenSlides = Array.isArray(r.hiddenSlides)
    ? [...new Set(r.hiddenSlides.filter((k): k is string => typeof k === 'string' && k in SLIDE_PARTS))] : [];
  const hiddenParts: Record<string, string[]> = {};
  if (r.hiddenParts && typeof r.hiddenParts === 'object' && !Array.isArray(r.hiddenParts)) {
    for (const [slide, parts] of Object.entries(r.hiddenParts as Record<string, unknown>)) {
      if (!(slide in SLIDE_PARTS) || !Array.isArray(parts)) continue;
      const ok = [...new Set(parts.filter((p): p is string => typeof p === 'string' && SLIDE_PARTS[slide].includes(p)))];
      if (ok.length) hiddenParts[slide] = ok;
    }
  }
  return { hiddenSlides, hiddenParts, workout: isPick(r.workout) ? r.workout : null, theme: isTheme(r.theme) ? normTheme(r.theme) : 'blue' };
}

export const slideShown = (l: StoryLayout, key: string) => FIXED_SLIDES.includes(key) || !l.hiddenSlides.includes(key);
export const partShown = (l: StoryLayout, slide: string, part: string) => !(l.hiddenParts[slide] || []).includes(part);

export function toggleSlide(l: StoryLayout, key: string): StoryLayout {
  if (FIXED_SLIDES.includes(key) || !(key in SLIDE_PARTS)) return l;
  const hidden = l.hiddenSlides.includes(key) ? l.hiddenSlides.filter((k) => k !== key) : [...l.hiddenSlides, key];
  return { ...l, hiddenSlides: hidden };
}
export function togglePart(l: StoryLayout, slide: string, part: string): StoryLayout {
  if (!(SLIDE_PARTS[slide] || []).includes(part)) return l;
  const now = l.hiddenParts[slide] || [];
  const next = now.includes(part) ? now.filter((p) => p !== part) : [...now, part];
  const parts = { ...l.hiddenParts };
  if (next.length) parts[slide] = next; else delete parts[slide];
  return { ...l, hiddenParts: parts };
}

/**
 * Which workout the slide shows: the member's own pick for this week, else the club's
 * default, else the quality session, else the long run — always one the week has.
 */
export function pickWorkout(o: { available: WorkoutPick[]; club: WorkoutPick | null; member: WorkoutPick | null }): WorkoutPick | null {
  for (const w of [o.member, o.club, 'quality' as const, 'long' as const]) if (w && o.available.includes(w)) return w;
  return null;
}
/** The member's background, else the club's. */
export const pickTheme = (club: Theme, member: Theme | null): Theme => member ?? club;

/** The member's own choices kept in notification_prefs.weekStory: { workout: { [weekEnd]: pick }, theme }. */
export function memberChoices(weekStory: unknown, weekEnd: string): { workout: WorkoutPick | null; theme: Theme | null } {
  const w = (weekStory && typeof weekStory === 'object' ? weekStory : {}) as { workout?: unknown; theme?: unknown };
  const byWeek = w.workout && typeof w.workout === 'object' ? (w.workout as Record<string, unknown>)[weekEnd] : null;
  return { workout: isPick(byWeek) ? byWeek : null, theme: isTheme(w.theme) ? normTheme(w.theme) : null };
}
/** The prefs after the member picks; keeps the last 8 weeks' picks and every other key. */
export function withMemberChoice(weekStory: unknown, change: { weekEnd?: string; workout?: WorkoutPick; theme?: Theme }): Record<string, unknown> {
  const w = { ...((weekStory && typeof weekStory === 'object' ? weekStory : {}) as Record<string, unknown>) };
  if (change.theme) w.theme = normTheme(change.theme);
  if (change.workout && change.weekEnd) {
    const prev = w.workout && typeof w.workout === 'object' ? (w.workout as Record<string, WorkoutPick>) : {};
    const all = { ...prev, [change.weekEnd]: change.workout };
    w.workout = Object.fromEntries(Object.entries(all).sort(([a], [b]) => b.localeCompare(a)).slice(0, 8));
  }
  return w;
}

// ── contrast (WCAG) ───────────────────────────────────────────────────────────────────────
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
