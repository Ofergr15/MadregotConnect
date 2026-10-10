import { APP_URL, APPROVER_EMAILS } from '@/lib/constants';
import { joinLinkV2 } from '@/lib/install/flag';
import { openInAppHref } from '@/lib/open-in-app';
import { renderEmail, renderSetupProgress, renderJourney, renderSteps, renderScanOnPhone, renderTip, renderNextUp, esc, type SetupProgressRow } from './template';
import { gapNames } from '@/lib/notifications/copy';
import { sendEmail, type SendResult } from './send';
import { renderAcademyFormReceived } from './academy-form-received';
import { newApplicantSubject, renderAcademyNewApplicant } from './academy-new-applicant';

/**
 * Every email this app sends, one function each.
 *
 * The import path is unchanged (`@/lib/email`) so no caller moved, but the contract
 * did, and it is the point of the whole exercise:
 *
 *   **Every function returns a `SendResult`. None of them throws, and none of them
 *   returns `void`.**
 *
 * They used to return `undefined` and swallow both "no API key" and Resend's
 * `{ error }` refusals, which is how an approval came to report a delivered link to
 * somebody who never got one. A caller can now only be wrong on purpose.
 *
 * Layout, colours and escaping live in ./template. Sending, logging and the honest
 * result live in ./send. This file is only *what each mail says* — which is where it
 * should be possible to make a change without thinking about infrastructure.
 */

export { isEmailConfigured, diagnoseEmail, readEmailConfig, SANDBOX_FROM_ADDRESS } from './config';
export type { EmailConfig, EmailHealth, EmailHealthLevel } from './config';
export { sendEmail } from './send';
export type { SendResult, SendStatus, OutboundEmail } from './send';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'madregot.club@gmail.com';

// ── Legacy Google/Garmin onboarding ──────────────────────────────────────────────

export async function notifyAdminNewUser(user: {
  name: string;
  email: string;
  onboardingStatus: string;
  hasGarmin?: boolean;
}): Promise<SendResult> {
  const authStatusMap: Record<string, string> = {
    garmin_authed: '✅ Google + Garmin connected',
    google_authed: '⚠️ Google only (skipped Garmin)',
  };
  const authStatus =
    authStatusMap[user.onboardingStatus] || (user.hasGarmin ? '✅ Google + Garmin' : '⚠️ Google only');

  return sendEmail({
    template: 'admin_new_user',
    to: ADMIN_EMAIL,
    subject: `🏃 New user waiting for approval: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New user registration',
      rows: [['Name', user.name], ['Email', user.email], ['Auth', authStatus], ['Status', user.onboardingStatus]],
      cta: { label: 'Review & approve →', href: openInAppHref(APP_URL, '/dashboard/settings') },
    }),
  });
}

export async function notifyUserApproved(user: { name: string; email: string }): Promise<SendResult> {
  // Hebrew like every other member mail; it used to be the one English mail in the
  // journey. Its readers are mostly Strava members (the address they left on the
  // waiting screen), so the way back in is "sign in with Strava again".
  const first = (user.name || '').trim().split(/\s+/)[0] || '';
  return sendEmail({
    template: 'user_approved',
    to: user.email,
    subject: '✅ אושרת! ברוכים הבאים למדרגות',
    html: renderEmail({
      eyebrow: 'מועדון הריצה של מדרגות',
      title: first ? `${first}, אושרת 🎉` : 'אושרת 🎉',
      preheader: 'נכנסים לאפליקציה ומתחילים לרוץ איתנו.',
      paragraphs: ['המאמן אישר את ההצטרפות שלך. פותחים את מדרגות ונכנסים כמו בפעם הקודמת (עם Strava אם נכנסת דרכו).'],
      cta: { label: 'לפתיחת מדרגות ←', href: `${APP_URL}/feed` },
      notes: ['משהו לא עובד? פשוט תשיבו למייל הזה, ונעזור.'],
    }),
    replyTo: ADMIN_EMAIL,
  });
}

export async function notifyAdminUserApproved(
  admin: { email: string },
  user: { name: string; email: string },
): Promise<SendResult> {
  return sendEmail({
    template: 'admin_user_approved',
    to: admin.email,
    subject: `✅ User approved: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'User approved',
      paragraphs: [`${user.name} (${user.email}) has been approved and notified.`],
    }),
  });
}

// ── Public /register form (migration 083, signup_requests) ───────────────────────
//
// Two mails, one each side of the approval:
//   notifyAdminNewSignupRequest  → the approvers, "someone registered"
//   notifyRegistrationApproved   → the applicant, WITH the link to finish
//
// The second is the whole point of the feature, and it is why this is not
// notifyUserApproved: that one links to /dashboard, which a person who has only ever
// given an email address cannot use. They have no name and no watch connected, so
// what they need is /join/{token} — the flow that asks for both.

