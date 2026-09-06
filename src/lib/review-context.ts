'use client';

import { APP_VERSION } from '@/lib/version';

/**
 * The diagnostics a bug report needs and the reporter can't be asked for.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * /dashboard/review is the club's only "something is broken" channel, and the
 * reports it produced were a single sentence with no way to act on it: "the
 * calendar doesn't open" — on which screen, which app version, which phone? All
 * three are knowable from the browser, and none of them are knowable by the
 * person typing. So the screen collects them, SHOWS them (collapsed, but never
 * hidden — attaching device details silently would be a small betrayal), and
 * sends them alongside the message.
 *
 * The parsing here is deliberately pure and deliberately coarse. It is not a
 * user-agent database and must never become one: the only question is "which
 * phone and OS should I reproduce this on", and "iPhone · iOS 17.4" answers it.
 * Pure so it's the one part of this feature a unit test can pin.
 */
export interface ReviewContext {
  /** The screen the report is ABOUT — not necessarily the review screen. */
  page: string | null;
  /** That screen's human name, resolved from the nav labels while we have them. */
  pageLabel: string | null;
  appVersion: string;
  /** e.g. "iPhone · iOS 17.4 · Safari" — see describeDevice. */
  device: string;
  /** Installed to the home screen, or running in a browser tab. */
  standalone: boolean;
  /** e.g. "390×844" — catches "broken on a small screen" without a screenshot. */
  viewport: string;
  locale: string;
  /** ISO timestamp, so the report can be lined up against server logs. */
  at: string;
}

/** localStorage key for the in-progress draft. */
export const REVIEW_DRAFT_KEY = 'madregot_review_draft';

/**
 * sessionStorage key holding the screen the user was on BEFORE they opened the
 * review screen. Written by the (app) layout on every navigation, because by
 * the time this screen mounts the interesting pathname is already gone — and
 * "which screen were you on" is the single most useful thing in a bug report.
 */
export const REVIEW_LAST_PATH_KEY = 'madregot_last_path';

/**
 * The device, as coarsely as is still useful. Order matters: iPadOS reports
 * itself as "Macintosh … Mobile" and Android tablets say "Android", so the more
 * specific test always comes first.
 */
export function describeDevice(ua: string): string {
  if (!ua) return 'Unknown device';
  const parts: string[] = [];

  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  const isIPhone = /iPhone/.test(ua);
  const isAndroid = /Android/.test(ua);

  if (isIPad) parts.push('iPad');
  else if (isIPhone) parts.push('iPhone');
  else if (isAndroid) parts.push(/Mobile/.test(ua) ? 'Android phone' : 'Android tablet');
  else if (/Macintosh/.test(ua)) parts.push('Mac');
  else if (/Windows/.test(ua)) parts.push('Windows PC');
  else parts.push('Other');

  // iOS/iPadOS report the version with underscores ("17_4_1").
  const ios = ua.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/);
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if ((isIPhone || isIPad) && ios) parts.push(`iOS ${ios[1]}.${ios[2]}`);
  else if (isAndroid && android) parts.push(`Android ${android[1]}`);
  else if (isIPad) {
    // An iPad reached through the Macintosh alias advertises the MAC version
    // ("Mac OS X 10_15_7") and no iOS version at all. Printing that would name a
    // real macOS release that isn't running — so it names the platform and stops.
    // Guessing from Safari's `Version/` token would be a guess presented as a
    // reading, which is the one thing this function must not do.
    parts.push('iPadOS');
  } else if (!isIPhone && /Mac OS X (\d+)[._](\d+)/.test(ua)) {
    const mac = ua.match(/Mac OS X (\d+)[._](\d+)/)!;
    parts.push(`macOS ${mac[1]}.${mac[2]}`);
  }

  // Browser, last and least. Chrome's UA contains "Safari" and Edge's contains
  // both, so this reads most-specific first too.
  if (/Edgi?e?\//.test(ua)) parts.push('Edge');
  else if (/CriOS|Chrome\//.test(ua)) parts.push('Chrome');
  else if (/FxiOS|Firefox\//.test(ua)) parts.push('Firefox');
  else if (/Safari\//.test(ua)) parts.push('Safari');

  return parts.join(' · ');
}

/**
 * Snapshot the browser. Returns null off the browser (SSR / prerender) rather
 * than a half-filled object, so a caller can't accidentally send "Unknown
 * device · 0×0" as if it were a real reading.
 */
export function collectReviewContext(
  { page, pageLabel, locale }: { page: string | null; pageLabel: string | null; locale: string },
): ReviewContext | null {
  if (typeof window === 'undefined') return null;
  return {
    page,
    pageLabel,
    appVersion: APP_VERSION,
    device: describeDevice(navigator.userAgent),
    // The PWA-vs-tab split matters more here than it looks: half the iOS bugs
    // in this app (standalone meta tag, service worker, push) only reproduce in
    // one of the two, and the reporter has no idea which one they're in.
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    locale,
    at: new Date().toISOString(),
  };
}

/**
 * The context as label/value rows, for the disclosure on the review screen and
 * the triage sheet in Settings. One function so the two can't describe the same
 * object differently — the whole point of showing it to the reporter is that
 * it's the same thing the staff will read.
 */
export function reviewContextRows(
  ctx: Partial<ReviewContext> | null | undefined,
  labels: { page: string; version: string; device: string; screen: string; mode: string },
): Array<{ label: string; value: string }> {
  if (!ctx) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const where = ctx.pageLabel || ctx.page;
  if (where) rows.push({ label: labels.page, value: where });
  if (ctx.appVersion) rows.push({ label: labels.version, value: ctx.appVersion });
  if (ctx.device) rows.push({ label: labels.device, value: ctx.device });
  if (ctx.viewport) rows.push({ label: labels.screen, value: ctx.viewport });
  if (ctx.standalone !== undefined) {
    rows.push({ label: labels.mode, value: ctx.standalone ? 'PWA' : 'Browser' });
  }
  return rows;
}

/**
 * Shrink a picked image to something a TEXT column and a mobile uplink can
 * actually carry.
 *
 * This is a fix, not a nicety. The screen read the file with FileReader and
 * POSTed the raw data URL, so a modern iPhone screenshot (~2-4 MB, +33% for
 * base64) was sent as a ~5 MB JSON body into a column holding base64 strings.
 * The largest report that ever made it through prod is 283 KB — i.e. the big
 * ones were silently failing, on the exact screen whose job is to tell us that
 * things fail.
 *
 * 1280px on the long edge keeps UI text in a screenshot legible while landing
 * comfortably under 300 KB. Falls back to the original data URL if canvas
 * encoding isn't available, because a large screenshot still beats none.
 */
export async function compressImage(file: File, maxEdge = 1280, quality = 0.7): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode-failed'));
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // JPEG, not PNG: a screenshot re-encoded as PNG is often BIGGER than the
    // original, which would defeat the whole point.
    const out = canvas.toDataURL('image/jpeg', quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

/** Rough decoded byte size of a data URL, for the "attached · 180 KB" line. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** "184 KB" / "1.2 MB" — one place, so the two size readouts agree. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
