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

/**
 * The 👍 kudos action button on a teammate-activity push. Hebrew calls it כיף
 * (as in "תן כיף") rather than the transliterated "קודוס" — Ofer's wording.
 */
export const KUDOS_ACTION_LABEL: Record<NotificationLocale, string> = {
  he: '👍 כיף',
  en: '👍 Kudos',
};

/** The self-service "is push working?" probe (/api/push/test). */
export const PUSH_TEST_COPY: Record<NotificationLocale, { title: string; body: string }> = {
  he: { title: '🔔 בדיקת התראות', body: 'ההתראות עובדות! זו התראת בדיקה מהאפליקציה.' },
  en: { title: '🔔 Notification test', body: 'Notifications are working! This is a test from the app.' },
};

// ───────────────────────────────────────────────────────────────────────────
// Everything below was hardcoded Hebrew at ~20 send sites. v2.36.0 gave every
// athlete a notification-language setting and then honoured it for exactly one
// notification, so picking English changed one push out of twenty.
//
// The Hebrew in here is copied VERBATIM from those call sites, including the
// emoji, the gendered slash forms and the geresh/gershayim spellings. A Hebrew
// reader must receive byte-identical text after this refactor — the point is to
// add English, not to relitigate copy that's already in front of the club.
// copy.test.ts pins that.
// ───────────────────────────────────────────────────────────────────────────

/** Most notifications need only these two lines. */
export interface PushCopy {
  title: string;
  body: string;
}

/** When a name is missing at the call site. */
const SOMEONE: Record<NotificationLocale, string> = { he: 'מישהו', en: 'Someone' };

/**
 * Duplicated verbatim in four modules today (both notification senders plus
 * both sync routes' feed text). Only the two notification copies are folded in
 * here — widening this to the sync routes would drag feed rendering into the
 * notification-language setting, which is a different question.
 */
const RUN_TYPE_LABELS: Record<NotificationLocale, Record<string, string>> = {
  he: {
    running: 'ריצה',
    trail_running: 'ריצת שטח',
    treadmill_running: 'ריצת הליכון',
    track_running: 'ריצת מסלול',
    virtual_run: 'ריצה וירטואלית',
    street_running: 'ריצת רחוב',
    indoor_running: 'ריצה באולם',
  },
  en: {
    running: 'Run',
    trail_running: 'Trail run',
    treadmill_running: 'Treadmill run',
    track_running: 'Track run',
    virtual_run: 'Virtual run',
    street_running: 'Street run',
    indoor_running: 'Indoor run',
  },
};

/** Falls back to the plain "run" label for a type outside the map. */
export function runTypeLabel(locale: NotificationLocale, activityType: string | null | undefined): string {
  return (activityType && RUN_TYPE_LABELS[locale][activityType]) || RUN_TYPE_LABELS[locale].running;
}

/** Sunday-first, matching DAY_NAMES in cron/tick and the app's Sun→Sat week. */
const DAY_NAMES: Record<NotificationLocale, string[]> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export function dayName(locale: NotificationLocale, dayOfWeek: number): string {
  return DAY_NAMES[locale][dayOfWeek] ?? DAY_NAMES[locale][0];
}

/**
 * Mirrors EVENT_KIND_LABELS in src/lib/events.ts, which is Hebrew-only because
 * it is also used for on-screen labels that next-intl would normally cover.
 * Kept as Record<string, string> rather than importing EventKind, so the copy
 * module stays free of app-model imports.
 */
const EVENT_KIND_LABELS: Record<NotificationLocale, Record<string, string>> = {
  he: {
    race: '🏆 מרוץ',
    camp: '🏕️ מחנה אימונים',
    lecture: '🎤 הרצאה',
    social: '🎉 אירוע חברתי',
    photo_shoot: '📸 צילומים',
    sponsor: '🤝 אירוע ספונסר',
    workout: '🏃 אימון מיוחד',
  },
  en: {
    race: '🏆 Race',
    camp: '🏕️ Training camp',
    lecture: '🎤 Talk',
    social: '🎉 Social event',
    photo_shoot: '📸 Photo shoot',
    sponsor: '🤝 Sponsor event',
    workout: '🏃 Special session',
  },
};

