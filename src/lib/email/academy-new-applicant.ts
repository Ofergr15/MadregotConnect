import { esc } from './template';
import { BODY, DUSK, EYEBROW, FONT, HEADER_SUB, INK, LOGO, MUTED, MUTED_LINE, PAGE, SOFT, SUN, TAG, TAG_BG } from './academy-form-received';

/**
 * "מועמד חדש לאקדמיה" — the staff mail when somebody sends the academy form.
 *
 * Same "sunset on the track" look as the applicant's own mail, so the two read as
 * one academy. Its job is the intro call: who this is at a glance, the phone as a
 * dial and a WhatsApp button, what they are after (the online-vs-meetups answer and
 * the pack they picked), their running background in their own words, and one
 * button that opens their card on the funnel board.
 *
 * Deliberately NOT here (Ofer, 2026-09-30): the birth date (the age is enough),
 * medical history, height and weight, kit sizes. All of it is on the card.
 */

export interface NewApplicant {
  name: string;
  email: string;
  phone?: string | null;
  /** The form's academy_intake blob, read loosely: older forms lack fields. */
  intake?: Record<string, unknown> | null;
  existingMember?: boolean;
  /** Where the button goes — the in-app link to this applicant's card. */
  href: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Whole years on `today`, or null for a missing or unreadable date. */
export function ageFrom(birthDate: unknown, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(birthDate));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  return age >= 5 && age <= 100 ? age : null;
}

/** The two answers to "מה מדבר אליך יותר", short enough for a subject line. */
export function focusShort(focus: unknown): string {
  const f = str(focus);
  if (!f) return '';
  if (f.startsWith('רק')) return 'רק און ליין';
  if (f.includes('מפגשים')) return 'און ליין + מפגשים';
  return f;
}

