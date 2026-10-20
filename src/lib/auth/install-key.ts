/**
 * The sign-in a newly installed icon carries (api/auth/install-key). Six hours: the
 * member adds the app right after the install video and opens it within minutes,
 * and a key left in an icon nobody opened must not stay usable for days.
 */
export const INSTALL_KEY_TTL_MS = 6 * 60 * 60 * 1000;

/** A verifier as newVerifier() makes it: 32 random bytes, base64url, 43 characters. */
export const INSTALL_KEY = /^[A-Za-z0-9_-]{43}$/;

/** Points this page's manifest at the one whose start_url carries the key. */
export function pointManifestAt(verifier: string): void {
  if (typeof document === 'undefined' || !INSTALL_KEY.test(verifier)) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = `/api/public/manifest?k=${encodeURIComponent(verifier)}`;
}
