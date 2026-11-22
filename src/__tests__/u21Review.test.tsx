// @vitest-environment happy-dom
/**
 * /u21 review step (the native plan's U21Review): a valid questionnaire opens a
 * read-only summary; nothing is sent until its own send button; "עריכה" returns
 * to the form with every answer kept; server field errors go back to the form.
 * Synthetic answers, fetch stubbed.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import U21Page from '@/app/u21/page';

afterEach(() => { cleanup(); window.history.pushState({}, '', '/u21'); vi.restoreAllMocks(); });

async function fillValid(r: ReturnType<typeof render>) {
  const byId = (k: string) => document.getElementById(`u21-f-${k}`) as HTMLInputElement;
  const type = (k: string, v: string) => fireEvent.change(byId(k), { target: { value: v } });
  type('firstName', 'Test'); type('lastName', 'Fixture'); type('email', 'test@example.test');
  type('phone', '0501234567'); type('birthDate', '2006-01-01'); type('goal', 'שיפור 3 ק״מ');
  const pick = (k: string, label: string) => {
    const g = byId(k);
    fireEvent.click([...g.querySelectorAll('button')].find(b => b.textContent === label)!);
  };
  pick('framework', 'תיכון'); pick('experience', 'פחות משנה'); pick('runsPerWeek', '1–2');
  pick('strengthExperience', 'מעט'); pick('availableDays', 'ראשון'); pick('availableDays', 'רביעי');
  pick('sleepHours', '7–8');
  for (const k of ['chestPain', 'fainting', 'bonePain', 'acuteInjury']) pick(k, 'לא');
  void r;
}

const open = async () => {
  window.history.pushState({}, '', '/u21?track=basic');
  const r = render(<U21Page />);
  await waitFor(() => expect(r.queryByText('שאלון היכרות')).toBeTruthy());
  return r;
};

describe('U21 review step', () => {
  it('valid form → review (no network), answers shown as chosen, adult hides guardian', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await open();
    await fillValid(r);
    fireEvent.click(r.getByText('המשך לבדיקה'));
    await waitFor(() => expect(r.queryByText('בדיקת הפרטים לפני שליחה')).toBeTruthy());
    expect(fetchSpy).not.toHaveBeenCalled();
    const review = r.getByTestId('u21-review').textContent || '';
    expect(review).toContain('test@example.test');
    expect(review).toContain('ראשון, רביעי');
    expect(review).toContain('תיכון');
    expect(review).not.toContain('שם הורה / אפוטרופוס');   // 2006 → adult
    expect(review).not.toContain('yes');
  });

  it('"עריכה" returns to the form with every answer kept', async () => {
    const r = await open();
    await fillValid(r);
    fireEvent.click(r.getByText('המשך לבדיקה'));
    await waitFor(() => r.getByText('← עריכה'));
    fireEvent.click(r.getByText('← עריכה'));
    await waitFor(() => expect(r.queryByText('שאלון היכרות')).toBeTruthy());
    expect((document.getElementById('u21-f-firstName') as HTMLInputElement).value).toBe('Test');
    const days = document.getElementById('u21-f-availableDays')!;
    expect([...days.querySelectorAll('button[aria-pressed="true"]')].map(b => b.textContent)).toEqual(['ראשון', 'רביעי']);
  });

  it('send from review posts once and shows the same confirmation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, status: 'pending_review' }), { status: 200 }));
    const r = await open();
    await fillValid(r);
    fireEvent.click(r.getByText('המשך לבדיקה'));
    await waitFor(() => r.getByText('בדיקת הפרטים לפני שליחה'));
    fireEvent.click(r.getByText('שליחה'));
    await waitFor(() => expect(r.queryByText('הפרטים נקלטו ✓')).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/u21/register');
  });

  it('server field errors take the user back to the form next to the field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'validation', errors: { email: 'אימייל לא תקין' } }), { status: 400 }));
    const r = await open();
    await fillValid(r);
    fireEvent.click(r.getByText('המשך לבדיקה'));
    await waitFor(() => r.getByText('בדיקת הפרטים לפני שליחה'));
    fireEvent.click(r.getByText('שליחה'));
    await waitFor(() => expect(r.queryByText('שאלון היכרות')).toBeTruthy());
    expect(document.getElementById('u21-f-email')!.getAttribute('aria-invalid')).toBe('true');
  });
});
