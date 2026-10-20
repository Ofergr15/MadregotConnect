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
export type WorkoutBackground = 'photo' | 'club' | 'sticker';

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
