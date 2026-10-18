import type { PhotoSlot } from './server';
import type { YearStats } from './stats';

/**
 * Every birthday story a little different (Ofer, 2026-10-18: "everyone gets a slightly
 * different version"), automatically and without anybody's photos: which club backgrounds
 * stand behind which slide, the shade of the blue, which of the person's numbers comes
 * first, and the wording. Chosen from a seed of the person and the birthday, so a story
 * looks the same every time it is opened, and the next person's looks different.
 */

/** Club photos from the Drive library (public/images/birthday) and the app's own. */
export const CLUB_BACKGROUNDS = [
  ...Array.from({ length: 16 }, (_, i) => `/images/birthday/bg-${String(i + 1).padStart(2, '0')}.jpg`),
  '/images/team-group.jpg', '/images/runners-group.jpg', '/images/hero-running.jpg', '/images/team-race.jpg',
];

export interface StoryTheme { key: string; tint: string; sat: number; c1: string; c2: string; c3: string; c4: string; gx: string }

/** Shades of the club blue — never another brand colour. */
export const THEMES: StoryTheme[] = [
  { key: 'club', tint: '195deg', sat: 4.2, c1: '#2a3bff', c2: '#1525FF', c3: '#0a1080', c4: '#060a52', gx: '85%' },
  { key: 'night', tint: '198deg', sat: 3.4, c1: '#1f2fd6', c2: '#101cb0', c3: '#080d63', c4: '#04072f', gx: '15%' },
  { key: 'sky', tint: '185deg', sat: 3.8, c1: '#2f6bff', c2: '#1a45f0', c3: '#0b1f8f', c4: '#050f4a', gx: '70%' },
  { key: 'deep', tint: '200deg', sat: 3.0, c1: '#2238e8', c2: '#1426c4', c3: '#0a1470', c4: '#050a38', gx: '30%' },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Small seeded generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export type SlideKey = 'km' | 'days' | 'streak' | 'moment' | 'prs' | 'long' | 'rhythm' | 'climb';

export interface StoryVariant {
  theme: StoryTheme;
  /** A club background per slide, for the slides the person has no photo of their own on. */
  backgrounds: Record<PhotoSlot, string>;
  /** The middle slides, the person's strongest first; the opener, thanks, "more" and poster keep their places. */
  order: SlideKey[];
  /** Which wording each slide uses (an index into its variants). */
  pick: (key: string, n: number) => number;
}

/**
 * The person's numbers ranked by how much they stand out. A marathon, a long streak or a big
 * year leads; the plainer slides follow in their usual order.
 */
function strengths(s: YearStats): Record<SlideKey, number> {
  return {
    moment: s.moment ? 100 : 0,
    streak: s.streak ? Math.min(95, s.streak.days) : 0,
    km: Math.min(90, s.km / 40),
    prs: s.bests.length * 18,
    long: s.longest ? Math.min(80, s.longest.km * 1.5) : 0,
    days: Math.min(70, (s.runDates.length / Math.max(1, s.totalDays)) * 80),
    climb: Math.min(60, s.elevM / 400),
    rhythm: 20,
  };
}

const DEFAULT_ORDER: SlideKey[] = ['km', 'days', 'streak', 'moment', 'prs', 'long', 'rhythm', 'climb'];

export function storyVariant(athleteId: string, birthday: string, s: YearStats): StoryVariant {
  const seed = hash(`${athleteId}:${birthday}`);
  const r = rng(seed);
  const theme = THEMES[seed % THEMES.length];
  const bgs = shuffle(CLUB_BACKGROUNDS, r);
  const slots: PhotoSlot[] = ['intro', 'thanks', 'km', 'streak', 'moment', 'long', 'climb', 'poster'];
  const backgrounds = Object.fromEntries(slots.map((k, i) => [k, bgs[i % bgs.length]])) as Record<PhotoSlot, string>;
  // The strongest one or two move to the front; the rest keep the familiar order, so the
  // story still reads as one story.
  const score = strengths(s);
  const lead = [...DEFAULT_ORDER].sort((a, b) => score[b] - score[a]).slice(0, 2);
  const order = [...lead, ...DEFAULT_ORDER.filter((k) => !lead.includes(k))];
  return { theme, backgrounds, order, pick: (key, n) => hash(`${seed}:${key}`) % n };
}
