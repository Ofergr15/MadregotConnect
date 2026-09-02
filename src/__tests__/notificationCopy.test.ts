import { describe, it, expect } from 'vitest';
import {
  followCopy, kudosCopy, feedInteractionCopy, mentionCopy, feedPostCopy,
  postWorkoutPromptCopy, workoutDetectedCopy, activitySyncedCopy, planPushedCopy,
  shoeLimitCopy, trainingDayBeforeCopy, trainingEveningBeforeCopy, RSVP_ACTION_LABELS,
  newWeekProgramCopy, weeklyRecapCopy, newEventCopy, eventTomorrowCopy, eventClosingCopy,
  approvalCopy, badgeEarnedCopy, coachReplyCopy, newPerkCopy, feedbackAlertCopy,
  storeOrderCopy, surveyNudgeCopy, pickBilingual, runTypeLabel, dayName, eventKindLabel,
} from '@/lib/notifications/copy';
import { NOTIFICATION_LOCALES } from '@/lib/notifications/locale';
import { EVENT_KIND_LABELS } from '@/lib/events';

/**
 * Every notification used to hardcode Hebrew at its call site; ~20 senders now
 * read their wording from lib/notifications/copy.ts so it can follow each
 * athlete's `notification_prefs.language`.
 *
 * The Hebrew assertions here are transcribed from the PRE-refactor call sites
 * (git HEAD before the sweep), not from the new module — that's the point. This
 * change is meant to be purely additive for Hebrew readers, so every Hebrew
 * string must still come out byte-identical, gendered slash forms (התחיל/ה),
 * geresh spellings (ק״מ) and emoji included. If one of these fails, copy that
 * was already reviewed live has silently changed.
 */