export async function notifyAdminNewSignupRequest(req: {
  email: string;
  /**
   * The best name the system knows, already resolved by signupAlertName() — null
   * when it knows none. A Strava sign-in USUALLY gives a display name and always
   * gives a SYNTHETIC address (strava_1234@strava.madregot.local), so for that
   * person the name is the only identifying thing in the mail, which is why it
   * leads the subject line: "New registration waiting: strava_1234@…" identifies
   * nobody.
   */
  name?: string | null;
  groupName?: string | null;
}): Promise<SendResult> {
  // The synthetic address must never stand in for the person, in either place it
  // used to: the subject line fell back to it, and the Email row printed it as if
  // an approver could reply to it. It is not an address — nothing delivers there
  // and nobody has ever seen it. Say plainly that there isn't one instead.
  const address = req.email.toLowerCase().trim().endsWith('.local') ? null : req.email;
  const who = (req.name || '').trim() || address || 'a new Strava sign-in';
  return sendEmail({
    template: 'admin_new_signup_request',
    // The approver list, not just ADMIN_EMAIL: whoever is nearest their phone should
    // be able to let a new runner in.
    to: APPROVER_EMAILS,
    subject: `🏃 New registration waiting: ${who}`,
    html: renderEmail({
      dir: 'ltr',
      eyebrow: 'WAITING FOR APPROVAL',
      title: 'New registration',
      preheader: `${who} is waiting to be let into the club.`,
      rows: [
        ...(req.name ? ([['Name', req.name]] as Array<[string, string]>) : []),
        ['Email', address || 'none — they signed in with Strava'],
        ['Group', req.groupName || '—'],
      ],
      // The entry queue, which is now the only place anybody is let in. This used
      // to open the הרשמות list while every in-app path opened the entry queue, so
      // tapping the mail showed the approver a different screen than browsing did.
      cta: { label: 'Review & approve →', href: openInAppHref(APP_URL, '/dashboard/entry-queue?at=mine') },
      notes: ['They cannot enter the app until someone approves this.'],
    }),
  });
}

/**
 * The 48-hour reminder for an approved applicant who has not come in (onboarding
 * v2, lib/onboarding/join-reminder): back to their own link, which opens the
 * install guide, with the same QR and Safari tip as the approval mail.
 */
export async function notifyJoinReminder(user: { email: string; token: string; groupName?: string | null; athleteId?: string | null }): Promise<SendResult> {
  const link = joinLinkV2(APP_URL, user.token, true);
  return sendEmail({
    template: 'join_reminder',
    to: user.email,
    subject: 'האפליקציה של מדרגות עוד מחכה לך 👟',
    replyTo: ADMIN_EMAIL,
    athleteId: user.athleteId ?? null,
    html: renderEmail({
      eyebrow: 'תזכורת קטנה',
      title: 'עוד צעד אחד, ואתם בפנים',
      preheader: 'ההתקנה לוקחת דקה, ואנחנו כאן אם משהו לא עובד.',
      paragraphs: [`ראינו שעוד לא נכנסתם${user.groupName ? ` (${user.groupName})` : ''}. זה לוקח דקה, והמסך יראה בדיוק איך.`],
      bodyHtml: renderJourney(2),
      cta: { label: 'להתקנת האפליקציה ←', href: link },
      afterCtaHtml: renderScanOnPhone(`${APP_URL}/api/public/qr?t=${encodeURIComponent(user.token)}`)
        + renderTip('💡 באייפון ההתקנה עובדת רק דרך <b>Safari</b>.'),
      notes: ['משהו לא עובד? פשוט תשיבו למייל הזה עם מספר טלפון, ונעזור.'],
    }),
  });
}

/**
 * "Continue on the phone" (the /join screen on a computer, ContinueOnPhone): the
 * same personal link, to open on the phone, where the install guide takes over.
 */
