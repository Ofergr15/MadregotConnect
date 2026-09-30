import { describe, expect, it } from 'vitest';
import { academyFormReceivedEmail } from '@/lib/email';
import { senderWithName } from '@/lib/email/send';

/**
 * The applicant's first mail, in the design Ofer picked ("שקיעה על המסלול"): the
 * club badge, a thank-you, and four steps — with no fitness test among them, and
 * no "didn't fill a form? ignore this" line.
 */
describe('academyFormReceivedEmail', () => {
  const { subject, html } = academyFormReceivedEmail({ name: 'עופר גרוספלד' });

  it('greets by first name, in the subject and the header', () => {
    expect(subject).toBe('קיבלנו, עופר. המדרגה הראשונה מאחוריך 🎉');
    expect(html).toContain('קיבלנו, עופר.');
  });

  it('carries the full club badge', () => {
    expect(html).toMatch(/<img src="[^"]*\/images\/logo-white\.png" width="132"/);
  });

  it('shows the four steps and no test', () => {
    for (const step of ['הטופס', 'שיחת היכרות', 'שיחה עם מאמן', 'מתחילים']) expect(html).toContain(step);
    expect(html).not.toContain('מבחן');
    expect(html).not.toContain('להתעלם');
  });

  it('escapes the name', () => {
    const { html: h } = academyFormReceivedEmail({ name: '<script>x' });
    expect(h).not.toContain('<script>x');
    expect(h).toContain('&lt;script&gt;x');
  });

  it('still reads without a name', () => {
    const e = academyFormReceivedEmail({ name: '' });
    expect(e.subject).toBe('קיבלנו! המדרגה הראשונה מאחוריך 🎉');
    expect(e.html).toContain('קיבלנו!');
  });
});

describe('senderWithName', () => {
  it('swaps the display name and keeps the address', () => {
    expect(senderWithName('Madregot <noreply@madregot.app>', 'האקדמיה של מדרגות')).toBe('האקדמיה של מדרגות <noreply@madregot.app>');
    expect(senderWithName('noreply@madregot.app', 'X')).toBe('X <noreply@madregot.app>');
  });
  it('cannot be used to inject a header or a second address', () => {
    expect(senderWithName('Madregot <a@b.c>', 'Evil <x@y.z>\r\nBcc: q')).toBe('Evil x@y.zBcc: q <a@b.c>');
  });
  it('leaves the sender alone with no name', () => {
    expect(senderWithName('Madregot <a@b.c>', null)).toBe('Madregot <a@b.c>');
  });
});
