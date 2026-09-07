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
 * ── COLOURS ARE LITERAL HEX ON PURPOSE ─────────────────────────────────────────────
 * Email clients don't run Tailwind, and half of them strip <style> blocks, so
 * everything here is inline. They are still the design system's tokens, not free
 * choices — keep them in step with tailwind.config.ts:
 *   brand-600 #1525FF buttons/links · ink-900 #1D1E26 headings · ink-700 #2D2E38 body
 *   ink-500 #656565 labels · page #DFDFDF hairlines · accent-red #D74E4E
 */
const INK_900 = '#1D1E26';
const INK_700 = '#2D2E38';
const INK_500 = '#656565';
const INK_400 = '#94a3b8';
const BRAND = '#1525FF';
const PAGE = '#DFDFDF';

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
  /** The <h2>. */
  title: string;
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

/**
 * `max-width: 500px` and table-free layout are not stylistic. Outlook renders divs
 * unpredictably at width, and Gmail clips a message body over ~102 KB, which the
 * weekly report has come close to. Keep this lean.
 */
export function renderEmail(blocks: EmailBlocks): string {
  const dir = blocks.dir || 'rtl';
  const align = dir === 'rtl' ? 'right' : 'left';

  const paragraphs = (blocks.paragraphs || [])
    .map(p => `<p style="color: ${INK_700}; line-height: 1.7; margin: 0 0 12px;">${esc(p)}</p>`)
    .join('');

  const rows = (blocks.rows || []).length
    ? `<table style="width: 100%; border-collapse: collapse; margin: 8px 0 4px;">${(blocks.rows || [])
        .map(([label, value]) => `
          <tr>
            <td style="padding: 8px 0; color: ${INK_500}; font-size: 14px;">${esc(label)}</td>
            <td style="padding: 8px 0; color: ${INK_900}; font-weight: 600; font-size: 14px;">${esc(value || '—')}</td>
          </tr>`)
        .join('')}</table>`
    : '';

  // display:inline-block on the anchor: without it Outlook collapses the padding and
  // the button becomes a bare blue word.
  const cta = blocks.cta
    ? `<p style="margin: 24px 0 0;">
         <a href="${esc(blocks.cta.href)}" style="background: ${BRAND}; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
           ${esc(blocks.cta.label)}
         </a>
       </p>`
    : '';

  const notes = (blocks.notes || [])
    .map(n => `<p style="color: ${INK_500}; font-size: 13px; line-height: 1.6; margin: 16px 0 0;">${esc(n)}</p>`)
    .join('');

  return `<div dir="${dir}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; text-align: ${align}; color: ${INK_700};">
  <h2 style="color: ${INK_900}; font-size: 20px; margin: 0 0 14px;">${esc(blocks.title)}</h2>
  ${paragraphs}
  ${rows}
  ${blocks.bodyHtml || ''}
  ${cta}
  ${notes}
  <hr style="border: 0; border-top: 1px solid ${PAGE}; margin: 28px 0 12px;" />
  <p style="color: ${INK_400}; font-size: 12px; margin: 0;">
    <a href="${esc(APP_URL)}" style="color: ${INK_400}; text-decoration: none;">מדרגות After 2KM</a>
  </p>
</div>`;
}