export async function notifyPhoneLink(user: { email: string; token: string; name?: string | null; athleteId?: string | null }): Promise<SendResult> {
  const link = joinLinkV2(APP_URL, user.token, true);
  const first = (user.name || '').split(/\s+/)[0] || '';
  return sendEmail({
    template: 'phone_link',
    to: user.email,
    subject: 'הקישור למדרגות, לפתיחה בטלפון 📱',
    replyTo: ADMIN_EMAIL,
    athleteId: user.athleteId ?? null,
    html: renderEmail({
      eyebrow: first ? `${first}, זה הקישור שביקשת` : 'הקישור שביקשת',
      title: 'פותחים את המייל הזה בטלפון',
      preheader: 'לחיצה אחת בטלפון, והוא ידריך אותך בהתקנה.',
      paragraphs: ['בטלפון מגיעות ההתראות מהמאמן, התזכורות לפני אימון, והריצות נכנסות לבד מהשעון.'],
      cta: { label: 'לפתיחה בטלפון ←', href: link },
      afterCtaHtml: renderTip('💡 באייפון ההתקנה עובדת רק דרך <b>Safari</b>.'),
      notes: ['משהו לא עובד? פשוט תשיבו למייל הזה, ונעזור.'],
    }),
  });
}

/**
 * The sign-in code (lib/auth/email-code). The code is the subject's first word, so
 * iOS offers it from the mail notification straight into the code field, and it
 * is big in the body for anyone typing it.
 */
export async function notifyLoginCode(user: { email: string; code: string; name?: string | null; athleteId?: string | null }): Promise<SendResult> {
  const spaced = `${user.code.slice(0, 3)} ${user.code.slice(3)}`;
  return sendEmail({
    template: 'login_code',
    to: user.email,
    subject: `${user.code} הוא קוד הכניסה שלך למדרגות`,
    athleteId: user.athleteId ?? null,
    html: renderEmail({
      eyebrow: 'כניסה לאפליקציה',
      title: 'קוד הכניסה שלך',
      preheader: `${user.code} · בתוקף ל-10 דקות`,
      bodyHtml: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 40px; font-weight: 800; letter-spacing: 0.18em; color: #1D1E26; text-align: center; background-color: #F5F6FA; border-radius: 16px; padding: 18px 0; margin: 4px 0 14px;" dir="ltr">${esc(spaced)}</div>`,
      paragraphs: ['מקלידים את הקוד באפליקציה. הוא בתוקף ל-10 דקות.'],
      notes: ['לא ביקשת קוד? אפשר להתעלם מהמייל, אף אחד לא נכנס בלעדיו.'],
    }),
  });
}

/**
 * The applicant's "we got it" mail (onboarding v2): sent the moment the public form
 * lands, so the first thing a new member hears from the club is that it arrived,
 * where they are in the journey, and that the next step is ours. No button: there
 * is nothing for them to do yet, and a button would invent something.
 */
export async function notifyRegistrationReceived(user: { email: string; name?: string | null }): Promise<SendResult> {
  const first = (user.name || '').split(/\s+/)[0] || '';
  return sendEmail({
    template: 'registration_received',
    to: user.email,
    subject: `קיבלנו את הבקשה שלך${first ? `, ${first}` : ''} 🏃`,
    replyTo: ADMIN_EMAIL,
    html: renderEmail({
      eyebrow: 'מועדון הריצה של מדרגות',
      title: `קיבלנו${first ? `, ${first}` : ''}. המדרגה הראשונה מאחורייך`,
      preheader: 'הבקשה שלך אצלנו. בדרך כלל מאשרים תוך יום.',
      paragraphs: ['הבקשה שלך הגיעה אלינו. ככה זה ממשיך מכאן:'],
      bodyHtml: renderJourney(1) + renderNextUp('הבא בתור', 'אישור מהמנהלים', 'בדרך כלל תוך יום. נשלח לך מייל עם קישור אישי להתקנת האפליקציה.'),
      notes: ['אין צורך לעשות שום דבר נוסף בינתיים.', 'שאלות? פשוט תשיבו למייל הזה.'],
    }),
  });
}

/**
 * The approval mail — Hebrew, because the recipient is a club member and the app is
 * Hebrew-first. This is the ONE email here that somebody reads before they have an
 * account, so it carries the link and nothing else to do.
 *
 * ⚠️ If this one fails, a person is approved, waiting, and has no idea. That is why
 * its result is read by both callers and surfaced on the registrations screen, and why
 * the queue also shows the link so it can be sent by hand.
 */
