'use client';

import { useEffect, useState } from 'react';
import { hardReload, isStaleBundleError } from '@/lib/recover';

/**
 * The screen a user sees when something in the app threw.
 *
 * ⚠️ Copy is hardcoded Hebrew, NOT next-intl. An error screen must not be able to
 * throw, and reaching for a translation provider is reaching for one more thing
 * that can be the very thing that broke — the boundary above `NextIntlClientProvider`
 * would have no messages at all. Same reason there is no `Card`/`Button` import
 * here: plain elements only, so this file's dependencies cannot be the cause of
 * the crash it is reporting.
 *
 * Two different offers, because there are two different failures:
 *  - a stale bundle after a deploy, which `retry()` can never fix (it re-imports
 *    the same dead chunk URL) and only a cache-drop-and-reload will;
 *  - anything else, where re-rendering is a real chance and worth one button.
 */
export function CrashScreen({
  error,
  retry,
  scope,
}: {
  error: Error & { digest?: string };
  /**
   * Next 16's error-boundary prop: re-fetches and re-renders the failed segment.
   * (`reset` still exists but only clears the error state without re-fetching —
   * see node_modules/next/dist/docs/…/file-conventions/error.md.)
   */
  retry?: () => void;
  /** Where this boundary sits, so a report says which tree died. */
  scope: string;
}) {
  const stale = isStaleBundleError(error);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    // The console is the only reporting channel this app has. Keep the digest —
    // it is what ties a user's screenshot to a server-side stack in Vercel.
    console.error(`[crash:${scope}]`, error?.message, error?.digest ?? '', error);
  }, [error, scope]);

  // A stale bundle is not a decision to put to the user: nothing else on the page
  // is going to work, and every second spent reading a button is a second the app
  // looks broken. Recover on sight, and keep the button for when it fails.
  useEffect(() => {
    if (!stale) return;
    setWorking(true);
    void hardReload();
  }, [stale]);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#DFDFDF',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#1D1E26',
      }}
    >
      <div style={{ maxWidth: '380px', width: '100%', textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 18px',
            borderRadius: '9999px',
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '26px',
            lineHeight: 1,
          }}
        >
          {stale ? '↻' : '!'}
        </div>

        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 10px' }}>
          {stale ? 'מעדכנים לגרסה החדשה' : 'משהו נתקע'}
        </h1>
        <p style={{ fontSize: '15px', lineHeight: 1.6, color: '#2D2E38', margin: '0 0 22px' }}>
          {stale
            ? 'יצאה גרסה חדשה של האפליקציה. אנחנו טוענים אותה עכשיו — זה ייקח רגע.'
            : 'זו תקלה אצלנו, לא משהו שעשית. אפשר לנסות שוב, ואם זה חוזר — טעינה מחדש כמעט תמיד פותרת.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {!stale && retry && (
            <button
              type="button"
              onClick={retry}
              style={{
                appearance: 'none',
                border: 'none',
                borderRadius: '9999px',
                padding: '14px 20px',
                fontSize: '16px',
                fontWeight: 700,
                color: '#FFFFFF',
                background: '#1525FF',
                cursor: 'pointer',
              }}
            >
              נסה שוב
            </button>
          )}
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true);
              void hardReload();
            }}
            style={{
              appearance: 'none',
              borderRadius: '9999px',
              padding: '14px 20px',
              fontSize: '16px',
              fontWeight: 600,
              color: '#1D1E26',
              background: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.08)',
              cursor: working ? 'default' : 'pointer',
              opacity: working ? 0.6 : 1,
            }}
          >
            {working ? 'טוען…' : 'טעינה מחדש'}
          </button>
          {!stale && (
            // A plain <a>, not next/link, on purpose: Link routes client-side through
            // the very router that may be what threw, and would leave the user on the
            // same dead tree. A full document load is the point here.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#656565',
                textDecoration: 'none',
                padding: '8px',
              }}
            >
              חזרה לדף הבית
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
