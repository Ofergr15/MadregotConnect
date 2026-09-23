/**
 * What the landing page says when a Strava sign-in comes back as
 * ?strava=error&reason=… (#83).
 *
 * Before this, only two of the eleven reasons had words. Everything else, from a
 * member pressing "Cancel" on Strava to our own database failing, read the same
 * "sign-in failed, try again". That told the member nothing about whether trying
 * again would help, and it told us nothing when they reported it: two members
 * said "I get an error" and the logs of that morning were gone before anyone
 * looked. So each reason says what happened and what to do, and every reason
 * that is our fault carries the debug id the server logged, for the report.
 */

export interface LoginErrorText {
  text: string;
  /** Shown under the text so a screenshot of the error finds its log line. */
  debug: string | null;
}

const TEXT: Record<string, string> = {
  denied: 'לא אישרת גישה בסטרבה. כדי להתחבר צריך ללחוץ שם על אישור.',
  missing_params: 'החזרה מסטרבה לא הושלמה. לחצו שוב על התחברות עם סטרבה.',
  not_configured: 'ההתחברות דרך Strava עדיין לא מוגדרת. פנו למאמן.',
  no_athlete: 'סטרבה לא החזירה את פרטי החשבון. נסו שוב, ואם זה חוזר פנו למאמן.',
  lookup_failed: 'לא הצלחנו לבדוק את החשבון שלך. נסו שוב בעוד רגע.',
  save_failed: 'לא הצלחנו לשמור את החיבור לסטרבה. נסו שוב בעוד רגע.',
  session_create_failed: 'ההתחברות לא הושלמה אצלנו. נסו שוב בעוד רגע.',
  session_failed: 'ההתחברות לא נשמרה במכשיר הזה. לחצו שוב על התחברות עם סטרבה.',
  session_exception: 'ההתחברות לא נשמרה במכשיר הזה. לחצו שוב על התחברות עם סטרבה.',
};

const FALLBACK = 'ההתחברות נכשלה. נסו שוב.';

export function loginErrorText(reason: string | null, debug: string | null): LoginErrorText {
  const text = (reason && TEXT[reason]) || FALLBACK;
  // A cancel is the member's own choice and a missing config is ours to know;
  // neither needs a code to be reported with.
  const quiet = reason === 'denied' || reason === 'not_configured';
  const code = debug && /^[A-Za-z0-9-]{1,40}$/.test(debug) ? debug : null;
  return { text, debug: quiet ? null : code };
}

/**
 * What arrived at the callback, for its first log line: the parameter NAMES and
 * Strava's own `error`, never a value. The code and the state are credentials
 * (the state can carry an invite token), and a bare "hasCode:false" could not
 * tell a cancel from a stray reopen of the URL.
 */
export function callbackQueryShape(params: URLSearchParams): { keys: string[]; error: string | null } {
  const keys = [...new Set(params.keys())].sort();
  const error = params.get('error');
  return { keys, error: error ? error.slice(0, 40) : null };
}