export async function notifyRegistrationApproved(user: {
  email: string;
  token: string;
  groupName?: string | null;
  athleteId?: string | null;
  signupRequestId?: string | null;
  /** Onboarding v2 (lib/install/flag): the journey, the three install steps, a QR for a computer. */
  v2?: boolean;
}): Promise<SendResult> {
  if (user.v2) {
    const link = joinLinkV2(APP_URL, user.token, true);
    return sendEmail({
      template: 'registration_approved',
      to: user.email,
      subject: '✅ אושרת! ככה מתקינים את האפליקציה של מדרגות',
      // "Stuck? Just reply" has to reach a person.
      replyTo: ADMIN_EMAIL,
      athleteId: user.athleteId ?? null,
      signupRequestId: user.signupRequestId ?? null,
      html: renderEmail({
        eyebrow: 'ההרשמה אושרה',
        title: 'ברוכים הבאים למדרגות! 🎉',
        preheader: 'נשארה דקה אחת: להתקין את האפליקציה ולהיכנס.',
        paragraphs: [
          `ההרשמה שלך אושרה${user.groupName ? `, ${user.groupName}` : ''}. נשארה דקה אחת: להתקין את האפליקציה ולהיכנס.`,
        ],
        bodyHtml: renderJourney(2) + renderSteps([
          { title: 'פותחים את הכפתור בטלפון', sub: 'לא במחשב' },
          { title: 'מוסיפים למסך הבית', sub: 'המסך יראה לך בדיוק איך' },
          { title: 'פותחים מהאייקון ונכנסים', sub: 'קוד קצר במייל' },
        ]),
        cta: { label: 'להתקנת האפליקציה ←', href: link },
        afterCtaHtml: renderScanOnPhone(`${APP_URL}/api/public/qr?t=${encodeURIComponent(user.token)}`)
          + renderTip('💡 באייפון ההתקנה עובדת רק דרך <b>Safari</b>. אם המייל נפתח בתוך Gmail, המסך הראשון יסביר איך לעבור.'),
        notes: ['הקישור אישי, אל תעבירו אותו לאף אחד.', 'נתקעתם? פשוט תשיבו למייל הזה.'],
      }),
    });
  }
  return sendEmail({
    template: 'registration_approved',
    to: user.email,
    subject: '✅ ההרשמה שלך למדרגות אושרה',
    athleteId: user.athleteId ?? null,
    signupRequestId: user.signupRequestId ?? null,
    html: renderEmail({
      eyebrow: 'ההרשמה אושרה',
      title: 'אושרת! 🎉',
      preheader: 'נשאר להשלים כמה פרטים ולחבר את Strava — דקה וזה נגמר.',
      paragraphs: [
        `ההרשמה שלך למדרגות אושרה${user.groupName ? ` — ${user.groupName}` : ''}. נשאר רק להשלים כמה פרטים ולהתחבר עם Strava, וזה הכל.`,
        'מי שהשעון שלו כבר מחובר אצלנו — נזהה את זה ונדלג על השלב.',
      ],
      cta: { label: 'להשלמת ההרשמה →', href: `${APP_URL}/join/${user.token}` },
      notes: ['הקישור אישי — אל תעבירו אותו לאף אחד.'],
    }),
  });
}

/**
 * "מישהו התחבר עם Strava ואומר שזה אתה" — the claim link (migration 098).
 *
 * The only mail in this file whose click MERGES two accounts, so it is written to
 * be read carefully rather than tapped reflexively: it names the account being
 * claimed, says what happens, and says what to do if it wasn't them. The recipient
 * is the one person who can tell, because it goes only to the address their own
 * roster row is keyed on — which is exactly what makes it proof.
 *
 * ⚠️ Never include the shell's Strava name in the SUBJECT. If this arrives at the
 * wrong mailbox (a mistyped address that happens to belong to another member), the
 * subject line is the part that leaks, and "someone called X is trying to reach
 * your account" is a name we were not asked to hand out.
 */
export async function notifyAthleteClaim(claim: {
  email: string;
  token: string;
  /** The Strava display name doing the asking — shown in the body, not the subject. */
  stravaName?: string | null;
  /** The name on the account being claimed, so the reader knows which one this is. */
  targetName?: string | null;
  athleteId?: string | null;
}): Promise<SendResult> {
  const who = (claim.stravaName || '').trim();
  return sendEmail({
    template: 'athlete_claim',
    to: claim.email,
    subject: '🔗 חיבור חשבון Strava למדרגות',
    athleteId: claim.athleteId ?? null,
    html: renderEmail({
      eyebrow: 'אישור חיבור חשבון',
      title: 'זה אתה?',
      // No name here either, for the same reason it stays out of the subject: the
      // preview line is shown on a locked screen.
      preheader: 'התחברות דרך Strava מבקשת להתחבר לחשבון שלך. אם זה לא אתה — אין מה לעשות.',
      paragraphs: [
        `התחברות חדשה דרך Strava${who ? ` בשם ${who}` : ''} מבקשת להתחבר לחשבון שלך במדרגות${
          claim.targetName ? ` (${claim.targetName})` : ''
        }.`,
        'אם זה אתה — הקישור למטה יחבר את השניים לחשבון אחד: כל האימונים, הדבוקה וההיסטוריה שלך יישארו איתך, ותוכל להיכנס דרך Strava מעכשיו.',
        'אם זה לא אתה — אין שום צורך לעשות דבר. בלי הקישור הזה שום דבר לא קורה, והוא נכבה מעצמו אחרי חצי שעה.',
      ],
      cta: { label: 'כן, זה אני — לחיבור →', href: `${APP_URL}/claim/${claim.token}` },
      notes: ['הקישור חד-פעמי, אישי, ותקף לחצי שעה. אל תעבירו אותו לאף אחד.'],
    }),
  });
}

