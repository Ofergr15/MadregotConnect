// @vitest-environment happy-dom
/**
 * Two autosaves and the order they land in.
 *
 * Found in review: both parents (TraineeSetup, CandidateFunnel) applied EVERY save's echo, so if
 * an earlier save answered after a later one, the older answers came back on screen. And the
 * route is a plain upsert, so two PUTs in flight could also be STORED in either order.
 *
 * Two guards, both pinned here:
 *  - the form keeps one save on the wire at a time (the next waits for the previous answer), so
 *    the table is written in typing order and echoes arrive in typing order;
 *  - the parents apply an echo only if it belongs to their newest save (lib/academy/latest-echo),
 *    so even a reordered answer can never revert newer text.
 */
import { cleanup, fireEvent, render, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterizationForm } from '@/components/academy/CharacterizationForm';
import { type Characterization } from '@/lib/academy/characterization';
import { latestEcho } from '@/lib/academy/latest-echo';

let saveCalls: { body: Characterization; resolveEcho: (echo: Characterization) => void }[];

/** Replicates the guarded parents: a ticket per save, and only the newest ticket applies. */
function Harness({ candidateId }: { candidateId: string }) {
  const [value, setValue] = useState<Characterization | null>(null);
  const echoes = useRef(latestEcho());
  return (
    <CharacterizationForm
      candidateId={candidateId}
      value={value}
      today="2026-11-19"
      onSave={async (next) => {
        const ticket = echoes.current.begin();
        const echo = await new Promise<Characterization>((resolve) => {
          saveCalls.push({ body: next, resolveEcho: resolve });
        });
        if (echoes.current.isLatest(ticket)) setValue(echo);
        return true;
      }}
    />
  );
}

/** Lets queued promise chains (the form's save queue) run. */
async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers(); saveCalls = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('out-of-order resolution', () => {
  it('the form never puts a second save on the wire before the first has answered', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון ' } });
    act(() => { vi.advanceTimersByTime(1000); });           // save #1 on the wire
    fireEvent.change(race, { target: { value: 'מרתון ולנסיה' } });
    act(() => { vi.advanceTimersByTime(1000); });           // save #2 due — must wait
    await flush();
    expect(saveCalls).toHaveLength(1);                      // so the network cannot reorder them

    await act(async () => { saveCalls[0].resolveEcho({ ...saveCalls[0].body }); });
    await flush();
    expect(saveCalls).toHaveLength(2);                      // #2 sent only after #1 answered
    expect(saveCalls.map(c => c.body.targetRace)).toEqual(['מרתון ', 'מרתון ולנסיה']);
    expect(race.value).toBe('מרתון ולנסיה');                // #1's stale echo did not revert

    await act(async () => { saveCalls[1].resolveEcho({ ...saveCalls[1].body }); });
    await flush();
    expect(race.value).toBe('מרתון ולנסיה');
  });

  it('a normalised echo for the LATEST save still lands', async () => {
    const { getByPlaceholderText } = render(<Harness candidateId="A" />);
    const race = getByPlaceholderText('טבריה') as HTMLInputElement;

    fireEvent.change(race, { target: { value: 'מרתון ' } });
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.change(race, { target: { value: 'מרתון ולנסיה' } });
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { saveCalls[0].resolveEcho({ ...saveCalls[0].body }); });
    await flush();
    await act(async () => { saveCalls[1].resolveEcho({ ...saveCalls[1].body, targetRace: 'מרתון ולנסיה 2026' }); });
    await flush();
    expect(race.value).toBe('מרתון ולנסיה 2026');
  });
});

describe('parent echo guard (lib/academy/latest-echo)', () => {
  /** The parents' handler shape, minus fetch: apply the echo only for the newest ticket. */
  function parentHandler() {
    const echoes = latestEcho();
    const applied: string[] = [];
    const save = (sent: string) => {
      const ticket = echoes.begin();
      return (echo: string) => { if (echoes.isLatest(ticket)) applied.push(echo); };
    };
    return { save, applied };
  }

  it('an earlier save answering LAST never reverts the newer answers (QA reorder case)', () => {
    const p = parentHandler();
    const answer1 = p.save('מרתון ');
    const answer2 = p.save('מרתון ולנסיה');
    answer2('מרתון ולנסיה');   // the later save answers first
    answer1('מרתון ');         // the stale one arrives last
    expect(p.applied).toEqual(['מרתון ולנסיה']);
  });

  it('in-order answers: the newest still applies, including a server-normalised value', () => {
    const p = parentHandler();
    const answer1 = p.save('מרתון ');
    answer1('מרתון');
    const answer2 = p.save('מרתון ולנסיה ');
    answer2('מרתון ולנסיה');
    expect(p.applied).toEqual(['מרתון', 'מרתון ולנסיה']);
  });

  it('each parent instance has its own sequence (two sheets do not interfere)', () => {
    const a = parentHandler();
    const b = parentHandler();
    const a1 = a.save('A');
    b.save('B');
    a1('A');
    expect(a.applied).toEqual(['A']);
  });
});