describe('Hebrew output is byte-identical to the pre-refactor call sites', () => {
  it('follow (api/athletes/follow)', () => {
    expect(followCopy('he', { name: 'דנה' })).toEqual({
      title: 'דנה התחיל/ה לעקוב אחריך 👋',
      body: 'היכנסו לפרופיל שלכם כדי לראות',
    });
  });

  it('kudos (api/activities/[id]/kudos)', () => {
    expect(kudosCopy('he', { name: 'דנה' })).toEqual({
      title: 'דנה נתן/ה לך קודוס על הריצה! 👍',
      body: 'לחצו לצפייה',
    });
  });

  it('feed like and comment (lib/feed/notify)', () => {
    expect(feedInteractionCopy('he', { name: 'דנה', kind: 'like' }).title)
      .toBe('דנה אהב את הפוסט שלך ❤️');
    expect(feedInteractionCopy('he', { name: 'דנה', kind: 'comment' }).title)
      .toBe('דנה הגיב לך 💬');
  });

  it('mention (lib/feed/notify)', () => {
    expect(mentionCopy('he', { name: 'דנה', kind: 'comment' }).title)
      .toBe('דנה תייג/ה אותך בתגובה 🏷️');
    expect(mentionCopy('he', { name: 'דנה', kind: 'post' }).title)
      .toBe('דנה תייג/ה אותך בפוסט 🏷️');
  });

  it('new feed post (api/feed/posts)', () => {
    expect(feedPostCopy('he', { name: 'דנה', preview: 'ריצת בוקר' })).toEqual({
      title: 'דנה פרסם/ה בפיד 📸',
      body: 'ריצת בוקר',
    });
    expect(feedPostCopy('he', { name: 'דנה' }).body).toBe('לחצו לצפייה');
    // The old call site's own fallback was `auth.user.name || 'מישהו'`.
    expect(feedPostCopy('he', { name: null }).title).toBe('מישהו פרסם/ה בפיד 📸');
  });

  it('post-workout prompt (lib/post-workout)', () => {
    expect(postWorkoutPromptCopy('he', { activityType: 'running', km: 12.4 })).toEqual({
      title: 'כל הכבוד על האימון! 🏃',
      body: 'ריצה של 12.4 ק״מ — איך היה? ספרו לנו במשוב קצר',
    });
    expect(postWorkoutPromptCopy('he', { activityType: 'running', km: null }).body)
      .toBe('איך היה? ספרו לנו במשוב קצר');
  });

  it('workout detected (api/cron/workout-watch)', () => {
    expect(workoutDetectedCopy('he', { activityType: 'trail_running', timeStr: '06:45' })).toEqual({
      title: '🏃 זוהה אימון: ריצת שטח',
      body: 'מנתחים את הנתונים מ-06:45 — נשתף עוד מידע בקרוב',
    });
    expect(workoutDetectedCopy('he', { activityType: 'running', timeStr: '' }).body)
      .toBe('מנתחים את הנתונים — נשתף עוד מידע בקרוב');
  });

  it('activity synced (api/garmin/sync-activities)', () => {
    expect(activitySyncedCopy('he')).toEqual({
      title: 'האימון שלך סונכרן! 🏃',
      body: 'התאמה אישית של הפוסט לפני שהוא יוצא לפיד',
    });
  });

  it('plan pushed (api/garmin/push-workouts) — singular and plural', () => {
    expect(planPushedCopy('he', { count: 1 })).toEqual({
      title: 'האימונים שלך מוכנים! 🏃',
      body: 'אימון חדש מחכה לך — לחצו לצפייה',
    });
    expect(planPushedCopy('he', { count: 4 }).body)
      .toBe('4 אימונים חדשים מחכים לך — לחצו לצפייה');
  });

  it('shoe limit (lib/shoes) — reached and nearing', () => {
    expect(shoeLimitCopy('he', { name: 'Vaporfly', km: 812, limit: 800, reached: true })).toEqual({
      title: 'הנעליים "Vaporfly" הגיעו למגבלת הק״מ 👟',
      body: '812 ק״מ מתוך 800 — כדאי לשקול זוג חדש',
    });
    expect(shoeLimitCopy('he', { name: 'Vaporfly', km: 760, limit: 800, reached: false })).toEqual({
      title: 'הנעליים "Vaporfly" מתקרבות למגבלה 👟',
      body: '760 ק״מ מתוך 800 ק״מ',
    });
  });

  it('training day-before reminder (api/cron/tick stage 1)', () => {
    // teamDay 2 = Tuesday
    expect(trainingDayBeforeCopy('he', { day: 2 })).toEqual({
      title: 'תזכורת אימון ליום שלישי 🏃',
      body: 'מחר, יום שלישי, אימון קבוצתי — נתראה!',
    });
  });

  it('evening-before nudge (api/cron/tick stage 2) — 0, 1 and many confirmed', () => {
    expect(trainingEveningBeforeCopy('he', { day: 5, goingCount: 0 })).toEqual({
      title: 'מגיעים מחר לאימון? 🏟️',
      body: 'עדכנו אותנו אם אתם מגיעים לאימון יום שישי',
    });
    expect(trainingEveningBeforeCopy('he', { day: 5, goingCount: 1 }).body)
      .toBe('חבר אחד כבר אישר הגעה לאימון יום שישי — ומה איתך?');
    expect(trainingEveningBeforeCopy('he', { day: 5, goingCount: 7 }).body)
      .toBe('7 חברים כבר אישרו הגעה לאימון יום שישי — ומה איתך?');
  });

  it('RSVP action buttons (api/cron/tick)', () => {
    expect(RSVP_ACTION_LABELS.he).toEqual({ yes: '✅ מגיע/ה', no: '❌ לא הפעם' });
  });

  it('new-week program reminder (api/cron/tick)', () => {
    expect(newWeekProgramCopy('he', { dateLabel: '7.9', parts: ['נועה', 'תמר'] })).toEqual({
      title: 'שבוע חדש מתחיל (7.9) 📅',
      body: 'העלו את התוכניות לשבוע 7.9: נועה · תמר',
    });
  });

  it('weekly recap (api/cron/tick) — with and without a pace', () => {
    expect(weeklyRecapCopy('he', { km: 42.5, runs: 4, pace: '5:12' })).toEqual({
      title: 'הסיכום השבועי שלך 🏅',
      body: 'השבוע רצת 42.5 ק״מ ב-4 ריצות, בקצב ממוצע של 5:12 לק״מ. כל הכבוד!',
    });
    expect(weeklyRecapCopy('he', { km: 8, runs: 1, pace: null }).body)
      .toBe('השבוע רצת 8 ק״מ ב-1 ריצה. כל הכבוד!');
  });

  it('new event (api/events)', () => {
    expect(newEventCopy('he', { kind: 'race', name: 'מרתון תל אביב', date: '2026-10-14' })).toEqual({
      title: '🏆 מרוץ חדש!',
      // Same he-IL day/short-month format the call site used inline.
      body: `מרתון תל אביב · ${new Date('2026-10-14').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}`,
    });
  });

  it('event tomorrow (api/cron/tick) — with and without a location', () => {
    expect(eventTomorrowCopy('he', { name: 'מרוץ הלילה', timeLabel: ' · 20:00', location: 'פארק הירקון' })).toEqual({
      title: 'מחר: מרוץ הלילה 🗓️',
      body: 'נרשמת למרוץ הלילה · 20:00 · פארק הירקון. בהצלחה!',
    });
    expect(eventTomorrowCopy('he', { name: 'מרוץ הלילה', timeLabel: '', location: null }).body)
      .toBe('נרשמת למרוץ הלילה. בהצלחה!');
  });

  it('registration closing (api/cron/tick)', () => {
    expect(eventClosingCopy('he', { name: 'מרוץ הלילה' })).toEqual({
      title: 'ההרשמה נסגרת מחר: מרוץ הלילה ⏰',
      body: 'אם מתכננים להשתתף במרוץ הלילה, זו ההזדמנות האחרונה להירשם.',
    });
  });

  it('approval (api/admin/approve)', () => {
    expect(approvalCopy('he', { name: 'דנה' })).toEqual({
      title: 'דנה, אושרת! 🎉',
      body: 'ההרשמה שלך אושרה — היכנס/י כדי לראות את תוכנית האימונים שלך',
    });
  });

  it('badge earned (lib/badges/award-engine)', () => {
    expect(badgeEarnedCopy('he', { nameHe: '100 ק״מ', nameEn: '100 km' })).toEqual({
      title: "🏅 באדג' חדש: 100 ק״מ",
      body: 'לחצו לצפייה בהישג שלכם',
    });
  });

  it('coach reply (api/workout-feedback/reply + .../[id]/messages)', () => {
    expect(coachReplyCopy('he', { coachName: 'יוסי' }).title).toBe('💬 תשובה מיוסי');
    expect(coachReplyCopy('he', { coachName: '' }).title).toBe('💬 תשובה מהמאמן');
  });

  it('new perk (api/admin/perks)', () => {
    expect(newPerkCopy('he', { sponsor: 'Nike', title: '20% הנחה' })).toEqual({
      title: '🎁 הטבה חדשה!',
      body: 'Nike: 20% הנחה',
    });
  });

  it('feedback alert to staff (api/workout-feedback)', () => {
    expect(feedbackAlertCopy('he', { athleteName: 'דנה', reason: 'כאב בשוק' })).toEqual({
      title: '⚠️ משוב אימון',
      body: 'דנה: כאב בשוק',
    });
  });

  it('store order alert to staff (api/store/orders)', () => {
    expect(storeOrderCopy('he', { athleteName: 'דנה', itemCount: 3, total: 240 })).toEqual({
      title: '🛒 הזמנה חדשה בחנות',
      body: 'דנה: 3 פריטים · 240 ₪',
    });
    expect(storeOrderCopy('he', { athleteName: null, itemCount: 1, total: 90 }).body)
      .toBe('ספורטאי/ת: 1 פריטים · 90 ₪');
  });

  it('pace-group survey nudge (api/cron/tick stage 4)', () => {
    expect(surveyNudgeCopy('he', { day: 2 })).toEqual({
      title: 'עוד לא ענית על הדבוקות? 🏃',
      body: 'בחרו דבוקה לאימון יום שלישי לפני שהזמן נגמר',
    });
  });
});

