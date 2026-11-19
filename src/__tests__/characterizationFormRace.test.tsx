// @vitest-environment happy-dom
/**
 * The autosave must never rewrite the field under the cursor.
 *
 * Reported from the field (staff characterization for two trainees): while the coach typed a
 * free-text answer (target race), the 900ms autosave fired on a pause, the PUT echo came back
 * as a new `value`, and the form's reset effect replaced the whole form with the saved snapshot
 * — the characters typed after the save fired were wiped and the screen visibly jumped.
 *
 * These tests mount the real component with a harness that behaves like both parents
 * (TraineeSetup, CandidateFunnel): a successful save replaces `value` with the server's echo.
 */
import { cleanup, fireEvent, render, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterizationForm } from '@/components/academy/CharacterizationForm';
import { emptyCharacterization, type Characterization } from '@/lib/academy/characterization';

let setValueExternal: ((v: Characterization | null) => void) | null = null;
let saveCalls: { body: Characterization; resolve: (ok: boolean) => void }[];

function Harness({ candidateId, initial }: { candidateId: string; initial: Characterization | null }) {
  const [value, setValue] = useState<Characterization | null>(initial);
  // Exposed from an effect, not during render (react-hooks purity); setValue is stable.
  useEffect(() => { setValueExternal = setValue; }, []);
  return (
    <CharacterizationForm
      candidateId={candidateId}
      value={value}
      today="2026-11-19"
      onSave={(next) =>
        new Promise<boolean>((resolve) => {
          saveCalls.push({ body: next, resolve });
        })
      }
    />
  );
}

/** A save resolves the way the real parents apply it: echo becomes the new value, then ok. */
async function echoAndResolve(i: number) {
  await act(async () => {
    setValueExternal!({ ...saveCalls[i].body });
    saveCalls[i].resolve(true);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saveCalls = [];
  setValueExternal = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('autosave echo', () => {
  it('never wipes text typed after the save fired (the reported race)', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון ' } });
    act(() => { vi.advanceTimersByTime(1000); });          // debounce fires: save #1 with 'מרתון '
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].body.targetRace).toBe('מרתון ');

    fireEvent.change(race, { target: { value: 'מרתון ולנסיה' } }); // coach keeps typing mid-flight
    await echoAndResolve(0);                                       // echo carries only 'מרתון '

    expect(race.value).toBe('מרתון ולנסיה');
  });

  it('never wipes prTime typed after the save fired', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    const pr = getByPlaceholderText('48:30') as HTMLInputElement;

    fireEvent.change(pr, { target: { value: '48:30' } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(saveCalls).toHaveLength(1);

    fireEvent.change(pr, { target: { value: '49:15' } });
    await echoAndResolve(0);

    expect(pr.value).toBe('49:15');
  });

  it('adopts the server echo once the screen shows exactly what was saved', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון טבריה' } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(saveCalls).toHaveLength(1);
    // The server normalizes (e.g. trims): the echo differs from what was typed.
    await act(async () => {
      setValueExternal!({ ...saveCalls[0].body, targetRace: 'מרתון טבריה!' });
      saveCalls[0].resolve(true);
      await Promise.resolve();
    });
    expect(race.value).toBe('מרתון טבריה!');
  });
});

describe('candidate switching', () => {
  it('initializes the incoming candidate’s answers', () => {
    const bRow: Characterization = {
      ...emptyCharacterization('B'),
      targetRace: 'מרתון ברלין',
      prTimeSec: 2910,
    };
    const { getByPlaceholderText, rerender } = render(<Harness candidateId="A" initial={null} />);
    act(() => { setValueExternal!(bRow); });
    rerender(<Harness candidateId="B" initial={null} />);
    expect((getByPlaceholderText('טבריה') as HTMLInputElement).value).toBe('מרתון ברלין');
    expect((getByPlaceholderText('48:30') as HTMLInputElement).value).toBe('48:30');
  });

  it('never adopts a stale echo that belongs to the previous candidate', () => {
    const bRow: Characterization = { ...emptyCharacterization('B'), targetRace: 'מרתון ברלין' };
    const { getByPlaceholderText } = render(<Harness candidateId="B" initial={bRow} />);
    act(() => {
      setValueExternal!({ ...emptyCharacterization('A'), targetRace: 'מרתון A' });
    });
    expect((getByPlaceholderText('טבריה') as HTMLInputElement).value).toBe('מרתון ברלין');
  });

  it('hydrates when the row arrives after mount (async first load)', () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    act(() => { setValueExternal!({ ...emptyCharacterization('A'), limitations: 'דלקת בגיד אכילס' }); });
    expect((getByPlaceholderText('דלקת בגיד אכילס לפני חצי שנה') as HTMLTextAreaElement).value).toBe('דלקת בגיד אכילס');
  });
});

describe('after the race', () => {
  it('the follow-up save confirms the newer text and its echo is adopted again', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון ' } });
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.change(race, { target: { value: 'מרתון ולנסיה' } });
    await echoAndResolve(0);                       // stale echo ignored
    act(() => { vi.advanceTimersByTime(1000); });  // the newer text's own save fires
    expect(saveCalls).toHaveLength(2);
    expect(saveCalls[1].body.targetRace).toBe('מרתון ולנסיה');

    await act(async () => {
      setValueExternal!({ ...saveCalls[1].body, targetRace: 'מרתון ולנסיה 2026' });
      saveCalls[1].resolve(true);
      await Promise.resolve();
    });
    expect(race.value).toBe('מרתון ולנסיה 2026');  // clean again → normalised echo lands
  });

  it('a failed save keeps what is on screen and does not adopt a later echo over it', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" initial={null} />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון ולנסיה' } });
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { saveCalls[0].resolve(false); await Promise.resolve(); });
    act(() => { setValueExternal!({ ...emptyCharacterization('A'), targetRace: 'ישן' }); });
    expect(race.value).toBe('מרתון ולנסיה');
  });
});
