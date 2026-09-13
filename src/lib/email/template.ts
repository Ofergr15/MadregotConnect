import { APP_URL } from '@/lib/constants';

/**
 * The one branded shell every email in this app renders into.
 *
 * Before this, each of the eight mails hand-rolled its own `<div style="font-family:
 * sans-serif; max-width: 500px">` and re-typed the hex codes, so they had drifted into
 * five slightly different looks, three of them left-aligned in a Hebrew-first app. One
 * shell means a change to the club's look is one edit, and a new mail cannot come out
 * off-brand by omission.
 *
 * ── WHY THIS IS TABLES AND NOT DIVS ────────────────────────────────────────────────
 * The first version of this shell was a single `<div>` with an `<h2>` in it, and in a
 * real inbox it read as a plain-text notice with a blue word at the bottom: no header,
 * no card, edge-to-edge text on white, nothing that said "מדרגות". Mail clients are
 * not browsers — Outlook renders on Word's engine, Gmail strips `<style>` blocks and
 * ignores `border-radius` on a `<div>`, and none of them do flexbox. So the layout
 * below is nested tables with `bgcolor` attributes and inline styles only, which is
 * the one thing every client has agreed on for twenty years.
 *
 * ── COLOURS ARE LITERAL HEX ON PURPOSE ─────────────────────────────────────────────
 * Same reason: no Tailwind in an inbox. They are still the design system's tokens, not
 * free choices — keep them in step with tailwind.config.ts:
 *   brand-600 #1525FF buttons/links · ink-900 #1D1E26 headings · ink-700 #2D2E38 body
 *   ink-500 #656565 labels · page #DFDFDF the page behind the card · band-3 #FF5315
 */
const INK_900 = '#1D1E26';
const INK_700 = '#2D2E38';
const INK_500 = '#656565';
const BRAND = '#1525FF';
const PAGE = '#DFDFDF';
const ACCENT = '#FF5315';
const HAIRLINE = '#E7E8EE';
const WELL = '#F5F6FA';

/** The club mark, white on the brand band. An absolute URL because an inbox has no
 *  origin to resolve a relative path against, and `logo-white.png` rather than a
 *  recolour trick because `filter:` does nothing in mail. Images are commonly
 *  blocked on first open, so the wordmark beside it is live text, not part of the
 *  picture — with images off the header still says מדרגות. */
const LOGO = `${APP_URL}/images/logo-white.png`;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

/** Interpolating a person's name or a group name into HTML is the whole attack
 *  surface here. Everything user-supplied goes through this. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailBlocks {
  /** Hebrew mails are `rtl`; the admin-facing English ones stay `ltr`. */
  dir?: 'rtl' | 'ltr';
  /** The <h1>. */
  title: string;
  /** The one line the inbox list shows next to the subject, before anything is
   *  opened. Left out, Gmail scrapes the first words of the body instead, which on
   *  a mail that opens with a name reads as "Dana, ככה זה" — so every mail should
   *  set it. Hidden inside the message itself. */
  preheader?: string;
  /** Small caps line above the title — which mail this is, in two or three words. */
  eyebrow?: string;
  /** Body paragraphs, in order. Plain text — escaped for you. */
  paragraphs?: string[];
  /** The label/value table three of these mails use. Values are escaped. */
  rows?: Array<[label: string, value: string | null | undefined]>;
  /** The single action. One per mail, deliberately: a mail with two buttons has no
   *  primary action, and every one of these has exactly one thing to do. */
  cta?: { label: string; href: string };
  /** Small grey lines under the button — caveats, not instructions. */
  notes?: string[];
  /** Escape hatch for a mail whose body is a real table (the academy weekly report).
   *  Raw HTML: the caller owns escaping. Prefer the fields above. */
  bodyHtml?: string;
}

export interface SetupProgressRow {
  name: string;
  hint: string;
  done: boolean;
}

/**
 * The scored checklist: a count, a bar, and one marked row per task.
 *
 * Shared by the two mails that talk about somebody's setup — the 15-minute snapshot
 * and the entry nudge — because a sentence cannot do this job. The nudge used to say
 * `חסר: חיבור שעון, מידות.` in running text, which is the same information and reads
 * as an aside: nothing shows how close they are, nothing separates done from missing,
 * and the two items look equally optional. Whenever a mail names what is missing it
 * should render THIS.
 *
 * Every mark is a text glyph on a coloured `<td>`, never an `<img>`: inline images in
 * mail are treated as tracking pixels and blocked, which would leave a checklist with
 * no checks in it.
 */