// ── The entry nudge, by email ────────────────────────────────────────────────────

/**
 * "You were let in and never finished" — the same reminder as the push in
 * lib/notifications/copy.ts, for the members who have no subscription to push to.
 *
 * ⚠️ THIS MAIL EXISTS BECAUSE THE PUSH-ONLY VERSION REACHED THE WRONG HALF.
 * The nudge route was push-only on the stated grounds that "half the club signed
 * in through Strava and has no real address". Measured on 2026-09-13 that premise
 * was false: of the 23 active members, 9 had no push subscription and **all 9 had
 * a real address**, none had neither. So the one reminder the app has for somebody
 * who never arrived was undeliverable to exactly the people it was written for —
 * the worst case being a member 73 days past approval who had logged in once and
 * never seen the app open.
 *
 * That is also who it is for, in Ofer's words: the academy runners and the people
 * we sent an invitation to. Both gave us an address; a Strava-only sign-in never
 * did, and `realEmail()` at the call site is what keeps this off those rows.
 *
 * The CTA for somebody who never got in points at `/login`, NOT `/dashboard`, and
 * says to open it in the browser. This is the one channel that routes around the
 * iOS in-app-browser trap (migration 082): a link tapped in Gmail opens Safari,
 * whose storage the app can actually see, whereas the same person tapping "sign in
 * with Strava" inside another app's browser sheet logs in somewhere the app cannot
 * read. For that member the email is not a fallback — it is the only thing that
 * works.
 */
export async function notifyEntryNudge(user: {
  email: string;
  name?: string | null;
  /**
   * Open setup-task keys, or `['login']` for somebody who never landed in the app.
   * Resolved from the athlete row by the caller, never from a request body — this
   * mail names things about a person.
   */
  gaps: string[];
  athleteId?: string | null;
  /**
   * The whole scored checklist, when the caller has it — and the entry-queue route
   * does, because it computes computeSetupState() to derive `gaps` in the first place.
   * With it this mail shows the same marked list as the snapshot instead of naming
   * the missing items in a sentence; without it (or for somebody who never got in,
   * where there is nothing to score yet) it falls back to the sentence.
   */
  setup?: { doneCount: number; total: number; rows: SetupProgressRow[] };
}): Promise<SendResult> {
  const who = (user.name || '').trim();
  const hey = who ? `${who}, ` : '';
  const neverGotIn = user.gaps.includes('login');
  // Hebrew only, like every other member-facing mail here: the club reads Hebrew and
  // the notification-language setting is a push setting, not an inbox one.
  const missing = gapNames('he', user.gaps);

  return sendEmail({
    template: 'entry_nudge',
    to: user.email,
    athleteId: user.athleteId ?? null,
    subject: neverGotIn ? '👋 האפליקציה של מדרגות מחכה לך' : '⏳ נשאר לסדר כמה דברים באפליקציה',
    html: renderEmail({
      eyebrow: neverGotIn ? 'החשבון שלך מחכה' : 'כמעט שם',
      title: neverGotIn ? `${hey}האפליקציה מחכה לך 👋` : `${hey}כמעט סיימת`,
      preheader: neverGotIn
        ? 'החשבון מאושר, אבל האפליקציה עוד לא נפתחה אצלך. הקישור כאן פותר את זה.'
        : `נשאר ${missing.length > 1 ? 'כמה דברים קטנים' : 'דבר קטן אחד'} בפרופיל.`,
      paragraphs: neverGotIn
        ? [
            'החשבון שלך במדרגות מאושר וממתין — אבל עוד לא נכנסת לאפליקציה.',
            'הסיבה הנפוצה: התחברות מתוך אפליקציה אחרת (אינסטגרם, ווטסאפ) נפתחת בדפדפן פנימי שהאפליקציה לא רואה, ואז ההתחברות מצליחה והאפליקציה נשארת סגורה. הקישור למטה נפתח בדפדפן הרגיל של הטלפון, וזה פותר את זה.',
          ]
        : [
            `נכנסת לאפליקציה, ונשאר עוד ${missing.length > 1 ? 'כמה דברים קטנים' : 'דבר קטן אחד'} כדי שהיא תעבוד בשבילך במלואה.`,
            // The list itself is drawn below when the caller passed the state. Only
            // when it didn't does it have to be said in a sentence.
            ...(user.setup
              ? []
              : [missing.length ? `חסר: ${missing.join(', ')}.` : 'נשאר להשלים את ההגדרה בפרופיל.']),
            'דקה בפרופיל וסיימנו.',
          ],
      bodyHtml: !neverGotIn && user.setup ? renderSetupProgress(user.setup) : undefined,
      cta: neverGotIn
        ? { label: 'להתחברות לאפליקציה →', href: `${APP_URL}/login` }
        : { label: 'להשלמת הפרופיל →', href: `${APP_URL}/dashboard/profile` },
      notes: neverGotIn
        ? ['אם זה לא נפתח — פתחו את הקישור ישירות ב-Safari או ב-Chrome.']
        : ['אם כבר סידרתם את זה — אין צורך לעשות כלום.'],
    }),
  });
}