export function eventKindLabel(locale: NotificationLocale, kind: string): string {
  return EVENT_KIND_LABELS[locale][kind] || EVENT_KIND_LABELS[locale].race;
}

/**
 * A date already formatted for the reader's language. The Hebrew side keeps
 * he-IL so existing notifications are unchanged; English gets en-GB (day-first),
 * which matches how the club actually writes dates.
 */
const DATE_LOCALE: Record<NotificationLocale, string> = { he: 'he-IL', en: 'en-GB' };
export function shortDate(locale: NotificationLocale, date: string | Date): string {
  return new Date(date).toLocaleDateString(DATE_LOCALE[locale], { day: 'numeric', month: 'short' });
}

// ── Social ────────────────────────────────────────────────────────────────

export function followCopy(locale: NotificationLocale, p: { name: string | null | undefined }): PushCopy {
  const who = (p.name || '').trim() || SOMEONE[locale];
  return locale === 'he'
    ? { title: `${who} התחיל/ה לעקוב אחריך 👋`, body: 'היכנסו לפרופיל שלכם כדי לראות' }
    : { title: `${who} started following you 👋`, body: 'Open your profile to take a look' };
}

export function kudosCopy(locale: NotificationLocale, p: { name: string | null | undefined }): PushCopy {
  const who = (p.name || '').trim() || SOMEONE[locale];
  return locale === 'he'
    ? { title: `${who} נתן/ה לך כיף על הריצה! 👍`, body: 'לחצו לצפייה' }
    : { title: `${who} gave you kudos on your run! 👍`, body: 'Tap to view' };
}

export function feedInteractionCopy(
  locale: NotificationLocale,
  p: { name: string | null | undefined; kind: 'like' | 'comment'; commentBody?: string },
): PushCopy {
  const who = (p.name || '').trim() || SOMEONE[locale];
  const preview = (p.commentBody || '').trim();
  const clipped = preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
  if (locale === 'he') {
    const fallback = 'היכנסו לפיד כדי לראות';
    return {
      title: p.kind === 'like' ? `${who} אהב את הפוסט שלך ❤️` : `${who} הגיב לך 💬`,
      body: p.kind === 'like' ? fallback : clipped || fallback,
    };
  }
  const fallback = 'Open the feed to take a look';
  return {
    title: p.kind === 'like' ? `${who} liked your post ❤️` : `${who} commented on your post 💬`,
    body: p.kind === 'like' ? fallback : clipped || fallback,
  };
}

export function mentionCopy(
  locale: NotificationLocale,
  p: { name: string | null | undefined; kind: 'post' | 'comment' },
): { title: string } {
  const who = (p.name || '').trim() || SOMEONE[locale];
  // Body is the mention's own text, clipped by the caller — nothing to translate.
  return locale === 'he'
    ? { title: `${who} תייג/ה אותך ${p.kind === 'comment' ? 'בתגובה' : 'בפוסט'} 🏷️` }
    : { title: `${who} mentioned you in a ${p.kind === 'comment' ? 'comment' : 'post'} 🏷️` };
}

export function feedPostCopy(
  locale: NotificationLocale,
  p: { name: string | null | undefined; preview?: string },
): PushCopy {
  const who = (p.name || '').trim() || SOMEONE[locale];
  const preview = (p.preview || '').trim();
  return locale === 'he'
    ? { title: `${who} פרסם/ה בפיד 📸`, body: preview || 'לחצו לצפייה' }
    : { title: `${who} posted in the feed 📸`, body: preview || 'Tap to view' };
}

// ── Workouts & plans ──────────────────────────────────────────────────────

export function postWorkoutPromptCopy(
  locale: NotificationLocale,
  p: { activityType: string | null | undefined; km: number | null },
): PushCopy {
  const label = runTypeLabel(locale, p.activityType);
  if (locale === 'he') {
    return {
      title: 'כל הכבוד על האימון! 🏃',
      body: p.km
        ? `${label} של ${p.km} ק״מ — איך היה? ספרו לנו במשוב קצר`
        : 'איך היה? ספרו לנו במשוב קצר',
    };
  }
  return {
    title: 'Nice work on that session! 🏃',
    body: p.km
      ? `${p.km} km ${label.toLowerCase()} — how did it go? Leave a quick note`
      : 'How did it go? Leave a quick note',
  };
}

