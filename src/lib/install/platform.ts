// Which install guide this device needs. The guide is drawn per platform because
// every one of them installs differently, and a non-technical member following
// the wrong pictures is a member who never gets the icon:
//
//   ios-safari     Safari on iOS ≤ 18 — Share is the middle button of the bottom bar.
//   ios-safari-26  Safari on iOS 26+ in the "Bottom" layout (what an upgraded phone
//                  keeps): Share in the bottom row, then "View More" in the sheet.
//   ios-safari-compact  iOS 26+ in the "Compact" layout (a new phone's default):
//                  Share is behind the menu button. Not detectable from the UA, so
//                  it is the "looks different on my phone" alternative.
//   ios-inapp      a webview (WhatsApp, Gmail, Instagram) or Chrome/Firefox on an
//                  iPhone: none of them can add to the home screen, so step one is
//                  leaving for Safari.
//   android        Chrome on Android: `beforeinstallprompt` gives a real button.
//   android-inapp  a webview on Android: open in Chrome first.
//   desktop        nothing to install here; the guide is a QR code for the phone.
//   standalone     already the installed app — no guide at all.
//
// Pure on purpose (takes the UA and two flags), so every branch is unit-tested
// without a browser.

import { isInAppBrowser, isIosDevice, isStandalone } from '@/lib/pwa';

export type InstallPlatform =
  | 'ios-safari'
  | 'ios-safari-26'
  | 'ios-safari-compact'
  | 'ios-inapp'
  | 'android'
  | 'android-inapp'
  | 'desktop'
  | 'standalone';

export interface PlatformSignals {
  ua: string;
  standalone: boolean;
  /** iPadOS 13+ says Macintosh; the caller resolves that with a touch check. */
  ios: boolean;
  inApp: boolean;
  /**
   * The primary pointer is a finger: `(pointer: coarse)` and no hover, with touch
   * points. What tells a phone that asked for the "desktop site" (Android sends a
   * Linux desktop UA then) from a real computer. A touchscreen laptop still has a
   * trackpad or mouse as its PRIMARY pointer, so it stays a computer.
   */
  fingerPrimary?: boolean;
}

/**
 * The iOS major version. Safari 26 froze the `OS 18_6` token in the UA, so the
 * `Version/26` product is read first; older Safari carries both and they agree.
 */
export function iosMajor(ua: string): number | null {
  const v = ua.match(/Version\/(\d+)/);
  if (v) return Number(v[1]);
  const os = ua.match(/OS (\d+)_/);
  return os ? Number(os[1]) : null;
}

export function classifyPlatform({ ua, standalone, ios, inApp, fingerPrimary }: PlatformSignals): InstallPlatform {
  if (standalone) return 'standalone';
  if (ios) {
    // Chrome / Firefox / Edge on iOS can't install a web app either.
    if (inApp || /crios|fxios|edgios/i.test(ua) || !/safari\//i.test(ua)) return 'ios-inapp';
    return (iosMajor(ua) ?? 0) >= 26 ? 'ios-safari-26' : 'ios-safari';
  }
  if (/android/i.test(ua)) return inApp ? 'android-inapp' : 'android';
  // A desktop UA on a finger-driven screen: an Android phone on "desktop site".
  if (fingerPrimary) return inApp ? 'android-inapp' : 'android';
  return 'desktop';
}

export function detectInstallPlatform(): InstallPlatform {
  return classifyPlatform({
    ua: window.navigator.userAgent,
    standalone: isStandalone(),
    ios: isIosDevice(),
    inApp: isInAppBrowser(),
    fingerPrimary: fingerIsPrimaryPointer(),
  });
}

/** The Safari layouts, for the "looks different on my phone" switch. */
export const otherSafari = (p: InstallPlatform): InstallPlatform =>
  p === 'ios-safari-26' ? 'ios-safari-compact' : p === 'ios-safari-compact' ? 'ios-safari-26' : p === 'ios-safari' ? 'ios-safari-26' : p;

/** See PlatformSignals.fingerPrimary. */
export function fingerIsPrimaryPointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
      && !window.matchMedia('(hover: hover)').matches
      && (navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * A computer (desktop or laptop browser), as opposed to a phone or tablet. On a
 * computer the onboarding drops what only a phone can use (the notification
 * request, "installed ✓", the home-screen guide) and invites the member to
 * continue on the phone instead — never blocks them (Ofer, 2026-10-09).
 * An installed app is never a computer here: a desktop PWA behaves like the app.
 */
export function isComputer(): boolean {
  if (typeof window === 'undefined') return false;
  return detectInstallPlatform() === 'desktop';
}