/** An Israeli mobile as typed in the form → the wa.me number, or null. */
export function whatsappNumber(phone: unknown): string | null {
  let digits = str(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.length >= 11 && digits.length <= 13 ? digits : null;
}

export function newApplicantSubject(p: Pick<NewApplicant, 'name' | 'intake'>): string {
  const age = ageFrom(p.intake?.birthDate);
  const parts = [p.name, age ? String(age) : '', focusShort(p.intake?.focus)].filter(Boolean);
  return `🎓 מועמד חדש: ${parts.join(' · ')}`;
}

function fact(label: string, value: string, first: boolean, ltr = false): string {
  const line = first ? '' : `border-top: 1px solid ${MUTED_LINE}; `;
  return `<tr>
    <td style="padding: 10px 14px; ${line}font-size: 14px; color: ${MUTED}; white-space: nowrap;">${label}</td>
    <td align="left" style="padding: 10px 14px; ${line}font-size: 14px; font-weight: 700; color: ${INK}; text-align: left;"${ltr ? ' dir="ltr"' : ''}>${value}</td>
  </tr>`;
}

export function renderAcademyNewApplicant(p: NewApplicant): string {
  const intake = p.intake || {};
  const age = ageFrom(intake.birthDate);
  const city = str(intake.city);
  const focus = str(intake.focus);
  const group = str(intake.group);
  const history = str(intake.runningHistory);
  const heard = str(intake.hearAbout) === 'אחר' ? str(intake.hearAboutOther) || 'אחר' : str(intake.hearAbout);
  const phone = str(p.phone);
  const wa = whatsappNumber(phone);
  const firstName = str(intake.firstName) || p.name.split(' ')[0];

  const sub = [age ? `גיל ${age}` : '', esc(city)].filter(Boolean).join(' · ');

  const button = (href: string, label: string, bg: string, color: string) =>
    `<td align="center" bgcolor="${bg}" style="background-color: ${bg}; border-radius: 14px;"><a href="${esc(href)}" style="display: block; padding: 12px 6px; font-family: ${FONT}; font-size: 14px; font-weight: 800; color: ${color}; text-decoration: none;">${label}</a></td>`;
  const quick = phone
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px;"><tr>
        ${button(`tel:${phone.replace(/[^\d+]/g, '')}`, `📞 <span dir="ltr">${esc(phone)}</span>`, '#EEEDFB', DUSK)}
        ${wa ? `<td width="8" style="width: 8px;">&nbsp;</td>${button(`https://wa.me/${wa}`, 'וואטסאפ', '#E6F6EC', '#12753A')}` : ''}
      </tr></table>`
    : '';

  const want = focus || group
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${TAG_BG}" align="center" style="background-color: ${TAG_BG}; border-radius: 18px; padding: 15px 16px 16px; text-align: center; font-family: ${FONT};">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: ${TAG};">מה מעניין אותו</div>
          ${focus ? `<div style="font-size: 17px; font-weight: 800; color: ${INK}; line-height: 1.4; margin-top: 5px;">${esc(focus)}</div>` : ''}
          ${group ? `<div style="font-size: 14px; line-height: 1.5; color: ${SOFT}; margin-top: 5px;">רוצה ל${esc(group)}</div>` : ''}
        </td>
      </tr></table>`
    : '';

  const existing = p.existingMember
    ? `<div style="margin: 14px 0 0; background: #FFF4E5; border-radius: 12px; padding: 10px 13px; font-size: 13.5px; line-height: 1.55; font-weight: 600; color: #8A4B00;">👤 המייל הזה כבר שייך לרץ במועדון, והחשבון שלו לא שונה. אפשר לקשר מהכרטיס.</div>`
    : '';

  const rows: Array<[string, string, boolean?]> = [];
  if (age) rows.push(['גיל', String(age)]);
  if (city) rows.push(['עיר', esc(city)]);
  if (heard) rows.push(['הגיע דרך', esc(heard)]);
  rows.push(['מייל', esc(p.email), true]);
  const facts = rows.map(([k, v, ltr], i) => fact(k, v, i === 0, ltr)).join('');

  const background = history
    ? `<div style="margin: 16px 0 0; font-family: ${FONT};">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: ${MUTED}; margin-bottom: 4px;">הרקע שלו בריצה</div>
        <div style="border-right: 3px solid ${SUN}; padding: 0 10px 0 0; font-size: 14.5px; line-height: 1.7; color: ${BODY}; white-space: pre-line;">${esc(history)}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>מועמד חדש לאקדמיה</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color: ${PAGE};">
<tr><td align="center" style="padding: 22px 12px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px;">

  <tr><td bgcolor="${DUSK}" align="center" style="background-color: ${DUSK}; background-image: linear-gradient(160deg, ${DUSK} 0%, ${SUN} 100%); border-radius: 26px 26px 0 0; padding: 26px 20px 24px;">
    <img src="${LOGO}" width="88" height="88" alt="Madregot After 2KM Running Club" style="display: block; width: 88px; height: 88px; border: 0; margin: 0 auto;" />
    <div style="font-family: ${FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: ${EYEBROW}; margin-top: 12px;">מועמד חדש לאקדמיה</div>
    <div style="font-family: ${FONT}; font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.25; margin-top: 4px;">${esc(p.name)}</div>
    ${sub ? `<div style="font-family: ${FONT}; font-size: 14px; color: ${HEADER_SUB}; margin-top: 5px;">${sub}</div>` : ''}
  </td></tr>

  <tr><td bgcolor="#ffffff" dir="rtl" style="background-color: #ffffff; border-radius: 0 0 26px 26px; padding: 22px 18px 24px; font-family: ${FONT};">
    ${quick}
    ${want}
    ${existing}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0 0; border: 1px solid ${MUTED_LINE}; border-radius: 16px; border-collapse: separate; font-family: ${FONT};">
      ${facts}
    </table>
    ${background}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0 0;"><tr>
      <td align="center" bgcolor="${DUSK}" style="background-color: ${DUSK}; border-radius: 99px;">
        <a href="${esc(p.href)}" style="display: block; padding: 14px 10px; font-family: ${FONT}; font-size: 15.5px; font-weight: 800; color: #ffffff; text-decoration: none;">לכרטיס של ${esc(firstName)} באקדמיה ←</a>
      </td>
    </tr></table>
    <div style="text-align: center; font-size: 12px; color: ${MUTED}; margin-top: 8px;">נפתח באפליקציה, על הכרטיס שלו בלוח המועמדים</div>
  </td></tr>

  <tr><td align="center" style="padding: 18px 10px 0; font-family: ${FONT}; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: ${MUTED};" dir="ltr">MADREGOT · AFTER 2KM · RUNNING CLUB</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