export function workoutDetectedCopy(
  locale: NotificationLocale,
  p: { activityType: string | null | undefined; timeStr: string },
): PushCopy {
  const label = runTypeLabel(locale, p.activityType);
  if (locale === 'he') {
    return {
      title: `🏃 זוהה אימון: ${label}`,
      body: p.timeStr
        ? `מנתחים את הנתונים מ-${p.timeStr} — נשתף עוד מידע בקרוב`
        : 'מנתחים את הנתונים — נשתף עוד מידע בקרוב',
    };
  }
  return {
    title: `🏃 Session detected: ${label}`,
    body: p.timeStr
      ? `Crunching the data from ${p.timeStr} — more soon`
      : 'Crunching the data — more soon',
  };
}

export function activitySyncedCopy(locale: NotificationLocale): PushCopy {
  return locale === 'he'
    ? { title: 'האימון שלך סונכרן! 🏃', body: 'התאמה אישית של הפוסט לפני שהוא יוצא לפיד' }
    : { title: 'Your session synced! 🏃', body: 'Customise the post before it goes out to the feed' };
}

export function planPushedCopy(locale: NotificationLocale, p: { count: number }): PushCopy {
  if (locale === 'he') {
    return {
      title: 'האימונים שלך מוכנים! 🏃',
      body: p.count === 1
        ? 'אימון חדש מחכה לך — לחצו לצפייה'
        : `${p.count} אימונים חדשים מחכים לך — לחצו לצפייה`,
    };
  }
  return {
    title: 'Your workouts are ready! 🏃',
    body: p.count === 1
      ? 'A new workout is waiting — tap to view'
      : `${p.count} new workouts are waiting — tap to view`,
  };
}

export function shoeLimitCopy(
  locale: NotificationLocale,
  p: { name: string; km: number; limit: number; reached: boolean },
): PushCopy {
  if (locale === 'he') {
    return p.reached
      ? {
          title: `הנעליים "${p.name}" הגיעו למגבלת הק״מ 👟`,
          body: `${p.km} ק״מ מתוך ${p.limit} — כדאי לשקול זוג חדש`,
        }
      : {
          title: `הנעליים "${p.name}" מתקרבות למגבלה 👟`,
          body: `${p.km} ק״מ מתוך ${p.limit} ק״מ`,
        };
  }
  return p.reached
    ? {
        title: `Your "${p.name}" have hit their km limit 👟`,
        body: `${p.km} of ${p.limit} km — time to think about a new pair`,
      }
    : {
        title: `Your "${p.name}" are nearing their limit 👟`,
        body: `${p.km} of ${p.limit} km`,
      };
}

// ── Training-day reminders (cron/tick) ────────────────────────────────────

export function trainingDayBeforeCopy(locale: NotificationLocale, p: { day: number }): PushCopy {
  const d = dayName(locale, p.day);
  return locale === 'he'
    ? { title: `תזכורת אימון ליום ${d} 🏃`, body: `מחר, יום ${d}, אימון קבוצתי — נתראה!` }
    : { title: `${d} session reminder 🏃`, body: `Tomorrow, ${d}, group session — see you there!` };
}

export function trainingEveningBeforeCopy(
  locale: NotificationLocale,
  p: { day: number; goingCount: number },
): PushCopy {
  const d = dayName(locale, p.day);
  if (locale === 'he') {
    const rsvpPhrase = p.goingCount === 1 ? 'חבר אחד כבר אישר הגעה' : `${p.goingCount} חברים כבר אישרו הגעה`;
    return {
      title: 'מגיעים מחר לאימון? 🏟️',
      body: p.goingCount > 0
        ? `${rsvpPhrase} לאימון יום ${d} — ומה איתך?`
        : `עדכנו אותנו אם אתם מגיעים לאימון יום ${d}`,
    };
  }
  const rsvpPhrase = p.goingCount === 1 ? '1 teammate has already confirmed' : `${p.goingCount} teammates have already confirmed`;
  return {
    title: 'Coming to training tomorrow? 🏟️',
    body: p.goingCount > 0
      ? `${rsvpPhrase} for the ${d} session — how about you?`
      : `Let us know if you're coming to the ${d} session`,
  };
}

