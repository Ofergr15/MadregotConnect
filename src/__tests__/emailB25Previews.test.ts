import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * b25 email previews + inbox-compatibility checks.
 *
 * Every member mail is rendered and checked against the rules that keep it readable in
 * Gmail (strips <style>, no flex/grid), Outlook (Word engine: tables, bgcolor, an MSO
 * ghost table for width) and Apple Mail. With WRITE_EMAIL_PREVIEWS=1 the rendered HTML is
 * also written to design/b25/emails/ — that is how the committed previews are produced:
 *
 *   WRITE_EMAIL_PREVIEWS=1 npx vitest run emailB25Previews
 */

const captured: Record<string, { subject: string; html: string }> = {};
vi.mock('@/lib/email/send', () => ({
  sendEmail: async (m: { template: string; subject: string; html: string }) => {
    captured[m.template] = { subject: m.subject, html: m.html };
    return { ok: true, status: 'sent', providerId: null, logId: null };
  },
  senderWithName: (f: string) => f,
}));

const mail = await import('@/lib/email');
const club = await import('@/lib/email/club-mail');

async function renderAll() {
  const out: Array<{ file: string; label: string; subject: string; html: string }> = [];
  const add = (file: string, label: string, b: { subject: string; html: string }) => out.push({ file, label, ...b });

  add('01-welcome.html', 'תודה שנרשמת', club.welcomeEmail({ name: 'דנה כהן', coachName: 'עופר', groupName: 'קבוצה 2' }));
  add('02-newsletter.html', 'עדכונים (ניוזלטר)', club.newsletterEmail({ ...club.SAMPLE_NEWSLETTER, name: 'דנה' }));
  add('03-registration-declined.html', 'ההרשמה לא אושרה', club.registrationDeclinedEmail({ name: 'דנה' }));

  await mail.notifyRegistrationReceived({ email: 'dana@example.com', name: 'דנה' });
  add('04-registration-received.html', 'ההרשמה התקבלה', captured.registration_received);
  await mail.notifyRegistrationApproved({ email: 'dana@example.com', token: 'sample-token', groupName: 'קבוצה 2' });
  add('05-registration-approved.html', 'ההרשמה אושרה', captured.registration_approved);
  await mail.notifyLoginCode({ email: 'dana@example.com', code: '482913', name: 'דנה' });
  add('06-login-code.html', 'קוד כניסה במייל', captured.login_code);
  await mail.notifyJoinReminder({ email: 'dana@example.com', token: 'sample-token', groupName: 'קבוצה 2' });
  add('07-join-reminder.html', 'תזכורת להשלמת הצטרפות', captured.join_reminder);
  await mail.notifyPhoneLink({ email: 'dana@example.com', token: 'sample-token', name: 'דנה' });
  add('08-phone-link.html', 'קישור לטלפון', captured.phone_link);
  return out;
}

describe('b25 member emails', async () => {
  const all = await renderAll();

  it.each(all.map(a => [a.file, a] as const))('%s is inbox-safe', (_f, m) => {
    expect(m.html).toMatch(/<html dir="rtl" lang="he">/);
    expect(m.html).not.toMatch(/<style/i); // Gmail strips <style>
    expect(m.html).not.toMatch(/display:\s*(flex|grid)/); // no client agrees on these
    expect(m.html).not.toMatch(/<div[^>]*class=/); // no classes: nothing to resolve them
    expect(m.html).toContain('<!--[if mso]>'); // Outlook: fixed-width ghost table
    expect(m.html).toMatch(/role="presentation"/);
    for (const img of m.html.match(/<img[^>]*>/g) || []) {
      expect(img).toMatch(/alt="/);
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/src="https:\/\//); // absolute: an inbox has no origin
    }
    expect(m.subject.length).toBeGreaterThan(3);
  });

  it('newsletter escapes composer text and drops non-http links', () => {
    const b = club.newsletterEmail({ title: '<b>x</b>', items: [{ title: 'a', body: '<script>', href: 'javascript:alert(1)' }] });
    expect(b.html).not.toContain('<script>');
    expect(b.html).not.toContain('javascript:');
    expect(b.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('cleanNewsletter requires a title and bounds items', () => {
    expect(club.cleanNewsletter({})).toBeNull();
    const c = club.cleanNewsletter({ title: ' t ', items: Array.from({ length: 20 }, () => ({ title: 'x', body: 'y' })) });
    expect(c?.title).toBe('t');
    expect(c?.items).toHaveLength(8);
  });

  if (process.env.WRITE_EMAIL_PREVIEWS) {
    it('writes design/b25/emails', () => {
      const dir = join(process.cwd(), 'design/b25/emails');
      mkdirSync(dir, { recursive: true });
      for (const m of all) writeFileSync(join(dir, m.file), m.html);
      const list = all.map(m => `<li><a href="${m.file}" target="frame">${m.label}</a><div class="s">${m.subject.replace(/</g, '&lt;')}</div></li>`).join('\n');
      writeFileSync(join(dir, 'index.html'), `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>מיילים · b25</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#FBF1EC;color:#1D1E26}header{padding:16px 20px;background:#23208F;color:#fff}main{display:grid;grid-template-columns:300px 1fr;gap:16px;padding:16px}ul{list-style:none;margin:0;padding:0}li{background:#fff;border-radius:12px;padding:10px 12px;margin-bottom:8px}a{font-weight:700;color:#23208F;text-decoration:none}.s{font-size:12px;color:#5B5F73;margin-top:4px}iframe{width:100%;height:85vh;border:0;border-radius:16px;background:#fff}.n{font-size:12px;color:#5B5F73;line-height:1.6;margin-top:12px}@media(max-width:760px){main{grid-template-columns:1fr}}</style></head>
<body><header><b>מדרגות · מיילים b25</b> — תבנית אחת לכל מיילי המועדון (מוקאפ, לא נשלח)</header><main><div><ul>${list}</ul>
<p class="n">נבדק: טבלאות + CSS inline בלבד (Gmail מסיר &lt;style&gt;), טבלת רוחב MSO ל-Outlook, צבע רקע fallback מתחת לגרדיאנט (Outlook מציג את הכחול בלבד), dir="rtl" על כל טבלה, תמונות עם alt וכתובת מלאה. בדיקות אוטומטיות: src/__tests__/emailB25Previews.test.ts.</p>
<p class="n">פתיחות הן הערכה: Apple Mail Privacy Protection טוען את פיקסל המעקב לכל מייל.</p></div>
<iframe name="frame" src="${all[0].file}"></iframe></main></body></html>`);
    });
  }
});