export function renderSetupProgress(state: {
  doneCount: number;
  total: number;
  rows: SetupProgressRow[];
}): string {
  const left = state.total - state.doneCount;
  // Green only when they are one step from finished; otherwise the warm colour, which
  // is the app's own "needs you" accent rather than an alarm red.
  const scoreColor = state.doneCount >= state.total - 1 ? '#16a34a' : ACCENT;
  // A floor, so a score of 0 still draws a sliver instead of an empty trough that
  // reads as a rendering failure.
  const pct = Math.max(6, Math.round((state.doneCount / Math.max(1, state.total)) * 100));

  const rows = state.rows
    .map((row, i) => {
      const mark = row.done ? { bg: '#16a34a', glyph: '&#10003;' } : { bg: '#D74E4E', glyph: '&#10007;' };
      // A done row is deliberately quieter than an open one — grey, lighter weight —
      // so the eye lands on what is left rather than on the whole list at once.
      const divider = i ? `border-top: 1px solid ${HAIRLINE};` : '';
      return `
        <tr>
          <td width="34" valign="top" style="width: 34px; padding: 14px 0 0; ${divider}">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="22" height="22" bgcolor="${mark.bg}" align="center" valign="middle" style="width: 22px; height: 22px; border-radius: 999px; color: #ffffff; font-family: ${FONT}; font-size: 12px; font-weight: 700; line-height: 22px;">${mark.glyph}</td>
            </tr></table>
          </td>
          <td valign="top" style="padding: 12px 0; ${divider}">
            <div style="font-family: ${FONT}; font-size: 15px; font-weight: ${row.done ? '600' : '700'}; color: ${row.done ? INK_500 : INK_900}; line-height: 1.4;">${esc(row.name)}</div>
            <div style="font-family: ${FONT}; font-size: 13px; color: ${INK_500}; line-height: 1.6; margin-top: 3px;">${esc(row.hint)}</div>
          </td>
        </tr>`;
    })
    .join('');

  // The bar is nested tables with a width percentage, not a div with a radius:
  // Outlook ignores the radius but honours the width, so the worst case is a square
  // bar of the right length rather than no bar at all.
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${WELL}" style="border-radius: 14px; margin: 18px 0 6px;">
      <tr><td style="padding: 16px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <!-- The number is its own cell, not a <span> in a sentence: as inline text a
               leading Latin digit inside an RTL line is reordered to the far END of it,
               and the score read "מתוך 5 מסודרים … 2". A cell cannot be reordered. -->
          <td valign="middle" style="font-family: ${FONT}; font-size: 32px; font-weight: 800; color: ${scoreColor}; line-height: 1;">${state.doneCount}</td>
          <td valign="middle" style="padding-right: 8px; padding-left: 8px; font-family: ${FONT}; font-size: 15px; font-weight: 600; color: ${INK_700}; line-height: 1.4;">מתוך ${state.total} מסודרים${left ? ` · נשאר ${left}` : ''}</td>
        </tr></table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#E1E3EC" style="border-radius: 999px; margin-top: 12px;">
          <tr><td style="font-size: 0; line-height: 0; height: 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${pct}%" bgcolor="${scoreColor}" style="border-radius: 999px;">
              <tr><td style="font-size: 0; line-height: 0; height: 8px;">&nbsp;</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin: 10px 0 0;"><tbody>${rows}</tbody></table>`;
}

/**
 * 600px is the width every mail client and every preview pane is built around, and
 * Gmail clips a message body over ~102 KB, which the weekly report has come close
 * to. Keep this lean: no web fonts, no background images, no `<style>` block.
 */
