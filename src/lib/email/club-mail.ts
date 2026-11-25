import { APP_URL } from '@/lib/constants';
import { memberGroupName } from '@/lib/utils';
import { renderEmail, renderSteps, renderNextUp, renderTip, esc } from './template';

/**
 * b25 — the club mails that are not a reaction to one person's action: the welcome
 * after sign-up and the periodic "עדכונים" newsletter, plus the sign-up declined mail
 * the club never had. Builders only — pure, no I/O — so the admin preview screen, the
 * design previews (design/b25/emails/) and the real send all render the same bytes.
 *
 * All three go through renderEmail: one shell, so the newsletter cannot drift off the
 * look the transactional mails already share.
 */

export interface BuiltEmail { subject: string; html: string }

const first = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';

/** "תודה שנרשמת" — right after the sign-up form: what happens next, who the coach is,
 *  how to connect a watch. It promises nothing the approval has not yet granted. */
export function welcomeEmail(p: { name?: string | null; coachName?: string | null; groupName?: string | null }): BuiltEmail {
  const name = first(p.name);
  const coach = (p.coachName || '').trim() || 'המאמן של המועדון';
  const group = p.groupName ? memberGroupName(p.groupName) : null;
  return {
    subject: 'תודה שנרשמת למדרגות 🧡 ככה ממשיכים',
    html: renderEmail({
      eyebrow: 'תודה שנרשמת',
      title: name ? `${name}, איזה כיף שהצטרפת` : 'איזה כיף שהצטרפת',
      preheader: `ההרשמה התקבלה. ${coach} עובר/ת עליה, ובינתיים: שלושה דברים שכדאי לדעת.`,
      paragraphs: [
        'ההרשמה שלך התקבלה. אנחנו עוברים על כל בקשה ידנית, ובדרך כלל עונים תוך יום–יומיים.',
      ],
      rows: [
        ['המאמן', coach],
        ...(group ? [['קבוצה מבוקשת', group] as [string, string]] : []),
      ],
      bodyHtml:
        renderNextUp('מה קורה עכשיו', 'מחכים לאישור', 'ברגע שנאשר, יגיע מייל עם קישור אישי להתקנת האפליקציה.')
        + renderSteps([
          { title: 'אישור ההרשמה', sub: 'מייל עם קישור אישי' },
          { title: 'מתקינים את האפליקציה', sub: 'דקה אחת, מהטלפון' },
          { title: 'מחברים שעון', sub: 'Garmin או Strava, והאימונים נכנסים לבד' },
        ])
        + renderTip('⌚ <b>שעון Garmin?</b> אחרי ההתקנה: פרופיל ← חיבור שעון. התוכנית השבועית תופיע לך על השעון. בלי Garmin, חיבור Strava מספיק כדי שהריצות יסתנכרנו.'),
      cta: { label: 'להכיר את המועדון ←', href: APP_URL },
      notes: ['שאלה? פשוט משיבים למייל הזה, וזה מגיע לאדם אמיתי.'],
    }),
  };
}

export interface NewsletterItem { title: string; body: string; href?: string | null; linkLabel?: string | null }

export interface NewsletterInput {
  /** The mail's headline, e.g. "עדכוני נובמבר". */
  title: string;
  /** One or two lines under the headline. */
  intro?: string | null;
  items: NewsletterItem[];
  cta?: { label: string; href: string } | null;
  /** First name of the recipient, when the send personalises. */
  name?: string | null;
}

/** Only http(s) links leave in a mail. A `javascript:` href typed into the composer
 *  would be inert in most clients, but the composer is the wrong place to find out. */
