'use client';

// "There is something real to look at" — the signal the app-open splash waits
// for instead of its fixed timer. The feed screen raises it once its first page
// is on screen (from the saved copy or fresh), every other screen as soon as the
// shell has rendered. One flag plus one event, so a listener that mounts after
// the signal still sees it.
const EVENT = 'mc:app-ready';
let ready = false;

export function markAppReady(): void {
  if (ready || typeof window === 'undefined') return;
  ready = true;
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `fn` once the app is ready (at once if it already is). Returns an unsubscribe. */
export function onAppReady(fn: () => void): () => void {
  if (ready) { fn(); return () => {}; }
  const handler = () => fn();
  window.addEventListener(EVENT, handler, { once: true });
  return () => window.removeEventListener(EVENT, handler);
}