/** The ✅/❌ RSVP action buttons on a training reminder. */
export const RSVP_ACTION_LABELS: Record<NotificationLocale, { yes: string; no: string }> = {
  he: { yes: '✅ מגיע/ה', no: '❌ לא הפעם' },
  en: { yes: "✅ I'm in", no: '❌ Not this time' },
};

export function newWeekProgramCopy(
  locale: NotificationLocale,
  p: { dateLabel: string; parts: string[] },
): PushCopy {
  return locale === 'he'
    ? {
        title: `שבוע חדש מתחיל (${p.dateLabel}) 📅`,
        body: `העלו את התוכניות לשבוע ${p.dateLabel}: ${p.parts.join(' · ')}`,
      }
    : {
        title: `A new week starts (${p.dateLabel}) 📅`,
        body: `Upload the plans for the week of ${p.dateLabel}: ${p.parts.join(' · ')}`,
      };
}

export function weeklyRecapCopy(
  locale: NotificationLocale,
  p: { km: number; runs: number; pace: string | null },
): PushCopy {
  if (locale === 'he') {
    const runsLabel = p.runs === 1 ? 'ריצה' : 'ריצות';
    return {
      title: 'הסיכום השבועי שלך 🏅',
      body: p.pace
        ? `השבוע רצת ${p.km} ק״מ ב-${p.runs} ${runsLabel}, בקצב ממוצע של ${p.pace} לק״מ. כל הכבוד!`
        : `השבוע רצת ${p.km} ק״מ ב-${p.runs} ${runsLabel}. כל הכבוד!`,
    };
  }
  const runsLabel = p.runs === 1 ? 'run' : 'runs';
  return {
    title: 'Your weekly recap 🏅',
    body: p.pace
      ? `This week you ran ${p.km} km over ${p.runs} ${runsLabel}, averaging ${p.pace} per km. Nice work!`
      : `This week you ran ${p.km} km over ${p.runs} ${runsLabel}. Nice work!`,
  };
}

// ── Events ────────────────────────────────────────────────────────────────

export function newEventCopy(
  locale: NotificationLocale,
  p: { kind: string; name: string; date: string },
): PushCopy {
  return locale === 'he'
    ? {
        title: `${eventKindLabel('he', p.kind)} חדש!`,
        body: `${p.name} · ${shortDate('he', p.date)}`,
      }
    : {
        title: `New ${eventKindLabel('en', p.kind)}!`,
        body: `${p.name} · ${shortDate('en', p.date)}`,
      };
}

export function eventTomorrowCopy(
  locale: NotificationLocale,
  p: { name: string; timeLabel: string; location: string | null },
): PushCopy {
  const where = p.location ? ` · ${p.location}` : '';
  return locale === 'he'
    ? {
        title: `מחר: ${p.name} 🗓️`,
        body: `נרשמת ל${p.name}${p.timeLabel}${where}. בהצלחה!`,
      }
    : {
        title: `Tomorrow: ${p.name} 🗓️`,
        body: `You're signed up for ${p.name}${p.timeLabel}${where}. Good luck!`,
      };
}

export function eventClosingCopy(locale: NotificationLocale, p: { name: string }): PushCopy {
  return locale === 'he'
    ? {
        title: `ההרשמה נסגרת מחר: ${p.name} ⏰`,
        body: `אם מתכננים להשתתף ב${p.name}, זו ההזדמנות האחרונה להירשם.`,
      }
    : {
        title: `Registration closes tomorrow: ${p.name} ⏰`,
        body: `If you're planning to join ${p.name}, this is the last chance to sign up.`,
      };
}

// ── Club & coach ──────────────────────────────────────────────────────────

export function approvalCopy(locale: NotificationLocale, p: { name: string | null | undefined }): PushCopy {
  const who = (p.name || '').trim();
  return locale === 'he'
    ? {
        title: `${who}, אושרת! 🎉`,
        body: 'ההרשמה שלך אושרה — היכנס/י כדי לראות את תוכנית האימונים שלך',
      }
    : {
        title: `${who}, you're approved! 🎉`,
        body: 'Your registration went through — sign in to see your training plan',
      };
}

/**
 * Badge names live in the DB in both languages (badges.name_he / name_en), so
 * this takes both and picks — the one case where the copy isn't fully owned by
 * this module.
 */
