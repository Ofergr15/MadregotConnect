import { describe, expect, it } from 'vitest';
import { academyAcceptedEmail, academyMoveInEmail } from '@/lib/email/index';
import { academyTraineeJoinedCopy, academyTraineesAssignedCopy } from '@/lib/notifications/copy';

/** The academy's way into the app (Ofer, 2026-10-19): the mails install it, the coaches hear both moments. */
describe('academy mails that bring a trainee in', () => {
  it('the acceptance carries the install guide, the QR and the Safari tip', () => {
    const { subject, html } = academyAcceptedEmail({ name: 'דנה כהן', token: 'tok1', coachName: 'שליו', coachCount: 1 });
    expect(subject).toContain('ככה נכנסים לאפליקציה');
    expect(html).toContain('/join/tok1?onb=v2');
    expect(html).toContain('/api/public/qr?t=tok1');
    expect(html).toContain('Safari');
    expect(html).toContain('המאמן/ת שלך: שליו.');
    expect(html).not.toContain('לא חובה');
  });
  it('a member who already has an account still just opens the app', () => {
    const { html } = academyAcceptedEmail({ name: 'דנה', token: null });
    expect(html).toContain('/dashboard');
    expect(html).not.toContain('onb=v2');
  });
  it('somebody who already trains with us gets the move-in mail, no form', () => {
    const { subject, html } = academyMoveInEmail({ name: 'יוסי לוי', token: 'tok2', coachName: 'דנה', coachCount: 1 });
    expect(subject).toContain('עוברת לאפליקציה');
    expect(html).toContain('/join/tok2?onb=v2');
    expect(html).toContain('מ־דנה');
    expect(html).toContain('אין טופס');
  });
});

describe('the coach, at both moments', () => {
  it('when the trainee is theirs: start the plan', () => {
    expect(academyTraineesAssignedCopy('he', { names: ['דנה'] }).body).toContain('לבנות לו/ה תוכנית');
  });
  it('when the trainee comes in: build the first plan', () => {
    const c = academyTraineeJoinedCopy('he', { name: 'דנה כהן' });
    expect(c.title).toBe('✅ דנה כהן נכנס/ה לאפליקציה');
    expect(c.body).toContain('התוכנית הראשונה');
  });
});