// ── The 15-minute setup snapshot ─────────────────────────────────────────────────

/**
 * "A quarter of an hour in — here is what's set and what isn't."
 *
 * The same snapshot as the push in lib/notifications/copy.ts, for the members with
 * no subscription to push to. One channel each, decided by snapshotChannel(), and
 * neither is sent to somebody who finished.
 *
 * Every row is MARKED — a green tick or a red cross — because that is the whole
 * request this mail answers: not "you have things left" but "these two are done,
 * these three are not, and here is why each one matters". The marks are text
 * glyphs on coloured discs rather than images: an inline `<img>` in a mail is a
 * tracking pixel to most clients and gets stripped, which would leave a checklist
 * with no checks in it.
 */
export async function notifySetupSnapshot(user: {
  email: string;
  name?: string | null;
  athleteId?: string | null;
  doneCount: number;
  total: number;
  /** Already ordered (done first) and already localised — see snapshotRowCopy. */
  rows: Array<{ name: string; hint: string; done: boolean }>;
}): Promise<SendResult> {
  const who = (user.name || '').trim();
  const hey = who ? `${who}, ` : '';
  const left = user.total - user.doneCount;

  return sendEmail({
    template: 'setup_snapshot',
    to: user.email,
    athleteId: user.athleteId ?? null,
    subject: `⏳ ${user.doneCount} מתוך ${user.total} — מה נשאר לך באפליקציה`,
    html: renderEmail({
      eyebrow: 'רבע שעה בפנים',
      title: `${hey}ככה זה נראה אצלך עכשיו`,
      preheader: `${user.doneCount} מתוך ${user.total} מסודרים${left ? `, נשאר ${left}` : ''} — הכל מסומן כאן בפנים.`,
      paragraphs: [
        'נכנסת לאפליקציה לפני רבע שעה — הנה מה שכבר מסודר ומה שלא, כדי שלא תישאר עם חצי אפליקציה.',
      ],
      bodyHtml: renderSetupProgress(user),
      cta: { label: 'להשלמת מה שנשאר →', href: `${APP_URL}/dashboard/profile` },
      notes: ['נשלח פעם אחת בלבד, ורק אם משהו חסר. אם כבר סידרתם הכל — לא יישלח כלום.'],
    }),
  });
}

// ── Academy ──────────────────────────────────────────────────────────────────────

export async function notifyAdminNewAcademyRegistration(user: {
  name: string;
  email: string;
  phone?: string;
  /** The form's academy_intake answers: age, city, focus, pack, background. */
  intake?: Record<string, unknown> | null;
  /** The funnel card, so the button opens it rather than the whole board. */
  candidateId?: string | null;
  /** The address already belongs to a roster row, which the form left untouched. */
  existingMember?: boolean;
  /** The roster name of the member this probably is, by name (a Strava signup). */
  likelyMember?: string | null;
}): Promise<SendResult> {
  // The academy board, not the approvals list: an academy applicant is let in
  // from the academy after the calls, never by the generic approve button.
  const path = `/dashboard/academy?tab=funnel${user.candidateId ? `&candidate=${encodeURIComponent(user.candidateId)}` : ''}`;
  return sendEmail({
    template: 'admin_new_academy_registration',
    to: ADMIN_EMAIL,
    fromName: ACADEMY_SENDER,
    subject: newApplicantSubject(user),
    html: renderAcademyNewApplicant({ ...user, href: openInAppHref(APP_URL, path) }),
  });
}

