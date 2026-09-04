/**
 * The last page of a Strava login that started inside the app.
 *
 * We are running in iOS's in-app browser sheet — the one a standalone PWA is
 * forced to open for a cross-origin navigation. The login is done and parked in
 * login_handoffs; the app underneath is polling for it and will pick it up the
 * instant it is in the foreground again. All that is left is telling the member
 * to close this sheet, because nothing on the page can close it for them: the ✕
 * belongs to iOS, not to the document.
 *
 * Deliberately a server component with the Hebrew inline (as /auth/resolve does):
 * no session, no client hooks, no translation bundle. It renders on the first
 * paint even on a bad connection, which matters because it is the only
 * instruction the member gets.
 */
export default function AuthHandoffPage() {
  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-6" dir="rtl">
      {/* The ✕ is top-left in the iOS sheet, so the cue points there. */}
      <div className="fixed top-3 start-4 flex items-center gap-2 text-ink-500" aria-hidden="true">
        <span className="text-2xl leading-none">↖</span>
        <span className="text-sm font-medium">כאן</span>
      </div>

      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600/10">
          <svg
            className="h-7 w-7 text-brand-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-ink-900">התחברת בהצלחה</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          סגרו את החלון הזה בכפתור <span className="font-bold">✕</span> שלמעלה —
          האפליקציה תמשיך מכאן בעצמה.
        </p>
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          החלון הזה נפתח על ידי האייפון מחוץ לאפליקציה, ולכן ההתחברות מסתיימת בתוך
          האפליקציה עצמה.
        </p>
      </div>
    </div>
  );
}
