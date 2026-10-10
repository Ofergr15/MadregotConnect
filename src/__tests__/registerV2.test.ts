import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { whatsappNumber } from '@/lib/email/academy-new-applicant';
import { approvalWhatsAppText } from '@/lib/install/flag';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the v2 signup form', () => {
  it('asks a name (required) and an optional phone, and drops the expired countdown', () => {
    const page = read('app/register/page.tsx');
    expect(page).toMatch(/if \(v2 && !fullName\.trim\(\)\) \{ setError\('איך קוראים לך\?'\); return; \}/);
    expect(page).toMatch(/placeholder="טלפון \(לא חובה\) · למקרה שנצטרך לחזור אליכם"/);
    // One term (קבוצת קצב), gender-neutral, and "not sure" is a real choice (groupId '').
    expect(page).toMatch(/\{ id: '', title: 'לא בטוחים\?', sub: 'המאמן יחליט' \}/);
    expect(page).toMatch(/placeholder="שם מלא באנגלית"/);
    expect(page).toMatch(/if \(done && v2\) \{\s+return <RegisterReceived/);
  });

  it('keeps the request when migration 131 is not pasted yet', () => {
    const api = read('app/api/public/signup/route.ts');
    expect(api).toMatch(/insertError\.code === 'PGRST204' \|\| insertError\.code === '42703'/);
    expect(api).toMatch(/\(\{ error: insertError \} = await supabase\.from\('signup_requests'\)\.insert\(row\)\);/);
  });

  it('mails the applicant only on a new v2 request, and never writes the name onto athletes', () => {
    const api = read('app/api/public/signup/route.ts');
    expect(api).toMatch(/if \(!insertError && v2\) \{\s+try \{\s+await notifyRegistrationReceived/);
    expect(api).not.toMatch(/from\('athletes'\)\.update/);
  });
});

describe('the WhatsApp send after approval', () => {
  it('goes straight to the applicant when they left an Israeli mobile', () => {
    expect(whatsappNumber('052-555-1234')).toBe('972525551234');
    expect(whatsappNumber('12')).toBeNull();
    expect(read('app/(app)/dashboard/entry-queue/page.tsx')).toMatch(/https:\/\/wa\.me\/\$\{a\.whatsapp \?\? ''\}\?text=/);
  });

  it('greets by first name', () => {
    expect(approvalWhatsAppText('L', 'קבוצה 2', 'נועה לוי').split('\n')[0]).toBe('היי נועה! 👋 כאן ממדרגות. ההרשמה אושרה, קבוצה 2 🎉');
    expect(approvalWhatsAppText('L', null, null).split('\n')[0]).toBe('היי! 👋 כאן ממדרגות. ההרשמה אושרה 🎉');
  });
});