/**
 * The three mails an applicant gets on the way into the academy, in order:
 *
 *   academyInviteEmail        staff → a funnel candidate: "here is your form"
 *   academyFormReceivedEmail  the applicant, right after the form: "we got it"
 *   academyAcceptedEmail      staff → the chosen trainee: "you're in", to /join/{token}
 *
 * Each is a pure builder plus a sender, because the funnel shows the staff member
 * the mail BEFORE it goes: the preview is the builder's own html, so what they
 * approve is what arrives, not a picture of it.
 *
 * The applicant has no app yet. Every link here opens in a plain mobile browser,
 * and none of them needs a login.
 */
export interface BuiltEmail { subject: string; html: string }

/** The display name the applicant's first mail arrives under; the address stays the club's. */
export const ACADEMY_SENDER = 'האקדמיה של מדרגות';

const firstName = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';

export function academyInviteEmail(p: { name?: string | null; url: string; note?: string | null; senderName?: string | null }): BuiltEmail {
  const who = firstName(p.name);
  const note = (p.note || '').trim();
  return {
    subject: '🎓 האקדמיה של מדרגות — הטופס שלך מחכה',
    html: renderEmail({
      eyebrow: 'האקדמיה של מדרגות',
      title: who ? `${who}, שמחים שפנית אלינו` : 'שמחים שפנית אלינו',
      preheader: 'טופס קצר, כמה דקות, והפרטים שלך כבר מולאו.',
      paragraphs: [
        ...(note ? [`${p.senderName ? `${p.senderName}: ` : ''}${note}`] : []),
        'כדי שנכיר אותך ונבנה לך תוכנית שמתאימה בדיוק לך, נשמח שתמלא/י טופס קצר. השם, המייל והטלפון כבר ממולאים — נשאר רק לספר לנו עליך.',
        'זה לוקח כמה דקות, ועובד ישר מהטלפון. לא צריך להוריד שום אפליקציה.',
      ],
      cta: { label: 'למילוי הטופס →', href: p.url },
      notes: ['הקישור אישי ובתוקף ל-30 יום.'],
    }),
  };
}

export async function notifyAcademyInvite(p: {
  email: string; name?: string | null; url: string; note?: string | null; senderName?: string | null; candidateId: string;
}): Promise<SendResult> {
  const built = academyInviteEmail(p);
  return sendEmail({ template: 'academy_invite', to: p.email, candidateId: p.candidateId, ...built });
}

export function academyFormReceivedEmail(p: { name?: string | null }): BuiltEmail {
  const who = firstName(p.name);
  return {
    subject: `היי${who ? ` ${who}` : ''}, קיבלנו את טופס ההרשמה שלך לאקדמיה של מדרגות 🏃`,
    html: renderAcademyFormReceived({ firstName: who }),
  };
}

export async function notifyAcademyFormReceived(p: { email: string; name?: string | null; candidateId?: string | null; athleteId?: string | null }): Promise<SendResult> {
  const built = academyFormReceivedEmail(p);
  return sendEmail({
    template: 'academy_form_received', to: p.email, fromName: ACADEMY_SENDER,
    candidateId: p.candidateId ?? null, athleteId: p.athleteId ?? null, ...built,
  });
}

/** `token` null = somebody who already has an account (a club member joining the
 *  academy): there is nothing to set up, so the button opens the app instead. */
export function academyAcceptedEmail(p: { name?: string | null; token: string | null; coachName?: string | null; coachCount?: number }): BuiltEmail {
  const who = firstName(p.name);
  const coach = (p.coachName || '').trim();
  // Several coaches (migration 135): `coachName` is already "Dana ו־Guy".
  const coachLine = (p.coachCount ?? 1) > 1 ? `המאמנים שלך: ${coach}` : `המאמן/ת שלך: ${coach}`;
  return {
    subject: '🎉 התקבלת לאקדמיה של מדרגות',
    html: renderEmail({
      eyebrow: 'האקדמיה של מדרגות',
      title: who ? `${who}, התקבלת! 🎉` : 'התקבלת! 🎉',
      preheader: 'שלב אחרון: להתחבר עם Strava — דקה וזה נגמר.',
      paragraphs: [
        coach
          ? `ברוך/ה הבא/ה לאקדמיה. ${coachLine}. מכאן התוכנית, האימונים והמשוב יגיעו אליך ישירות.`
          : 'ברוך/ה הבא/ה לאקדמיה. מכאן התוכנית, האימונים והמשוב יגיעו אליך ישירות.',
        ...(p.token
          ? [
            'שלב אחרון: להיכנס עם Strava, כדי שהאימונים שלך יגיעו למאמן. יש שעון Garmin? אפשר לחבר גם אותו — או לדלג ולחבר אחר כך.',
            'הכל עובד מהדפדפן בטלפון. אפשר גם להוסיף את מדרגות למסך הבית, אבל זה לא חובה.',
          ]
          : ['החשבון שלך במדרגות כבר קיים — האקדמיה פשוט נוספה אליו. אין שום דבר להגדיר.']),
      ],
      cta: p.token
        ? { label: 'להתחלה →', href: `${APP_URL}/join/${p.token}` }
        : { label: 'לאפליקציה →', href: `${APP_URL}/dashboard` },
      notes: p.token ? ['הקישור אישי — אל תעבירו אותו לאף אחד.'] : [],
    }),
  };
}