export function safeHref(href?: string | null): string | null {
  const h = (href || '').trim();
  return /^https?:\/\//i.test(h) ? h : null;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

function newsletterItems(items: NewsletterItem[]): string {
  return items
    .filter(i => (i.title || '').trim() || (i.body || '').trim())
    .map((i, n) => {
      const href = safeHref(i.href);
      const link = href
        ? `<a href="${esc(href)}" style="font-family: ${FONT}; font-size: 14px; font-weight: 700; color: #23208F; text-decoration: none;">${esc(i.linkLabel || 'לפרטים')} ←</a>`
        : '';
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="rtl" bgcolor="#FBF6F3" style="border-collapse: separate; border-radius: 16px; margin: ${n ? 12 : 4}px 0 0;">
  <tr>
    <td width="6" bgcolor="#F0643C" style="width: 6px; background-color: #F0643C; border-radius: 0 16px 16px 0; font-size: 0; line-height: 0;">&nbsp;</td>
    <td style="padding: 16px 18px; text-align: right;">
      <div style="font-family: ${FONT}; font-size: 17px; font-weight: 800; color: #1D1E26; line-height: 1.4;">${esc(i.title)}</div>
      <div style="font-family: ${FONT}; font-size: 15px; color: #3A3B45; line-height: 1.75; margin-top: 6px;">${esc(i.body)}</div>
      ${link ? `<div style="margin-top: 10px;">${link}</div>` : ''}
    </td>
  </tr>
</table>`;
    })
    .join('');
}

/** The periodic "עדכונים" mail to every member. */
export function newsletterEmail(p: NewsletterInput): BuiltEmail {
  const name = first(p.name);
  const cta = p.cta && safeHref(p.cta.href) ? { label: p.cta.label, href: safeHref(p.cta.href)! } : { label: 'לאפליקציה ←', href: APP_URL };
  const lead = p.items[0]?.title;
  return {
    subject: `📣 ${p.title}`,
    html: renderEmail({
      eyebrow: 'עדכונים מהמועדון',
      title: p.title,
      preheader: [p.intro, lead].filter(Boolean).join(' · ').slice(0, 140) || 'מה חדש במדרגות',
      paragraphs: [name ? `היי ${name},` : 'היי לכולם,', ...(p.intro ? [p.intro] : [])],
      bodyHtml: newsletterItems(p.items),
      cta,
      footerNote: 'קיבלת את המייל כי את/ה חבר/ה במועדון מדרגות. לא רוצה עדכונים במייל? משיבים "הסר" ונוריד אותך מהרשימה.',
    }),
  };
}

/** Sign-up declined. Kind, short, and it gives a reason to come back. */
export function registrationDeclinedEmail(p: { name?: string | null; reason?: string | null }): BuiltEmail {
  const name = first(p.name);
  return {
    subject: 'לגבי ההרשמה שלך למדרגות',
    html: renderEmail({
      eyebrow: 'לגבי ההרשמה',
      title: name ? `${name}, תודה שפנית אלינו` : 'תודה שפנית אלינו',
      preheader: 'הפעם לא נוכל לצרף אותך, וזה לא סוף הדרך.',
      paragraphs: [
        'עברנו על ההרשמה, והפעם לא נוכל לצרף אותך למועדון.',
        ...(p.reason ? [p.reason] : ['לרוב זה עניין של מקום בקבוצות או של רמת הכושר הנדרשת כרגע.']),
        'נשמח לראות אותך שוב בעתיד. אפשר להשיב למייל הזה בכל שאלה.',
      ],
      signoff: 'בהצלחה בריצות,',
    }),
  };
}

/** Trim and bound composer input; nothing here is trusted. */
export function cleanNewsletter(raw: unknown): NewsletterInput | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = str(r.title, 120);
  if (!title) return null;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 8).map(i => {
    const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
    return { title: str(o.title, 140), body: str(o.body, 1200), href: str(o.href, 500) || null, linkLabel: str(o.linkLabel, 40) || null };
  }).filter(i => i.title || i.body);
  const cta = r.cta && typeof r.cta === 'object' ? (r.cta as Record<string, unknown>) : null;
  return {
    title,
    intro: str(r.intro, 600) || null,
    items,
    cta: cta && str(cta.href, 500) ? { label: str(cta.label, 40) || 'לאפליקציה ←', href: str(cta.href, 500) } : null,
  };
}

/** Sample data for the previews — the admin screen and design/b25/emails. */
export const SAMPLE_NEWSLETTER: NewsletterInput = {
  title: 'עדכוני נובמבר',
  intro: 'חודש עמוס: מרוץ ולנסיה מתקרב, אימון קבוצתי חדש בשבת, ותכונות חדשות באפליקציה.',
  items: [
    { title: '🇪🇸 ולנסיה — 11 יום', body: '[דוגמה] תוכנית ההתחדדות נכנסה לשעונים. פרטי התדריך באפליקציה.', href: `${APP_URL}/feed`, linkLabel: 'לתוכנית' },
    { title: '🌅 אימון שבת', body: '[דוגמה] אימון ארוך משותף — כל הקבוצות, כל הקצבים. המועד והמקום בלוח המועדון.' },
    { title: '📱 גרסה 25 באפליקציה', body: 'מסך ריצה חדש, השוואה לאימונים דומים, וסנכרון מהיר יותר מ־Garmin.' },
  ],
  cta: { label: 'לאפליקציה ←', href: APP_URL },
};
