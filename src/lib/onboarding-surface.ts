// ═════════════════════════════════════════════════════════════════════════════
// The post-login stack: ONE surface per session (item 25).
//
// Right after login a member could get the install sheet, the first-run tour
// (welcome + spotlights + "what's new lately") and the install strip, all in the
// same visit. These rules decide which ONE of them a session gets. They are pure
// so they can be tested without a DOM; InstallStepProvider feeds them and holds
// the session lock (`sessionSurface`) — the first surface that actually renders
// claims the session and every other one stays off until the next visit.
//
//   tour         — new members only (account < NEW_MEMBER_DAYS old) who haven't
//                  seen it. First in line: a new member's first visit is the tour.
//   whatsNew     — returning members only, and only when something is unseen.
//   installSheet — never on the signup day, never standalone, and only in a
//                  session that neither of the two above took.
//   installStrip — only once the sheet has been waved away, at most once every
//                  STRIP_EVERY_MS, never standalone.
//   native shell — none of them (lib/native-shell.ts).
// ═════════════════════════════════════════════════════════════════════════════

export type OnbSurface = 'tour' | 'whatsNew' | 'installSheet' | 'installStrip';

/** sessionStorage: which surface this visit belongs to. */
export const SESSION_SURFACE_KEY = 'onb_session_surface';
/** localStorage: until when the strip stays away (stamped when it is shown). */
export const STRIP_HIDE_KEY = 'pwa_install_strip_hidden_until';
export const STRIP_EVERY_MS = 7 * 24 * 3600 * 1000;

/**
 * "New" is the club's existing definition: the 7 days the badge engine already
 * keeps quiet (NEW_MEMBER_QUIET_DAYS in lib/badges/award-engine — a server module,
 * so the value is mirrored here rather than imported into the client bundle).
 */
export const NEW_MEMBER_DAYS = 7;
const DAY_MS = 86_400_000;

const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' });

/** Account younger than NEW_MEMBER_DAYS. Unknown signup date reads as returning. */
export function isNewMember(memberSince: string | null | undefined, now: number): boolean {
  const t = memberSince ? Date.parse(memberSince) : NaN;
  return Number.isFinite(t) && now - t < NEW_MEMBER_DAYS * DAY_MS;
}

/** Same calendar day (Israel) as the signup. Unknown signup date: not the signup day. */
export function isSignupDay(memberSince: string | null | undefined, now: number): boolean {
  const t = memberSince ? Date.parse(memberSince) : NaN;
  if (!Number.isFinite(t)) return false;
  return ISRAEL_DAY.format(t) === ISRAEL_DAY.format(now);
}

export interface SurfaceContext {
  now: number;
  /** lib/native-shell: a native build suppresses the whole stack. */
  native: boolean;
  /** Running from the home-screen icon. */
  standalone: boolean;
  /** /api/onboarding has answered (memberSince + tourSeen are known). */
  loaded: boolean;
  /** athletes.created_at. */
  memberSince: string | null;
  /** Has an athlete row and hasn't seen the tour. */
  tourUnseen: boolean;
  /** WhatsNewAutoSheet's report: 'unknown' until it has looked (or timed out). */
  whatsNew: 'unknown' | 'pending' | 'none';
  /** The provider holds an install offer this device hasn't answered. */
  installOffer: boolean;
  /** The sheet was waved away before (a "not now" banked, or the guide seen). */
  sheetDismissed: boolean;
  /** Installed / "don't offer again". */
  installDismissedForever: boolean;
  /** Anything to re-offer on this device at all (InstallStepValue.canOffer). */
  canOffer: boolean;
  /** STRIP_HIDE_KEY, ms epoch; 0 when never shown. */
  stripHiddenUntil: number;
  /** The surface that already claimed this session, if any. */
  sessionSurface: OnbSurface | null;
}

/**
 * Which ONE surface may be on screen now, or null for none. Null can also mean
 * "not decided yet" — see `isSettled`.
 */
export function pickSurface(c: SurfaceContext): OnbSurface | null {
  if (c.native) return null;
  // The lock: whoever claimed the session keeps it, nobody else gets it.
  if (c.sessionSurface) {
    if (c.standalone && (c.sessionSurface === 'installSheet' || c.sessionSurface === 'installStrip')) return null;
    return c.sessionSurface;
  }
  if (!c.loaded) return null;
  const isNew = isNewMember(c.memberSince, c.now);
  if (isNew && c.tourUnseen) return 'tour';
  if (!isNew) {
    if (c.whatsNew === 'pending') return 'whatsNew';
    if (c.whatsNew === 'unknown') return null; // wait for it before offering install
  }
  if (c.standalone || isSignupDay(c.memberSince, c.now)) return null;
  if (c.installOffer) return 'installSheet';
  if (c.sheetDismissed && c.canOffer && !c.installDismissedForever && c.stripHiddenUntil <= c.now) {
    return 'installStrip';
  }
  return null;
}

/** False while pickSurface is still waiting on an input (so its null isn't final). */
export function isSettled(c: SurfaceContext): boolean {
  if (c.native || c.sessionSurface) return true;
  if (!c.loaded) return false;
  const isNew = isNewMember(c.memberSince, c.now);
  if (isNew && c.tourUnseen) return true;
  return isNew || c.whatsNew !== 'unknown';
}

/**
 * Has the install step been answered, as far as push is concerned? The real
 * answer (installed / dismissed / skipped), OR the stack has settled on a session
 * that won't offer install at all — deferred to day 1, or taken by the tour or
 * What's New. Push then follows exactly as it did for a device that can't be
 * asked; the iOS-tab guard in canShowNotificationsStep still keeps a Safari tab
 * from subscribing page-origin.
 */
export function installAnsweredForPush(c: SurfaceContext, reallyAnswered: boolean): boolean {
  if (reallyAnswered || c.native) return true;
  if (!isSettled(c)) return false;
  return pickSurface(c) !== 'installSheet';
}
