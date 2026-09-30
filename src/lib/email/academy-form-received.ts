import { APP_URL } from '@/lib/constants';
import { esc } from './template';

/**
 * "קיבלנו" — the first mail an academy applicant gets, right after the form.
 *
 * Its own layout rather than the shared shell (template.ts), because it is the
 * applicant's first look at the club and Ofer picked a design for it: the full club
 * badge large on a "sunset on the track" gradient, a short thank-you, and the road
 * ahead as four equal steps in one centred row. Deliberately no fitness test among
 * the steps — a test in the first mail reads as pressure.
 *
 * Same mail-client rules as the shell: nested tables, bgcolor attributes, inline
 * styles. The gradient is `background-image` over a solid `bgcolor`, so Outlook
 * (no gradients) shows the dark end instead of nothing. The step marks are text on
 * coloured cells, never images; the badge is the only picture, and with images off
 * the header still carries the greeting as live text.
 */

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
export const LOGO = `${APP_URL}/images/logo-white.png`;
/** The club's stairs mark, white on clear: stands in for the 🏃 of the subject line
 *  at the end of the header sentence, where an emoji would be the only non-club art. */
const STAIRS = `${APP_URL}/images/stairs-white.png`;

// Palette "ג · שקיעה על המסלול" from the approved mockup.
export const PAGE = '#FBF1EC';
export const DUSK = '#23208F';
export const SUN = '#F0643C';
export const EYEBROW = '#FFD9C9';
export const HEADER_SUB = '#FFE7DC';
export const TAG = '#C2461F';
export const TAG_BG = '#FFEDE5';
export const MUTED = '#A59C95';
export const MUTED_LINE = '#EDE3DC';
export const BODY = '#3A3B45';
export const SOFT = '#5B5F73';
export const INK = '#1D1E26';

type StepState = 'done' | 'next' | 'later';
const STEPS: Array<{ mark: string; label: string; state: StepState }> = [
  { mark: '✓', label: 'הטופס', state: 'done' },
  { mark: '2', label: 'שיחת היכרות', state: 'next' },
  { mark: '3', label: 'שיחה עם מאמן', state: 'later' },
  { mark: '4', label: 'מתחילים', state: 'later' },
];

/** Half of the line between two circles; `null` past the row's ends. */
function segment(color: string | null): string {
  if (!color) return '<td>&nbsp;</td>';
  return `<td valign="middle"><div style="height: 2px; background: ${color}; font-size: 0; line-height: 0;">&nbsp;</div></td>`;
}

/** The four steps in one row, right to left. Fixed layout so the gaps are equal
 *  whatever the label lengths — the row has to be symmetric. */
function tracker(): string {
  const cells = STEPS.map((s, i) => {
    const look =
      s.state === 'done' ? { fill: SUN, text: '#ffffff', ring: SUN, label: SUN, weight: 700 }
      : s.state === 'next' ? { fill: '#ffffff', text: DUSK, ring: DUSK, label: DUSK, weight: 700 }
      : { fill: '#ffffff', text: MUTED, ring: MUTED_LINE, label: MUTED, weight: 600 };
    const before = i === 0 ? null : STEPS[i - 1].state === 'done' ? SUN : MUTED_LINE;
    const after = i === STEPS.length - 1 ? null : s.state === 'done' ? SUN : MUTED_LINE;
    return `<td width="25%" align="center" valign="top" style="width: 25%;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout: fixed; width: 100%;">
        <colgroup><col><col style="width: 36px;"><col></colgroup>
        <tr>${segment(before)}
          <td width="36" height="36" align="center" style="width: 36px; min-width: 36px; height: 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="32" height="32" align="center" bgcolor="${look.fill}" style="width: 32px; min-width: 32px; height: 32px; box-sizing: border-box; border: 2px solid ${look.ring}; border-radius: 50%; background: ${look.fill}; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; color: ${look.text};">${s.mark}</td>
            </tr></table>
          </td>${segment(after)}
        </tr>
      </table>
      <div style="font-family: ${FONT}; font-size: 12px; font-weight: ${look.weight}; color: ${look.label}; margin-top: 8px; line-height: 1.35;">${s.label}</div>
    </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="table-layout: fixed; width: 100%;"><tr>${cells}</tr></table>`;
}

export function renderAcademyFormReceived(p: { firstName: string }): string {
  const who = p.firstName.trim();
  const title = who ? `היי ${esc(who)},` : 'היי,';
  const preheader = 'בימים הקרובים נחזור אליך לשיחת היכרות קצרה.';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PAGE};">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color: ${PAGE};">
<tr><td align="center" style="padding: 22px 12px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px;">

  <!-- the badge on the sunset: Outlook shows the dusk colour alone -->
  <tr><td bgcolor="${DUSK}" align="center" style="background-color: ${DUSK}; background-image: linear-gradient(160deg, ${DUSK} 0%, ${SUN} 100%); border-radius: 26px 26px 0 0; padding: 32px 20px 30px;">
    <img src="${LOGO}" width="132" height="132" alt="Madregot After 2KM Running Club" style="display: block; width: 132px; height: 132px; border: 0; margin: 0 auto;" />
    <div style="font-family: ${FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: ${EYEBROW}; margin-top: 14px;">האקדמיה של מדרגות</div>
    <div style="font-family: ${FONT}; font-size: 30px; font-weight: 800; color: #ffffff; line-height: 1.25; margin-top: 6px;">${title}</div>
    <div style="font-family: ${FONT}; font-size: 16px; line-height: 1.55; color: ${HEADER_SUB}; margin-top: 6px;">קיבלנו את טופס ההרשמה שלך<br />לאקדמיה של מדרגות <img src="${STAIRS}" width="20" height="20" alt="" style="display: inline-block; width: 20px; height: 20px; border: 0; vertical-align: -3px;" /></div>
  </td></tr>

  <tr><td bgcolor="#ffffff" dir="rtl" align="center" style="background-color: #ffffff; border-radius: 0 0 26px 26px; padding: 28px 22px 30px; text-align: center; font-family: ${FONT};">
    <p style="font-size: 16px; line-height: 1.8; color: ${BODY}; margin: 0 0 26px;">תודה שסיפרת לנו על עצמך.<br />ככה זה ממשיך מכאן:</p>
    ${tracker()}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 26px 0 0;"><tr>
      <td bgcolor="${TAG_BG}" align="center" style="background-color: ${TAG_BG}; border-radius: 18px; padding: 18px 18px 20px; text-align: center;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: ${TAG};">הבא בתור</div>
        <div style="font-size: 19px; font-weight: 800; color: ${INK}; margin-top: 6px;">שיחת היכרות קצרה</div>
        <div style="font-size: 14px; line-height: 1.65; color: ${SOFT}; margin-top: 4px;">נתקשר אליך בימים הקרובים, להכיר<br />ולשמוע מה המטרה שלך.</div>
      </td>
    </tr></table>
    <p style="font-size: 15px; line-height: 1.8; color: ${SOFT}; margin: 24px 0 0;">אין צורך לעשות שום דבר נוסף בינתיים.</p>
    <p style="font-size: 16px; line-height: 1.7; color: ${BODY}; margin: 14px 0 0;">מחכים להכיר,<br /><b style="color: ${DUSK}; font-size: 17px;">צוות האקדמיה של מדרגות</b></p>
  </td></tr>

  <tr><td align="center" style="padding: 20px 10px 0; font-family: ${FONT};">
    <a href="${esc(APP_URL)}" dir="ltr" style="font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: ${MUTED}; text-decoration: none;">MADREGOT · AFTER 2KM · RUNNING CLUB</a>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