describe('English output', () => {
  it('never leaks a Hebrew fallback name', () => {
    // The bug this guards: `p.name || 'מישהו'` was inlined at several call
    // sites, so an English reader would have seen a Hebrew "someone".
    for (const build of [followCopy, kudosCopy]) {
      expect(build('en', { name: null }).title).toContain('Someone');
      expect(build('en', { name: '   ' }).title).toContain('Someone');
    }
    expect(feedPostCopy('en', { name: null }).title).toContain('Someone');
    expect(feedInteractionCopy('en', { name: undefined, kind: 'like' }).title).toContain('Someone');
    expect(mentionCopy('en', { name: '', kind: 'post' }).title).toContain('Someone');
  });

  it('renders each locale with no empty title or body', () => {
    // A blank push is worse than one in the wrong language — no builder may
    // produce '' for either field in either locale.
    for (const locale of NOTIFICATION_LOCALES) {
      const samples = [
        followCopy(locale, { name: 'Dana' }),
        kudosCopy(locale, { name: 'Dana' }),
        feedInteractionCopy(locale, { name: 'Dana', kind: 'comment' }),
        feedPostCopy(locale, { name: 'Dana' }),
        postWorkoutPromptCopy(locale, { activityType: 'running', km: 10 }),
        workoutDetectedCopy(locale, { activityType: 'running', timeStr: '07:00' }),
        activitySyncedCopy(locale),
        planPushedCopy(locale, { count: 3 }),
        shoeLimitCopy(locale, { name: 'Pegasus', km: 700, limit: 800, reached: false }),
        trainingDayBeforeCopy(locale, { day: 2 }),
        trainingEveningBeforeCopy(locale, { day: 2, goingCount: 3 }),
        newWeekProgramCopy(locale, { dateLabel: '7.9', parts: ['A'] }),
        weeklyRecapCopy(locale, { km: 20, runs: 2, pace: '5:00' }),
        newEventCopy(locale, { kind: 'camp', name: 'Camp', date: '2026-10-14' }),
        eventTomorrowCopy(locale, { name: 'Race', timeLabel: '', location: null }),
        eventClosingCopy(locale, { name: 'Race' }),
        approvalCopy(locale, { name: 'Dana' }),
        badgeEarnedCopy(locale, { nameHe: 'א', nameEn: 'A' }),
        newPerkCopy(locale, { sponsor: 'Nike', title: '20%' }),
        feedbackAlertCopy(locale, { athleteName: 'Dana', reason: 'shin pain' }),
        storeOrderCopy(locale, { athleteName: 'Dana', itemCount: 2, total: 100 }),
        surveyNudgeCopy(locale, { day: 2 }),
      ];
      for (const s of samples) {
        expect(s.title.trim()).not.toBe('');
        expect(s.body.trim()).not.toBe('');
      }
      expect(coachReplyCopy(locale, { coachName: 'Yossi' }).title.trim()).not.toBe('');
      expect(mentionCopy(locale, { name: 'Dana', kind: 'post' }).title.trim()).not.toBe('');
      expect(RSVP_ACTION_LABELS[locale].yes.trim()).not.toBe('');
      expect(RSVP_ACTION_LABELS[locale].no.trim()).not.toBe('');
    }
  });

  it('falls back to a plain run label for an unknown activity type', () => {
    expect(runTypeLabel('en', 'kayaking')).toBe('Run');
    expect(runTypeLabel('en', null)).toBe('Run');
    expect(runTypeLabel('he', 'kayaking')).toBe('ריצה');
  });

  it('names days Sunday-first in both locales', () => {
    expect(dayName('en', 0)).toBe('Sunday');
    expect(dayName('en', 6)).toBe('Saturday');
    expect(dayName('he', 0)).toBe('ראשון');
    // Out-of-range day (a corrupt teamDays config) must not print `undefined`.
    expect(dayName('en', 9)).toBe('Sunday');
  });

  it('keeps the Hebrew event-kind labels in sync with lib/events', () => {
    // copy.ts deliberately re-declares these rather than importing EventKind,
    // so this is the thing that would catch them drifting apart.
    for (const [kind, label] of Object.entries(EVENT_KIND_LABELS)) {
      expect(eventKindLabel('he', kind)).toBe(label);
    }
    expect(eventKindLabel('he', 'nonsense')).toBe(EVENT_KIND_LABELS.race);
  });
});

describe('pickBilingual', () => {
  it('prefers the reader\'s language when both columns are filled', () => {
    expect(pickBilingual('he', { he: 'שלום', en: 'Hello' })).toBe('שלום');
    expect(pickBilingual('en', { he: 'שלום', en: 'Hello' })).toBe('Hello');
  });

  it('falls back to whichever column the admin actually filled in', () => {
    // The old `body_he || body_en` meant Hebrew won even when English existed;
    // the fallback direction must still work in BOTH directions.
    expect(pickBilingual('en', { he: 'שלום', en: null })).toBe('שלום');
    expect(pickBilingual('en', { he: 'שלום', en: '   ' })).toBe('שלום');
    expect(pickBilingual('he', { he: null, en: 'Hello' })).toBe('Hello');
  });

  it('returns empty only when neither column has anything', () => {
    expect(pickBilingual('he', { he: null, en: undefined })).toBe('');
  });
});
