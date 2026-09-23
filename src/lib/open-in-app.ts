/**
 * /open — the door every staff email link goes through (#76).
 *
 * "I tap the approve link in the mail and it opens the browser, not the app on my
 * home screen." That is iOS, and nothing on our side can change it: a home-screen
 * web app has no universal links, so a link tapped in Mail or Gmail ALWAYS opens
 * Safari. And Safari's storage is not the installed app's storage, so the approver
 * lands signed out, on a login screen, in the wrong app.
 *
 * What we can do is stop that being a dead end. The mail links here; in the
 * installed app, or on anything that isn't an iPhone (Android hands in-scope links
 * to the installed app itself, a desktop has no app), this forwards at once. Only
 * iOS Safari stops, to say where the thing is waiting and offer to carry on in the
 * browser anyway.
 */

/** Where a link may send you: a path on this site, never another origin. */
export function safeTarget(to: string | null | undefined): string {
  if (!to || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return '/dashboard';
  return to;
}

/** The absolute email link for a path in the app. */
export function openInAppHref(appUrl: string, path: string): string {
  return `${appUrl}/open?to=${encodeURIComponent(path)}`;
}

export type OpenDecision = 'forward' | 'handoff';

/** Forward unless this is iOS Safari outside the installed app. */
export function openDecision(env: { standalone: boolean; iosSafari: boolean }): OpenDecision {
  return !env.standalone && env.iosSafari ? 'handoff' : 'forward';
}
