// @vitest-environment happy-dom
/**
 * /u21?track=<id> must open the questionnaire — and must never clobber an
 * in-progress intake.
 *
 * Deployed-preview regression (Nov 19): tapping a track link on /register
 * (next/link client navigation) landed on the track picker — the state
 * initializer can run during the route transition, before the URL commits,
 * so it read the source page's empty search. The mount effect re-applies the
 * param once the URL has committed. jsdom cannot reproduce that transition
 * timing (initializer and effect share one commit), so the client-navigation
 * case is verified on the deployed preview click-through instead; these
 * tests pin the two behaviors jsdom CAN pin.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import U21Page from '@/app/u21/page';

afterEach(() => { cleanup(); window.history.pushState({}, '', '/u21'); });

describe('U21Page track deep link', () => {
  it('full load with ?track=advanced opens the questionnaire directly, not the picker', async () => {
    window.history.pushState({}, '', '/u21?track=advanced');
    const { queryByText } = render(<U21Page />);
    await waitFor(() => expect(queryByText('שאלון היכרות')).toBeTruthy());
    expect(queryByText('מדרגות · מאמן אישי U21')).toBeNull(); // picker heading absent
    expect(queryByText(/מסלול נבחר/)!.textContent).toContain('ADVANCED');
  });

  it('a track already chosen is never overwritten by the effect', async () => {
    window.history.pushState({}, '', '/u21?track=basic');
    const { queryByText, getByText } = render(<U21Page />);
    await waitFor(() => expect(queryByText('שאלון היכרות')).toBeTruthy());
    // Back to the picker, choose a different track by hand: the mount effect
    // must not fire again and must not reset the manual choice.
    getByText('← חזרה לבחירת מסלול').click();
    await waitFor(() => expect(queryByText('מדרגות · מאמן אישי U21')).toBeTruthy());
    getByText('PRO').click();
    await waitFor(() => expect(queryByText('שאלון היכרות')).toBeTruthy());
    expect(queryByText(/מסלול נבחר/)!.textContent).toContain('PRO');
  });
});
