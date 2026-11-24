// Night queue #68: email_log.subject must not hold a live sign-in code.
import { describe, it, expect } from 'vitest';
import { loggedSubject } from '@/lib/email/send';

describe('loggedSubject', () => {
  it('masks the code in the login mail, keeps the words', () => {
    const s = loggedSubject('login_code', '483920 הוא קוד הכניסה שלכם למדרגות');
    expect(s).not.toMatch(/\d{4,}/);
    expect(s).toContain('הוא קוד הכניסה');
  });
  it('leaves every other template alone (staff read subjects to recognise mails)', () => {
    expect(loggedSubject('admin_pending_digest', '⏳ 3 מחכים לאישור, הוותיק 2 ימים')).toBe('⏳ 3 מחכים לאישור, הוותיק 2 ימים');
    expect(loggedSubject('registration_approved', '✅ ההרשמה שלכם למדרגות אושרה')).toBe('✅ ההרשמה שלכם למדרגות אושרה');
  });
});
