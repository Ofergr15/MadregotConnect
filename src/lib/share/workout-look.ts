import type { ShareAccent, ShareBrand, ShareCardOptions, ShareTemplate, SplitMode } from '@/lib/feed/share-image';
import { isStickerTemplate, supportsPhoto, supportsTransparent } from '@/lib/feed/share-image';
import type { ShareCardLang } from '@/lib/share/card-text';
import {
  asWorkoutMetrics, canHrLine, defaultSplitMode, defaultTemplate, drawnTemplate, fitChipKeys, hasTargets,
  shareStickers, shareTemplates, splitModes, type ShareSubject,
} from '@/lib/share/sheet-model';

/**
 * EVERYTHING THE WORKOUT SHARE EDITOR LETS YOU CHOOSE, AS ONE VALUE.
 *
 * The editor keeps its controls; this is what they add up to, so the look picked on
 * one run can be put on another (the quality morning's "one look, every pack",
 * Ofer 2026-10-20, mockups/post-session/v2): the view, the numbers on it, the
 * background, the colour, the logo and the chart's options. The run's own things
 * (its route, laps, numbers, title text) are not in it: those come with each run.
 */
export type WorkoutBackground = 'photo' | 'club' | 'sticker' | 'color';
/** A colour background's fill: from the colour to a darker one (like the club's blue), or one flat colour. */
export type BackgroundFill = 'gradient' | 'solid';

export interface WorkoutLook {
  template: ShareTemplate;
  keys: string[];
  cardLang: ShareCardLang;
  showTitle: boolean;
  showStartTime: boolean;
  showDate: boolean;
  showShoe: boolean;
  routeOnly: boolean;
  bg: WorkoutBackground;
  accent: ShareAccent;
  brand: ShareBrand | null;
  splitMode: SplitMode;
  paceLabels: boolean;
  targets: boolean;
  avgLine: boolean;
  hrLine: boolean;
  /** A colour background (bg 'color', Ofer 10-28: "change the blue — clear, or a colour I pick"). */
  bgColor?: string;
  bgFill?: BackgroundFill;
}

/**
 * The look as it fits ANOTHER run: a view that run can't draw (a route view on a
 * run with no GPS, splits on one with no laps) falls back to the run's own opening
 * view; the numbers are re-fitted to what that run has and the view holds; a chart
 * mode the run has no data for becomes its default; targets and the HR line only
 * where the run has them. Everything else carries over as it is.
 */
export function fitLook(look: WorkoutLook, subject: ShareSubject): WorkoutLook {
  const ok = new Set([...shareTemplates(subject), ...shareStickers(subject)].filter(v => v.available).map(v => v.key));
  const template = ok.has(look.template) ? look.template : defaultTemplate(subject);
  const modes = splitModes(subject);
  return {
    ...look,
    template,
    keys: fitChipKeys(subject, template, look.keys),
    splitMode: modes.includes(look.splitMode) ? look.splitMode : defaultSplitMode(subject),
    targets: look.targets && hasTargets(subject),
    hrLine: look.hrLine && canHrLine(subject),
  };
}

/** Is this view one the run can draw (the three-card screen greys the rest). */
export function lookFits(look: WorkoutLook, subject: ShareSubject): boolean {
  return [...shareTemplates(subject), ...shareStickers(subject)].some(v => v.key === look.template && v.available);
}

/**
 * The renderer's options for a look on one run — the same object the editor hands
 * `renderShareCard` for the card being edited, so a card drawn here is the card the
 * editor showed. `view` lets the editor draw a neighbour in the carousel with the
 * look's settings; `own` is false for a neighbour, which keeps its own logo.
 */