export function renderEmail(blocks: EmailBlocks): string {
  const dir = blocks.dir || 'rtl';
  const rtl = dir === 'rtl';
  const align = rtl ? 'right' : 'left';
  const start = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';

  // Hidden, but present in the source before any visible text — that is the whole
  // mechanism: clients read the first text node for the list preview. The zero
  // dimensions keep it from taking a line, and the whitespace run stops Gmail from
  // appending the body's opening words to it.
  const preheader = blocks.preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #ffffff;">${esc(blocks.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
    : '';

  const eyebrow = blocks.eyebrow
    ? `<div style="font-family: ${FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: ${ACCENT}; margin: 0 0 8px;">${esc(blocks.eyebrow)}</div>`
    : '';

  const paragraphs = (blocks.paragraphs || [])
    .map(p => `<p style="font-family: ${FONT}; font-size: 15px; color: ${INK_700}; line-height: 1.75; margin: 0 0 14px;">${esc(p)}</p>`)
    .join('');

  // The label/value pairs live in a tinted well with hairlines between them, so a
  // three-row mail reads as a small record card instead of six loose lines. `border-top`
  // on every row but the first: `:first-child` is a selector, and there is no CSS here.
  const rowList = blocks.rows || [];
  const rows = rowList.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${WELL}" style="border-collapse: separate; border-radius: 14px; margin: 4px 0 8px;">
         <tr><td style="padding: 6px 18px;">
           <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
             ${rowList.map(([label, value], i) => `
             <tr>
               <td style="font-family: ${FONT}; font-size: 13px; color: ${INK_500}; padding: 12px 0; text-align: ${start}; ${i ? `border-top: 1px solid ${HAIRLINE};` : ''} white-space: nowrap;">${esc(label)}</td>
               <td style="font-family: ${FONT}; font-size: 15px; font-weight: 600; color: ${INK_900}; padding: 12px 0; text-align: ${end}; ${i ? `border-top: 1px solid ${HAIRLINE};` : ''}">${esc(value || '—')}</td>
             </tr>`).join('')}
           </table>
         </td></tr>
       </table>`
    : '';

  // A "bulletproof" button: the colour and the radius are on a <td>, not on the <a>,
  // because Outlook drops both from an anchor and would leave a bare blue word.
  const cta = blocks.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 22px 0 4px;">
         <tr><td bgcolor="${BRAND}" style="border-radius: 999px;">
           <a href="${esc(blocks.cta.href)}" style="display: inline-block; font-family: ${FONT}; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; padding: 15px 32px; border-radius: 999px;">${esc(blocks.cta.label)}</a>
         </td></tr>
       </table>`
    : '';

  const notes = (blocks.notes || []).length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0 0;">
         <tr><td style="border-top: 1px solid ${HAIRLINE}; padding: 14px 0 0;">
           ${(blocks.notes || []).map(n => `<p style="font-family: ${FONT}; font-size: 13px; color: ${INK_500}; line-height: 1.65; margin: 0 0 6px;">${esc(n)}</p>`).join('')}
         </td></tr>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${rtl ? 'he' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${esc(blocks.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PAGE};">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAGE}" style="background-color: ${PAGE};">
  <tr>
    <td align="center" style="padding: 24px 12px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width: 600px; max-width: 100%;">

        <!-- the brand band: mark, wordmark, and the club's own line -->
        <tr>
          <td bgcolor="${BRAND}" style="background-color: ${BRAND}; border-radius: 20px 20px 0 0; padding: 22px 26px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="44" style="width: 44px; vertical-align: middle;">
                  <img src="${LOGO}" width="40" height="40" alt="" style="display: block; width: 40px; height: 40px; border: 0;" />
                </td>
                <td style="padding-${start}: 12px; vertical-align: middle; text-align: ${start};">
                  <div style="font-family: ${FONT}; font-size: 18px; font-weight: 700; color: #ffffff; line-height: 1.2;">מדרגות</div>
                  <div style="font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: #B9BEFF; line-height: 1.4;" dir="ltr">AFTER 2KM</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- 3px of band-3, the one warm colour in the app -->
        <tr><td bgcolor="${ACCENT}" style="background-color: ${ACCENT}; height: 3px; line-height: 3px; font-size: 0;">&nbsp;</td></tr>

        <!-- the card -->
        <tr>
          <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 28px 26px 26px; text-align: ${align};" dir="${dir}">
            ${eyebrow}
            <h1 style="font-family: ${FONT}; font-size: 22px; font-weight: 700; color: ${INK_900}; line-height: 1.35; margin: 0 0 14px;">${esc(blocks.title)}</h1>
            ${paragraphs}
            ${rows}
            ${blocks.bodyHtml || ''}
            ${cta}
            ${notes}
          </td>
        </tr>

        <!-- the footer, outside the card and quiet on purpose -->
        <tr>
          <td bgcolor="#ffffff" style="background-color: #ffffff; border-radius: 0 0 20px 20px; border-top: 1px solid ${HAIRLINE}; padding: 18px 26px 20px; text-align: center;">
            <a href="${esc(APP_URL)}" style="font-family: ${FONT}; font-size: 13px; font-weight: 600; color: ${BRAND}; text-decoration: none;">מדרגות After 2KM</a>
            <div style="font-family: ${FONT}; font-size: 12px; color: ${INK_500}; line-height: 1.6; margin: 6px 0 0;">הודעה אוטומטית מהאפליקציה של המועדון</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
