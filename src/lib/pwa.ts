/** True when running as the installed home-screen app, not a regular browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS only ever shows a web app's push notifications "natively" (no
 * generic-web-page attribution line) when the subscription itself was
 * created while running standalone (launched from the home screen icon) —
 * subscribing from a regular Safari tab permanently tags that subscription
 * as page-origin push, even after later adding the icon. Scoped to iOS only:
 * Android/desktop don't have this quirk, so gating them too would just add
 * needless friction to their opt-in.
 */
export function isIosDevice(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; disambiguate via touch.
    (/macintosh/i.test(ua) && 'ontouchend' in document);
  return isIos;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Requests permission (if needed) and subscribes this device to push,
 * persisting the subscription server-side. Shared by PushOptIn's contextual
 * banner and NotificationPrefs' always-available "enable notifications" row
 * — the same real action, just reached two different ways: an opportunistic
 * nudge right when push becomes useful, versus an on-demand retry for anyone
 * whose permission got reset (e.g. after revoking it in iOS Settings).
 */
export async function subscribeToPush(athleteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) return { ok: false, error: 'missing_vapid' };

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'permission_denied' };

    const reg = await navigator.serviceWorker.ready;

    // A subscription created before permission was reset (e.g. revoked in
    // iOS Settings, then re-granted) can still be sitting in the
    // PushManager — subscribe() then just hands back that same stale
    // subscription instead of a fresh one. Drop it first so this always
    // creates a real new subscription tied to the current context. Best
    // effort: iOS can throw unsubscribing a subscription left in a weird
    // state, and failing to clean up the old one must never block getting a
    // working new one.
    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
    } catch { /* ignore — proceed to subscribe regardless */ }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId, subscription: sub.toJSON(), userAgent: navigator.userAgent }),
    });
    if (!res.ok) return { ok: false, error: `save_failed_${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
