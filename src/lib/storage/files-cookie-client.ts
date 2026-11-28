'use client';

/**
 * Keeps the httpOnly `mc_files` cookie (lib/storage/file-access.ts) fresh, so <img> tags
 * can load private-bucket files through /api/files. Login sets it (/api/auth/device-token);
 * this re-mints it at most every 12 hours while the app is used — the cookie lasts 7 days.
 * Fire-and-forget: a miss costs an image, never a request.
 */
const KEY = 'mc_files_minted_at';
const REFRESH_MS = 12 * 60 * 60 * 1000;
let inFlight = false;

export function ensureFilesCookie(token: string, now = Date.now()): void {
  if (inFlight || typeof window === 'undefined') return;
  try {
    const at = Number(window.localStorage.getItem(KEY) || 0);
    if (at && now - at < REFRESH_MS) return;
  } catch {
    // Private mode: mint once per page load.
  }
  inFlight = true;
  fetch('/api/files/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    .then((res) => {
      if (!res.ok) return;
      try {
        window.localStorage.setItem(KEY, String(now));
      } catch {
        /* private mode */
      }
    })
    .catch(() => {})
    .finally(() => {
      inFlight = false;
    });
}

/** Sign-out: the next login mints again. */
export function forgetFilesCookie(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