export function badgeEarnedCopy(
  locale: NotificationLocale,
  p: { nameHe: string; nameEn: string },
): PushCopy {
  return locale === 'he'
    ? { title: `🏅 באדג' חדש: ${p.nameHe}`, body: 'לחצו לצפייה בהישג שלכם' }
    : { title: `🏅 New badge: ${p.nameEn || p.nameHe}`, body: 'Tap to see your achievement' };
}

/** Only the frame is translated — the reply itself is whatever the coach typed. */
export function coachReplyCopy(
  locale: NotificationLocale,
  p: { coachName: string | null | undefined },
): { title: string } {
  const name = (p.coachName || '').trim();
  return locale === 'he'
    ? { title: name ? `💬 תשובה מ${name}` : '💬 תשובה מהמאמן' }
    : { title: name ? `💬 Reply from ${name}` : '💬 Reply from your coach' };
}

/** Sponsor name and deal title are admin-authored; only the header translates. */
export function newPerkCopy(
  locale: NotificationLocale,
  p: { sponsor: string; title: string },
): PushCopy {
  return locale === 'he'
    ? { title: '🎁 שותפות חדשה!', body: `${p.sponsor}: ${p.title}` }
    : { title: '🎁 New partnership!', body: `${p.sponsor}: ${p.title}` };
}

// ── Staff-facing ──────────────────────────────────────────────────────────
// These reach coaches and admins rather than athletes, but a coach picks a
// notification language from the same settings row, so they follow it too.

export function feedbackAlertCopy(
  locale: NotificationLocale,
  p: { athleteName: string; reason: string },
): PushCopy {
  return locale === 'he'
    ? { title: '⚠️ משוב אימון', body: `${p.athleteName}: ${p.reason}` }
    : { title: '⚠️ Session feedback', body: `${p.athleteName}: ${p.reason}` };
}

export function storeOrderCopy(
  locale: NotificationLocale,
  p: { athleteName: string | null | undefined; itemCount: number; total: number },
): PushCopy {
  const name = (p.athleteName || '').trim();
  return locale === 'he'
    ? {
        title: '🛒 הזמנה חדשה בחנות',
        body: `${name || 'ספורטאי/ת'}: ${p.itemCount} פריטים · ${p.total} ₪`,
      }
    : {
        title: '🛒 New store order',
        body: `${name || 'An athlete'}: ${p.itemCount} item${p.itemCount === 1 ? '' : 's'} · ₪${p.total}`,
      };
}

// ── Surveys ───────────────────────────────────────────────────────────────
// A survey's question is written by whoever created it (a coach, or a
// recurring_survey_templates row) and is already stored in both languages, so
// the question itself goes through pickBilingual rather than being translated
// here. Only the surrounding prompt and the non-responder nudge are ours.

/**
 * Picks the reader's language out of a pair of DB columns (`*_he` / `*_en`),
 * falling back to whichever one is actually filled in. Admins routinely leave
 * the English column empty, and an empty push is worse than one in the wrong
 * language — so this never returns ''. Fixes the long-standing `body_he ||
 * body_en` in the notification routes, which always won for Hebrew even when
 * an English translation existed.
 */
export function pickBilingual(
  locale: NotificationLocale,
  p: { he: string | null | undefined; en: string | null | undefined },
): string {
  const he = (p.he || '').trim();
  const en = (p.en || '').trim();
  return locale === 'en' ? en || he : he || en;
}

/** The "there's a survey waiting" line under a coach-authored question. */
export const SURVEY_PROMPT_BODY: Record<NotificationLocale, string> = {
  he: 'לחצו לענות על הסקר',
  en: 'Tap to answer the survey',
};

export function surveyNudgeCopy(locale: NotificationLocale, p: { day: number }): PushCopy {
  return locale === 'he'
    ? {
        title: 'עוד לא ענית על הדבוקות? 🏃',
        body: `בחרו דבוקה לאימון יום ${dayName('he', p.day)} לפני שהזמן נגמר`,
      }
    : {
        title: "Haven't picked your pace group? 🏃",
        body: `Choose a pace group for ${dayName('en', p.day)}'s session before time runs out`,
      };
}