export async function notifyAcademyAccepted(p: {
  email: string; name?: string | null; token: string | null; coachName?: string | null; coachCount?: number; athleteId?: string | null; candidateId?: string | null;
}): Promise<SendResult> {
  const built = academyAcceptedEmail(p);
  return sendEmail({
    template: 'academy_accepted', to: p.email,
    athleteId: p.athleteId ?? null, candidateId: p.candidateId ?? null, ...built,
  });
}

/**
 * Approval of a pending academy registration from the approvals list. Used to be an
 * English "connect Garmin" mail to /join/academy/{token}; it is now the same
 * "you're in" as the funnel's accept, so a trainee gets one story whichever button
 * let them in — and Strava first, since that is how everyone signs in.
 */
export async function notifyAcademyApproved(user: {
  name: string;
  email: string;
  token: string;
  athleteId?: string | null;
}): Promise<SendResult> {
  const built = academyAcceptedEmail({ name: user.name, token: user.token });
  return sendEmail({ template: 'academy_approved', to: user.email, athleteId: user.athleteId ?? null, ...built });
}

// ── Academy weekly report ────────────────────────────────────────────────────────

export interface AcademyReportRow {
  name: string;
  completedCount: number;
  plannedCount: number;
  completionRate: number; // 0..1
  avgScore: number; // 0..1
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function rateColor(rate: number): string {
  if (rate >= 0.8) return '#16a34a';
  if (rate >= 0.5) return '#FF5315';
  return '#D74E4E';
}

export async function sendAcademyWeeklyReport(params: {
  weekStart: string;
  weekEnd: string;
  rows: AcademyReportRow[];
  to?: string;
}): Promise<SendResult> {
  const { weekStart, weekEnd, rows } = params;
  if (rows.length === 0) {
    return { ok: false, status: 'skipped', code: 'no-rows', reason: 'No athletes to report on', logId: null };
  }

  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const totalPlanned = rows.reduce((a, r) => a + r.plannedCount, 0);
  const totalDone = rows.reduce((a, r) => a + r.completedCount, 0);
  const overall = totalPlanned ? totalDone / totalPlanned : 0;

  // Worst first: the point of the digest is who needs a phone call.
  const tableRows = rows
    .slice()
    .sort((a, b) => a.completionRate - b.completionRate)
    .map(r => `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; font-weight: 600; color: #1D1E26;">${esc(r.name)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #2D2E38;">${r.completedCount}/${r.plannedCount}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; font-weight: 700; color: ${rateColor(r.completionRate)};">${pct(r.completionRate)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #656565;">${pct(r.avgScore)}</td>
      </tr>`)
    .join('');

  return sendEmail({
    template: 'academy_weekly_report',
    to: params.to || ADMIN_EMAIL,
    subject: `🎓 Academy weekly report — ${fmt(weekStart)}–${fmt(weekEnd)}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'Academy weekly report',
      paragraphs: [`${fmt(weekStart)} – ${fmt(weekEnd)}`],
      bodyHtml: `
        <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <span style="font-size: 28px; font-weight: 800; color: ${rateColor(overall)};">${pct(overall)}</span>
          <span style="color: #2D2E38;"> overall sessions completed (${totalDone}/${totalPlanned}) across ${rows.length} athlete${rows.length !== 1 ? 's' : ''}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="text-align: left; color: #94a3b8; font-size: 12px;">
              <th style="padding: 8px;">Athlete</th>
              <th style="padding: 8px; text-align: center;">Done</th>
              <th style="padding: 8px; text-align: center;">Completion</th>
              <th style="padding: 8px; text-align: center;">On-plan</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`,
      cta: { label: 'Open Academy →', href: openInAppHref(APP_URL, '/dashboard/academy') },
      notes: ['"On-plan" = average share of distance/time/pace targets hit on completed sessions.'],
    }),
  });
}
