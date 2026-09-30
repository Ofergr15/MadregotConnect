/**
 * THE MANDATORY UPDATE — the pure half. For the super user until rollout.
 *
 * When a new build is installed and waiting (components/UpdatePrompt.tsx), the
 * page asks instead of reloading on its own: a sheet with the new version's
 * starred notes and one button, "Update now". There is no "Later" and no way to
 * close it — the only way forward is the update.
 *
 * The button covers the page with the app-open splash (logo filling with ink, a
 * percentage ring around it) and the percentage follows the real stages rather
 * than a timer:
 *
 *   tap → SKIP_WAITING sent (STAGE.asked) → controllerchange (STAGE.handover)
 *   → reload → the new bundle finishes it to 100% and fades into the app.
 *
 * The reload is the one step no JS survives, so the old page leaves a note in
 * sessionStorage (UPDATING_KEY) and the new page picks the splash up from it:
 * the inline boot script in the root layout reads it before the first paint, so
 * there is no flash of the app between the two halves.
 */

import { compareAppVersions } from '@/lib/feedback/lifecycle';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';

/** Where the percentage stands after each real stage. */
export const STAGE = {
  tapped: 0.08,
  asked: 0.35,
  handover: 0.7,
  done: 1,
} as const;

/** The splash is never on screen for less than this, so a fast phone doesn't flicker. */
export const MIN_SPLASH_MS = 1500;

/** If nothing has reloaded the page by now, reload it anyway. */
export const FORCE_RELOAD_MS = 9000;

/** A note older than this is not from the reload just now. */
export const UPDATING_TTL_MS = 2 * 60_000;

/** At most this many notes get a big row; the rest go in the list. */
export const STARRED_MAX = 3;

export const UPDATING_KEY = 'mc:updating';

/**
 * Runs in <head>, before the first paint, so the class is on <html> before any
 * CSS applies. Kept tiny and dependency-free, and it swallows everything: a
 * private-mode Safari that throws on sessionStorage just gets no cover.
 */
export const UPDATE_BOOT_SCRIPT =
  `try{if(sessionStorage.getItem(${JSON.stringify(UPDATING_KEY)}))document.documentElement.classList.add('mc-updating')}catch(e){}`;

export interface UpdatingNote {
  /** APP_VERSION of the bundle that asked, so a reload that lands on the same build is caught. */
  from: string;
  /** The percentage the old page reached. */
  progress: number;
  at: number;
}

export function writeUpdatingNote(from: string, progress: number, now: number): string {
  return JSON.stringify({ from, progress, at: now } satisfies UpdatingNote);
}

export function readUpdatingNote(raw: string | null | undefined, now: number): UpdatingNote | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<UpdatingNote>;
    if (typeof v.from !== 'string' || typeof v.at !== 'number' || typeof v.progress !== 'number') return null;
    if (now - v.at > UPDATING_TTL_MS || now < v.at - 5_000) return null;
    return { from: v.from, progress: Math.min(Math.max(v.progress, 0), STAGE.handover), at: v.at };
  } catch {
    return null;
  }
}

/**
 * Did the reload actually land on a different build? A handover that never came
 * can leave the page on the old worker, and then "updated" would be a lie — the
 * sheet will simply come back once the new worker is seen again.
 */
export function landedOnNewBuild(note: UpdatingNote, appVersion: string): boolean {
  return note.from !== appVersion;
}

export interface UpdateContent {
  /** The newest version the server has released, or null if it has not said. */
  version: string | null;
  starred: ShownNote[];
  rest: ShownNote[];
}

/**
 * What the sheet says: every release newer than the bundle this page runs,
 * newest first. The /api/whats-new that answers is the NEW server's, so these
 * are the notes of the build that is waiting. Featured notes get a big row, up
 * to three; everything else is the "and N more" list. A release with no notes
 * (or a failed request) leaves just the version and the button.
 */
export function updateContent(releases: WhatsNewRelease[] | null | undefined, appVersion: string): UpdateContent {
  const newer = (releases ?? [])
    .filter(r => compareAppVersions(r.app_version, appVersion) > 0)
    .sort((a, b) => compareAppVersions(b.app_version, a.app_version));
  const notes = newer.flatMap(r => r.notes);
  const starred = notes.filter(n => n.featured).slice(0, STARRED_MAX);
  const shown = new Set(starred.map(n => n.id));
  return {
    version: newer[0]?.app_version ?? null,
    starred,
    rest: notes.filter(n => !shown.has(n.id)),
  };
}

/**
 * The What's new sheet's slugs for these notes (lib/release-notes.ts
 * releaseEntries). Marked seen on the way into the update, because the person
 * has just read them: the digest sheet opening again after the reload would be
 * the same news twice.
 */
export function seenSlugs(content: UpdateContent): string[] {
  return content.starred.map(n => `release:${n.id}`);
}

type Typable = {
  tagName?: string;
  type?: string;
  value?: string;
  isContentEditable?: boolean;
  textContent?: string | null;
};

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/**
 * Somebody is halfway through writing something. The sheet waits for them to
 * leave the field; it is the one thing it waits for, and it waits because an
 * update that reloads the page would throw the text away.
 */
export function isMidTyping(el: Typable | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return !!el.value?.trim();
  if (tag === 'INPUT') return TEXT_INPUTS.has((el.type ?? '').toLowerCase()) && !!el.value?.trim();
  if (el.isContentEditable) return !!el.textContent?.trim();
  return false;
}
