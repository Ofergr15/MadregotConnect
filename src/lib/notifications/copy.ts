import type { NotificationLocale } from './locale';

/**
 * Notification wording, per language.
 *
 * Deliberately NOT next-intl: that resolves messages from the incoming request
 * (a cookie and a React context), and these strings are built inside cron jobs
 * and sync routes where there is no request and no React. A plain function per
 * message keeps the parameters type-checked, which matters more here than
 * message-file tooling — a notification with an undefined in it ships straight
 * to a lock screen.
 *
 * Each entry returns FOUR strings, not two, because the same event is read on
 * two surfaces with opposite needs:
 *
 *  - the push, where iOS wraps the title in "from Madregot" and the app icon,
 *    so a fixed header reads as one channel you can skim (Strava's shape);
 *  - the in-app history, which renders title as a row label and body as its
 *    sublabel (dashboard/notifications/page.tsx), so a fixed header there
 *    would give twenty identical labels and push every name onto line two.
 */
export interface NotificationCopy {
  pushTitle: string;
  pushBody: string;
  historyTitle: string;
  historyBody: string;
}

/**
 * Hebrew verbs are gendered, so this has to agree with the runner. `gender` is
 * optional (migration 057) and null on most rows, hence the both-forms
 * fallback — which is the common path, not the edge case. English needs none of
 * this, which is why the copy is a function per language rather than one
 * template with swapped words.
 */
function completedHe(gender: string | null | undefined): string {
  if (gender === 'male') return 'סיים';
  if (gender === 'female') return 'סיימה';
  return 'סיים/ה';
}

/**
 * Stand-in when the runner's row has no usable name. Lives here rather than at
 * the call site because it is copy like any other, and a Hebrew placeholder
 * inside an otherwise-English notification is exactly the seam this module
 * exists to close.
 */
const FALLBACK_RUNNER_NAME: Record<NotificationLocale, string> = {
  he: 'חבר/ה לקבוצה',
  en: 'A teammate',
};

export interface TeammateActivityParams {
  name: string | null | undefined;
  gender: string | null | undefined;
  /** Formatted distance, e.g. "8.3". */
  km: string;
}

const teammateActivity: Record<NotificationLocale, (p: TeammateActivityParams) => NotificationCopy> = {
  he: ({ name, gender, km }) => ({
    pushTitle: '🏃 פעילות חדשה',
    pushBody: `${name} ${completedHe(gender)} ריצה • ${km} ק"מ`,
    historyTitle: `🏃 ${name} ${completedHe(gender)} ריצה`,
    historyBody: `${km} ק"מ`,
  }),
  en: ({ name, km }) => ({
    pushTitle: '🏃 New Activity',
    pushBody: `${name} completed a run • ${km} km`,
    historyTitle: `🏃 ${name} completed a run`,
    historyBody: `${km} km`,
  }),
};

export function teammateActivityCopy(
  locale: NotificationLocale,
  params: TeammateActivityParams,
): NotificationCopy {
  return teammateActivity[locale]({
    ...params,
    name: (params.name || '').trim() || FALLBACK_RUNNER_NAME[locale],
  });
}

/** The 👍 kudos action button on a teammate-activity push. */
export const KUDOS_ACTION_LABEL: Record<NotificationLocale, string> = {
  he: '👍 קודוס',
  en: '👍 Kudos',
};

/** The self-service "is push working?" probe (/api/push/test). */
export const PUSH_TEST_COPY: Record<NotificationLocale, { title: string; body: string }> = {
  he: { title: '🔔 בדיקת התראות', body: 'ההתראות עובדות! זו התראת בדיקה מהאפליקציה.' },
  en: { title: '🔔 Notification test', body: 'Notifications are working! This is a test from the app.' },
};
