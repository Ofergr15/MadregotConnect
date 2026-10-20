import { describe, expect, it } from 'vitest';
import {
  academyAcceptedEmail, academyExistingFormEmail, academyExistingFormReceivedEmail, academyMoveInEmail,
} from '@/lib/email/index';
import { newApplicantSubject, renderAcademyNewApplicant } from '@/lib/email/academy-new-applicant';
import {
  academyApplicantCopy, academyTraineeComingCopy, academyTraineeJoinedCopy, academyTraineesAssignedCopy,
} from '@/lib/notifications/copy';

/**
 * The way into the app (academy-onboarding/existing-trainee-flow.html): name + email → the
 * details form → the manager approves → the install mail → the coach hears they signed in.
 * No coach by name in anything the trainee reads (Ofer, 2026-10-19).
 */
describe('what the trainee reads', () => {
  it('1 · an existing trainee gets the details form, not the app yet', () => {
    const { subject, html } = academyExistingFormEmail({ name: 'יוסי לוי', url: 'https://www.madregot.app/academy-register?i=abc' });
    expect(subject).toBe('🎓 יוסי, האקדמיה עוברת לאפליקציה — נשאר רק למלא פרטים');
    expect(html).toContain('/academy-register?i=abc');
    expect(html).toContain('מהמאמן/ת שלך');
    expect(html).not.toContain('onb=v2');
  });
  it('2 · after the form: no intro call ahead of them, the app link comes next', () => {
    const { html } = academyExistingFormReceivedEmail({ name: 'יוסי' });
    expect(html).toContain('הקישור להתקנת האפליקציה');
    expect(html).not.toContain('שיחת היכרות');
  });
  it('3 · approved: the install mail, for an existing trainee "הכל מוכן"', () => {
    const { subject, html } = academyMoveInEmail({ name: 'יוסי לוי', token: 'tok2', coachName: 'דנה', coachCount: 1 });
    expect(subject).toBe('✅ יוסי, הכל מוכן — ככה נכנסים לאפליקציה');
    expect(html).toContain('/join/tok2"');
    expect(html).toContain('Strava');
    expect(html).toContain('/api/public/qr?t=tok2');
    expect(html).toContain('Safari');
    expect(html).not.toContain('דנה');
  });
  it('3 · a new trainee: "התקבלת", the same install section, no coach by name', () => {
    const { subject, html } = academyAcceptedEmail({ name: 'דנה כהן', token: 'tok1', coachName: 'שליו', coachCount: 1 });
    expect(subject).toContain('ככה נכנסים לאפליקציה');
    expect(html).toContain('/join/tok1"');
    expect(html).toContain('Strava');
    expect(html).not.toContain('שליו');
    expect(html).not.toContain('לא חובה');
  });
  it('an account that already exists just opens the app', () => {
    const { html } = academyAcceptedEmail({ name: 'דנה', token: null });
    expect(html).toContain('/dashboard');
    expect(html).not.toContain('onb=v2');
  });
});

describe('what the manager reads when the form comes back', () => {
  it('says "existing trainee, not new" — push and mail', () => {
    expect(academyApplicantCopy('he', { name: 'יוסי לוי', existingTrainee: true })).toEqual({
      title: '📋 יוסי לוי מילא/ה את הטופס', body: 'מתאמן/ת קיים/ת — לא מועמד/ת חדש/ה. לחיצה לאישור.',
    });
    expect(newApplicantSubject({ name: 'יוסי לוי', existingTrainee: true })).toBe('📋 יוסי לוי מילא/ה את הטופס · מתאמן/ת קיים/ת');
    const html = renderAcademyNewApplicant({ name: 'יוסי לוי', email: 'y@x.co', existingTrainee: true, href: 'https://x' });
    expect(html).toContain('לא מועמד/ת חדש/ה');
    expect(html).toContain('לאישור של');
  });
  it('a new applicant reads as before', () => {
    expect(academyApplicantCopy('he', { name: 'דנה' }).title).toBe('🎓 מועמד חדש לאקדמיה');
  });
});

describe('the coach', () => {
  it('4 · at the approval of somebody not in the app yet: a heads-up', () => {
    expect(academyTraineeComingCopy('he', { name: 'יוסי לוי' })).toEqual({
      title: '🎓 יוסי לוי מצטרף/ת אליך', body: 'ייכנס/תיכנס לאפליקציה בקרוב. אפשר כבר להשלים את טופס ההתאמה: סוג ליווי, דבוקה ומטרה.',
    });
  });
  it('6 · when they signed in from the app: build the first plan', () => {
    const c = academyTraineeJoinedCopy('he', { name: 'יוסי לוי' });
    expect(c.title).toBe('✅ יוסי לוי התקין/ה את האפליקציה והתחבר/ה');
    expect(c.body).toContain('התוכנית הראשונה');
  });
  it('a trainee who is already in the app (moved from the club): the plan can start now', () => {
    expect(academyTraineesAssignedCopy('he', { names: ['דנה'] }).body).toContain('לבנות לו/ה תוכנית');
  });
});

describe('the funnel board', () => {
  it('keeps an existing trainee on the board until approved, without the two calls', async () => {
    const { placeCandidate } = await import('@/lib/academy/funnel');
    const now = '2026-10-20T08:00:00.000Z';
    const card = { id: 'c', name: 'Yossi', source: 'existing', createdAt: '2026-10-19T08:00:00.000Z', invitedAt: '2026-10-19T08:00:00.000Z', acceptedAt: null };
    const waiting = placeCandidate(card, [], now);
    expect(waiting).toMatchObject({ status: 'live', waitingFor: 'form' });
    const filled = placeCandidate(card, [{ candidateId: 'c', stage: 'form', occurredAt: '2026-10-19T12:00:00.000Z' }], now);
    expect(filled.status).toBe('live');
    expect(filled.waitingFor).toBe('signup');
    expect(placeCandidate({ ...card, acceptedAt: '2026-10-20T07:00:00.000Z' }, [], now).status).toBe('joined');
    // An existing trainee moved in the old way (no form sent) reads as joined, as before.
    expect(placeCandidate({ ...card, invitedAt: null }, [], now).status).toBe('joined');
  });
});

describe('the existing trainee fills one page', () => {
  it('confirm the details, health, how they heard of us — nothing the coach or the app asks', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'app/academy-register/page.tsx'), 'utf8');
    const block = src.slice(src.indexOf('const EXISTING_STEPS'), src.indexOf('];', src.indexOf('const EXISTING_STEPS')));
    expect(block).toContain("keys: ['firstName', 'lastName', 'email', 'phone', 'medicalHistory', 'medicalDetails', 'hearAbout', 'hearAboutOther']");
    for (const k of ['focus', 'group', 'height', 'weight', 'shoeSize', 'runningHistory']) expect(block).not.toContain(`'${k}'`);
  });
});