export function lookRenderOptions(
  look: WorkoutLook,
  subject: ShareSubject,
  extra: { photo?: Blob | null; titleText: string; view?: ShareTemplate; own?: boolean },
): ShareCardOptions {
  const view = extra.view ?? look.template;
  const own = extra.own ?? true;
  const photo = extra.photo ?? null;
  const d = drawnTemplate(view, { routeOnly: look.routeOnly, withPhoto: look.bg === 'photo' && !!photo });
  return {
    background: look.bg === 'photo' && supportsPhoto(d) ? photo : null,
    backgroundColor: look.bg === 'color' && look.bgColor ? { hex: readableColor(look.bgColor), fill: look.bgFill ?? 'gradient' } : undefined,
    transparent: isStickerTemplate(d) || (look.bg === 'sticker' && supportsTransparent(d)),
    template: d,
    accent: look.accent,
    showTitle: look.showTitle && extra.titleText.trim().length > 0,
    showStartTime: (view === 'classic' || view === 'card') && look.showStartTime,
    showDate: look.showDate,
    showShoe: look.showShoe,
    brand: own ? look.brand ?? undefined : undefined,
    splitMode: look.splitMode,
    paceLabels: look.paceLabels,
    targets: look.targets && hasTargets(subject),
    avgLine: look.avgLine,
    hrLine: look.hrLine,
    editorChart: true,
    timeLtr: true,
    metrics: asWorkoutMetrics(own ? look.keys : fitChipKeys(subject, view, look.keys)),
  };
}

// ── a colour the white numbers can be read on ────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
/** White on it, WCAG. */
export const whiteContrast = (hex: string) => 1.05 / (lum(hex) + 0.05);
/** Toward black by `k` (0..1). */
export function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.round(v * (1 - k))).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
/**
 * The colour picked, darkened just enough that the card's white numbers read on it (3:1, the
 * large-text bar): a yellow or a white would leave them invisible. A colour that already
 * reads is kept exactly. Anything that isn't a #rrggbb is the club's blue.
 */
export function readableColor(hex: string): string {
  if (!HEX.test(hex)) return '#1525FF';
  let c = hex.toLowerCase();
  for (let i = 0; i < 20 && whiteContrast(c) < 3; i++) c = darken(c, 0.08);
  return c;
}

/** The shades offered first (mockup share-card-colors): black, dark grey, the club's blue, Madregot orange, pink, purple, green. */
export const COLOR_SWATCHES = ['#0b0b10', '#2b2d42', '#1525FF', '#E2561B', '#C2185B', '#6D28D9', '#0B7258'] as const;

// ── remembered on this phone ─────────────────────────────────────────────────

const VIEW_KEYS = 'mc-share-view-keys-v1';
const BG_KEY = 'mc-share-bg-v1';

/** The numbers last chosen for one view ("tags" keeps its own, "list" its own). */
export function loadViewKeys(view: ShareTemplate): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEYS) || '{}')[view];
    return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length ? v : null;
  } catch { return null; }
}
export function saveViewKeys(view: ShareTemplate, keys: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEYS) || '{}');
    localStorage.setItem(VIEW_KEYS, JSON.stringify({ ...all, [view]: keys }));
  } catch { /* private mode: not remembered */ }
}

export interface SavedBackground { bg: 'club' | 'sticker' | 'color'; color?: string; fill?: BackgroundFill }
/** The last background chosen (a photo is never remembered — it is the run's own). */
export function loadBackground(): SavedBackground | null {
  try {
    const v = JSON.parse(localStorage.getItem(BG_KEY) || 'null');
    if (!v || !['club', 'sticker', 'color'].includes(v.bg)) return null;
    return { bg: v.bg, ...(HEX.test(v.color) ? { color: v.color } : {}), ...(v.fill === 'solid' || v.fill === 'gradient' ? { fill: v.fill } : {}) };
  } catch { return null; }
}
export function saveBackground(b: SavedBackground): void {
  try { localStorage.setItem(BG_KEY, JSON.stringify(b)); } catch { /* not remembered */ }
}

// ── the last look, for next time ─────────────────────────────────────────────

const KEY = 'mc-pack-share-look-v1';

export function saveLook(look: WorkoutLook): void {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* private mode: not remembered */ }
}

/** The last look saved, if it reads as one; anything else is ignored. */
export function loadLook(): WorkoutLook | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || typeof v !== 'object' || typeof v.template !== 'string' || !Array.isArray(v.keys)) return null;
    return v as WorkoutLook;
  } catch {
    return null;
  }
}
