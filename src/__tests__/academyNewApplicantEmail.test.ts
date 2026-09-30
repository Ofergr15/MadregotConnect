import { describe, expect, it } from 'vitest';
import { ageFrom, focusShort, newApplicantSubject, renderAcademyNewApplicant, whatsappNumber } from '@/lib/email/academy-new-applicant';

/**
 * The staff mail for a new academy form, in the applicant mail's design: who they
 * are, a dial and a WhatsApp button, what they are after, their background, and a
 * button to their card. Ofer kept the birth date, medical history, height and
 * weight OUT of it — the age is enough, the rest is on the card.
 */
const intake = {
  firstName: 'עופר', lastName: 'גרוספלד',
  focus: 'שילוב של תכנית און ליין עם מפגשים פיזיים',
  birthDate: '1992-03-12', weight: '74', height: '178', city: 'תל אביב',
  group: 'דבוקה 5 אימון למרתון באזור ה-3:30',
  runningHistory: 'רץ 3 פעמים בשבוע, חצי מרתון ב-1:52',
  medicalHistory: 'נוטל תרופות באופן קבוע', medicalDetails: 'לחץ דם',
  hearAbout: 'אינסטגרם', shirtSize: 'M',
};
const applicant = {
  name: 'עופר גרוספלד', email: 'grosfeldofer15@gmail.com', phone: '052-372-2840', intake,
  href: 'https://www.madregot.app/open?to=%2Fdashboard%2Facademy%3Ftab%3Dfunnel%26candidate%3Dc1',
};

describe('renderAcademyNewApplicant', () => {
  const html = renderAcademyNewApplicant(applicant);
  const today = new Date();

  it('shows who, what they want and their background', () => {
    for (const s of ['עופר גרוספלד', 'תל אביב', intake.focus, 'דבוקה 5', 'רץ 3 פעמים בשבוע', 'אינסטגרם']) expect(html).toContain(s);
    expect(html).toContain(`גיל ${ageFrom('1992-03-12', today)}`);
  });

  it('turns the phone into a call and a WhatsApp link', () => {
    expect(html).toContain('href="tel:0523722840"');
    expect(html).toContain('href="https://wa.me/972523722840"');
  });

  it('leaves out the birth date, medical history, height, weight and sizes', () => {
    for (const s of ['1992', '12.03', 'עבר רפואי', 'תרופות', 'לחץ דם', '178', '74', 'גובה', 'משקל', 'מידה']) expect(html).not.toContain(s);
  });

  it('links to the applicant card', () => {
    expect(html).toContain(`href="${applicant.href}"`);
    expect(html).toContain('לכרטיס של עופר באקדמיה');
  });

  it('flags an existing member only when there is one', () => {
    expect(html).not.toContain('כבר שייך לרץ במועדון');
    expect(renderAcademyNewApplicant({ ...applicant, existingMember: true })).toContain('כבר שייך לרץ במועדון');
  });

  it('escapes what the public form typed', () => {
    const h = renderAcademyNewApplicant({ ...applicant, name: '<b>x', intake: { ...intake, runningHistory: '<script>' } });
    expect(h).not.toContain('<b>x');
    expect(h).not.toContain('<script>');
  });

  it('still renders with no intake at all', () => {
    const h = renderAcademyNewApplicant({ name: 'דנה', email: 'd@x.co', href: 'https://x' });
    expect(h).toContain('דנה');
    expect(h).not.toContain('מה מעניין אותו');
  });
});

describe('helpers', () => {
  it('ageFrom counts whole years and rejects junk', () => {
    expect(ageFrom('1992-03-12', new Date(2026, 2, 11))).toBe(33);
    expect(ageFrom('1992-03-12', new Date(2026, 2, 12))).toBe(34);
    expect(ageFrom('', new Date())).toBeNull();
    expect(ageFrom('2030-01-01', new Date(2026, 0, 1))).toBeNull();
  });
  it('focusShort and the subject', () => {
    expect(focusShort('רק תכנית אימון און ליין ומעקב')).toBe('רק און ליין');
    expect(focusShort(intake.focus)).toBe('און ליין + מפגשים');
    expect(newApplicantSubject({ name: 'עופר גרוספלד', intake: { ...intake, birthDate: '' } })).toBe('🎓 מועמד חדש: עופר גרוספלד · און ליין + מפגשים');
  });
  it('whatsappNumber', () => {
    expect(whatsappNumber('050-000-0000')).toBe('972500000000');
    expect(whatsappNumber('+972 50 000 0000')).toBe('972500000000');
    expect(whatsappNumber('123')).toBeNull();
  });
});
