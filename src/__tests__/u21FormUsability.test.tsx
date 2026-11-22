// @vitest-environment happy-dom
/**
 * /u21 questionnaire usability (synthetic, no network).
 *
 * 1. The question text of a choice field must not answer it. The option buttons
 *    used to sit inside a <label>, which forwards a tap on the question to its
 *    first button: tapping "האם חווית כאב / לחץ בחזה במהלך מאמץ?" recorded "כן".
 * 2. An invalid submit lands on a focused, announced summary whose links reach
 *    each field, and each field carries aria-invalid + its error text.
 * 3. What was typed survives the invalid submit.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import U21Page from '@/app/u21/page';

afterEach(() => { cleanup(); window.history.pushState({}, '', '/u21'); vi.restoreAllMocks(); });

const open = async () => {
  window.history.pushState({}, '', '/u21?track=basic');
  const r = render(<U21Page />);
  await waitFor(() => expect(r.queryByText('שאלון היכרות')).toBeTruthy());
  return r;
};
const pressed = (group: Element) =>
  [...group.querySelectorAll('button[aria-pressed="true"]')].map(b => b.textContent);

describe('U21 questionnaire usability', () => {
  it('tapping a safety question text does not answer it', async () => {
    const { getByText } = await open();
    const q = getByText('האם חווית כאב / לחץ בחזה במהלך מאמץ?');
    fireEvent.click(q);
    const group = q.closest('[role="group"]')!;
    expect(group).toBeTruthy();
    expect(pressed(group)).toEqual([]);
    fireEvent.click(getByText('ניסיון באימונים'));
    expect(pressed(getByText('ניסיון באימונים').closest('[role="group"]')!)).toEqual([]);
  });

  it('an option button is named by its option, and the group by its question', async () => {
    const { getByText } = await open();
    const group = getByText('מסגרת נוכחית').closest('[role="group"]')!;
    const labelId = group.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)!.textContent).toContain('מסגרת נוכחית');
    expect(group.closest('label')).toBeNull();
    fireEvent.click(getByText('תיכון'));
    expect(pressed(group)).toEqual(['תיכון']);
  });

  it('invalid submit: focused alert summary linking to fields, aria-invalid, values kept', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { getByText, getByLabelText } = await open();
    fireEvent.change(getByLabelText(/שם פרטי/), { target: { value: 'Test' } });
    fireEvent.click(getByText('המשך לבדיקה'));

    const summary = await waitFor(() => {
      const s = document.querySelector('[data-testid="u21-error-summary"]');
      expect(s).toBeTruthy();
      return s!;
    });
    expect(summary.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    const links = [...summary.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const target = document.getElementById(a.getAttribute('href')!.slice(1));
      expect(target, a.textContent!).toBeTruthy();
      expect(target!.getAttribute('aria-invalid')).toBe('true');
      const errId = target!.getAttribute('aria-describedby')!.split(' ').pop()!;
      expect(document.getElementById(errId)!.textContent).toBeTruthy();
    }
    expect(links.map(a => a.textContent)).toContain('האם חווית כאב / לחץ בחזה במהלך מאמץ?');
    expect((getByLabelText(/שם פרטי/) as HTMLInputElement).value).toBe('Test');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answering a field clears only that field’s stale error', async () => {
    const { getByText } = await open();
    fireEvent.click(getByText('המשך לבדיקה'));
    const group = await waitFor(() => {
      const g = document.getElementById('u21-f-framework')!;
      expect(g.getAttribute('aria-invalid')).toBe('true');
      return g;
    });
    fireEvent.click(getByText('תיכון'));
    await waitFor(() => expect(group.getAttribute('aria-invalid')).toBeNull());
    expect(document.getElementById('u21-f-experience')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('guardian fields appear for a minor and the other-framework field for "אחר"', async () => {
    const { getByText, queryByText, getByLabelText } = await open();
    expect(queryByText('שם הורה / אפוטרופוס')).toBeNull();
    fireEvent.change(getByLabelText(/תאריך לידה/), { target: { value: '2010-01-01' } });
    await waitFor(() => expect(queryByText('שם הורה / אפוטרופוס')).toBeTruthy());
    expect(queryByText('פרט/י (מסגרת אחרת)')).toBeNull();
    fireEvent.click(getByText('אחר'));
    await waitFor(() => expect(getByLabelText('פרט/י (מסגרת אחרת)')).toBeTruthy());
  });
});
