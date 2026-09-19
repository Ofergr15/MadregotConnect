import { describe, expect, it } from 'vitest';

import {
  STAGES,
  buildFunnel,
  candidateTimeline,
  placeCandidate,
  type CandidateEvent,
  type CandidateRow,
} from '@/lib/academy/funnel';

/**
 * The funnel's job is to say who is stuck and with whom, and every way of getting that wrong
 * is a real person who never hears back. So these tests are mostly about the wrong answers:
 * counting the wait from the wrong moment, colouring somebody who said no, dropping somebody
 * off the board the moment they signed up, and marking a step complete that nobody performed.
 */

const NOW = '2026-09-19T09:00:00.000Z';

function candidate(id: string, over: Partial<CandidateRow> = {}): CandidateRow {
  return { id, name: id, createdAt: '2026-09-01T08:00:00.000Z', ...over };
}

function event(candidateId: string, stage: string, occurredAt: string, over: Partial<CandidateEvent> = {}): CandidateEvent {
  return { candidateId, stage, occurredAt, ...over };
}

describe('where a candidate sits', () => {
  it('is the first step MISSING, not the last one done', () => {
    // The board's columns are "waiting for X". A candidate who did the intro call is waiting
    // for the characterization call — that is the phone call somebody has to make.
    const placed = placeCandidate(
      candidate('c1'),
      [event('c1', 'form', '2026-09-02T08:00:00Z'), event('c1', 'intro_call', '2026-09-03T08:00:00Z')],
      NOW,
    );
    expect(placed.waitingFor).toBe('characterization');
    expect(placed.owner).toBe('coach');
    expect(placed.done).toEqual(['form', 'intro_call']);
  });

  it('asks for the missing step even when a later one already happened', () => {
    // Real histories are out of order: the test gets run before anybody logged the call.
    // Waiting for the test would be wrong — the test is done. The call is what is missing.
    const placed = placeCandidate(
      candidate('c1'),
      [event('c1', 'form', '2026-09-02T08:00:00Z'), event('c1', 'test', '2026-09-14T06:00:00Z')],
      NOW,
    );
    expect(placed.waitingFor).toBe('intro_call');
    expect(placed.done).toEqual(['form', 'test']);
  });

  it('starts the clock at the last thing that happened, not at the day they arrived', () => {
    // Arrived 18 days ago, spoke to somebody yesterday. Counting from `createdAt` would call
    // this stuck, and a board where everyone old is red stops being read.
    const placed = placeCandidate(
      candidate('c1', { createdAt: '2026-09-01T08:00:00Z' }),
      [event('c1', 'form', '2026-09-02T08:00:00Z'), event('c1', 'intro_call', '2026-09-18T20:00:00Z')],
      NOW,
    );
    expect(placed.daysWaiting).toBe(0);
    expect(placed.stuck).toBe(false);
  });

  it('measures the first step from the day they arrived, because nothing else has happened', () => {
    const placed = placeCandidate(candidate('c1', { createdAt: '2026-09-10T08:00:00Z' }), [], NOW);
    expect(placed.waitingFor).toBe('form');
    expect(placed.daysWaiting).toBe(9);
  });

  it('applies each stage’s own threshold to the same silence', () => {
    // Four days of nothing: negligence while waiting for a phone call, perfectly normal while
    // waiting for somebody to find a morning for a 30-minute test.
    const four = '2026-09-15T09:00:00Z';
    const afterForm = placeCandidate(candidate('c1'), [event('c1', 'form', four)], NOW);
    const afterSignup = placeCandidate(
      candidate('c2'),
      ['form', 'intro_call', 'characterization', 'signup'].map(s => event('c2', s, four)),
      NOW,
    );
    expect(afterForm.waitingFor).toBe('intro_call');
    expect(afterForm.stuck).toBe(true);
    expect(afterSignup.waitingFor).toBe('test');
    expect(afterSignup.stuck).toBe(false);
  });

  it('tips over on the threshold day itself, not the day after', () => {
    const twoDays = '2026-09-17T09:00:00Z';
    const spec = STAGES.find(s => s.key === 'intro_call')!;
    expect(spec.stuckAfterDays).toBe(2);
    expect(placeCandidate(candidate('c1'), [event('c1', 'form', twoDays)], NOW).stuck).toBe(true);
    expect(placeCandidate(candidate('c1'), [event('c1', 'form', '2026-09-18T09:00:00Z')], NOW).stuck).toBe(false);
  });

  it('never reports a negative wait', () => {
    // A call logged as next Tuesday is a typo in a date field, and a negative wait would sort
    // that row to the top of the board as the most urgent thing in the academy.
    const placed = placeCandidate(candidate('c1'), [event('c1', 'form', '2026-09-30T09:00:00Z')], NOW);
    expect(placed.daysWaiting).toBe(0);
    expect(placed.stuck).toBe(false);
  });

  it('ignores a stage key it does not recognise', () => {
    // The table has no CHECK constraint, on purpose. An unknown key is a future stage or a
    // typo, and treating it as progress marks a step complete that nobody performed.
    const placed = placeCandidate(candidate('c1'), [event('c1', 'coffee', '2026-09-18T09:00:00Z')], NOW);
    expect(placed.done).toEqual([]);
    expect(placed.waitingFor).toBe('form');
    expect(placed.daysWaiting).toBe(18);
  });

  it('takes the earliest of two events for one stage', () => {
    const placed = placeCandidate(
      candidate('c1'),
      [event('c1', 'form', '2026-09-18T09:00:00Z'), event('c1', 'form', '2026-09-05T09:00:00Z')],
      NOW,
    );
    expect(placed.waitingSince).toBe('2026-09-05T09:00:00Z');
  });

  it('does not count another candidate’s events', () => {
    const placed = placeCandidate(candidate('c1'), [event('c2', 'form', '2026-09-18T09:00:00Z')], NOW);
    expect(placed.done).toEqual([]);
  });
});

describe('leaving the funnel', () => {
  const allNine = (id: string) => STAGES.map(s => event(id, s.key, '2026-09-10T09:00:00Z'));

  it('is the LAST step, not signing up', () => {
    // Signup is step 4: the athlete row exists while the test, the analysis, the first plan
    // and the standing order are all still ahead. This is the half where people are lost.
    const placed = placeCandidate(
      candidate('c1', { athleteId: 'a1' }),
      ['form', 'intro_call', 'characterization', 'signup'].map(s => event('c1', s, '2026-09-10T09:00:00Z')),
      NOW,
    );
    expect(placed.status).toBe('live');
    expect(placed.waitingFor).toBe('test');
  });

  it('is joined once every step is recorded', () => {
    const placed = placeCandidate(candidate('c1', { athleteId: 'a1' }), allNine('c1'), NOW);
    expect(placed.status).toBe('joined');
    expect(placed.waitingFor).toBeNull();
    expect(placed.owner).toBeNull();
    expect(placed.stuck).toBe(false);
  });

  it('is archived when they said no, and an archived candidate is never stuck', () => {
    const placed = placeCandidate(
      candidate('c1', { archivedAt: '2026-09-06T09:00:00Z', archivedReason: 'מחיר' }),
      [event('c1', 'form', '2026-09-02T09:00:00Z')],
      NOW,
    );
    expect(placed.status).toBe('archived');
    expect(placed.archivedReason).toBe('מחיר');
    // Seventeen days of silence, and correctly not red: the people who said no must not sit
    // at the top of the board forever.
    expect(placed.daysWaiting).toBe(17);
    expect(placed.stuck).toBe(false);
  });

  it('hands back the ones who left, most recently first, so coming back is possible', () => {
    // The rows and not just the count: archiving is reversible and somebody who said no in
    // March keeps every step they already did, so a count with nothing behind it would force
    // a returning candidate to be typed in again from scratch.
    const board = buildFunnel({
      candidates: [
        candidate('march', { name: 'רון', archivedAt: '2026-03-04T09:00:00Z', archivedReason: 'מחיר' }),
        candidate('sept', { name: 'מיכל', archivedAt: '2026-09-15T09:00:00Z' }),
        candidate('live', { name: 'נועה' }),
      ],
      events: [],
      now: NOW,
    });
    expect(board.archived).toBe(2);
    expect(board.archivedCandidates.map(c => c.id)).toEqual(['sept', 'march']);
    expect(board.archivedCandidates[0].archivedAt).toBe('2026-09-15T09:00:00Z');
    expect(board.live).toBe(1);
    // And none of them appears in a column, which is the whole point of being off the board.
    expect(board.columns.flatMap(c => c.candidates).map(c => c.id)).toEqual(['live']);
  });
});

describe('the board', () => {
  const candidates = [
    // Waiting for the intro call, 17 days. Stuck, badly.
    candidate('stuck-call', { name: 'רון', goal: 'מרתון', source: 'instagram' }),
    // Waiting for the same call, 2 days. Also stuck, less so.
    candidate('newer-call', { name: 'מיכל', createdAt: '2026-09-17T08:00:00Z' }),
    // Waiting for the test, 2 days. Not stuck: seven days is the threshold.
    candidate('in-test', { name: 'נועה', athleteId: 'a2' }),
    candidate('gone', { name: 'עומר', archivedAt: '2026-09-05T09:00:00Z' }),
  ];
  const events = [
    event('stuck-call', 'form', '2026-09-02T09:00:00Z'),
    // Arrived through the form two days ago, so that step is already done — which is how a
    // form-sourced candidate enters the board at all. An Instagram DM with no form yet is the
    // one case that waits on `form`.
    event('newer-call', 'form', '2026-09-17T08:00:00Z'),
    ...['form', 'intro_call', 'characterization', 'signup'].map(s => event('in-test', s, '2026-09-17T09:00:00Z')),
  ];
  const board = buildFunnel({ candidates, events, now: NOW });

  it('counts who is on it and how many are stuck', () => {
    expect(board.live).toBe(3);
    expect(board.stuck).toBe(2);
    expect(board.archived).toBe(1);
    expect(board.joined).toBe(0);
  });

  it('returns a column per stage, empty ones included', () => {
    // An empty "waiting for the test" column is information — it is the shape of the funnel —
    // and columns that appear and vanish as people move cannot be read at a glance twice.
    expect(board.columns).toHaveLength(STAGES.length);
    expect(board.columns.map(c => c.spec.key)).toEqual(STAGES.map(s => s.key));
    expect(board.columns.find(c => c.spec.key === 'analysis')!.candidates).toEqual([]);
  });

  it('files each live candidate under what they are waiting for', () => {
    const column = (key: string) => board.columns.find(c => c.spec.key === key)!.candidates.map(c => c.name);
    expect(column('intro_call')).toEqual(['רון', 'מיכל']);
    expect(column('test')).toEqual(['נועה']);
  });

  it('keeps the archived candidate off it entirely', () => {
    expect(board.columns.flatMap(c => c.candidates).map(c => c.name)).not.toContain('עומר');
  });

  it('puts the longest wait first inside a column', () => {
    const column = board.columns.find(c => c.spec.key === 'intro_call')!;
    expect(column.candidates.map(c => c.daysWaiting)).toEqual([17, 2]);
  });

  it('puts a stuck candidate above a longer-waiting one who is not', () => {
    // Order is "who to deal with", not "who waited longest": ten days into a wait that allows
    // a fortnight is calmer than three days into one that allows two.
    const board2 = buildFunnel({
      candidates: [candidate('patient', { name: 'ארוך' }), candidate('late', { name: 'תקוע' })],
      events: [
        // 'patient' is 4 days into the test wait (threshold 7) — not stuck.
        ...['form', 'intro_call', 'characterization', 'signup'].map(s => event('patient', s, '2026-09-15T09:00:00Z')),
        // 'late' is 3 days into the characterization wait (threshold 3) — stuck.
        ...['form', 'intro_call'].map(s => event('late', s, '2026-09-16T09:00:00Z')),
      ],
      now: NOW,
    });
    const flat = board2.columns.flatMap(c => c.candidates);
    expect(flat.find(c => c.name === 'ארוך')!.stuck).toBe(false);
    expect(flat.find(c => c.name === 'תקוע')!.stuck).toBe(true);
  });
});

describe('the candidate card', () => {
  const rows = [
    event('c1', 'form', '2026-09-08T09:00:00Z'),
    event('c1', 'intro_call', '2026-09-09T09:00:00Z', { recordedBy: 'yossi@x.com', note: 'מאוד מתלהב' }),
    event('c1', 'form', '2026-09-20T09:00:00Z'),
  ];

  it('lists every step, done or not, in funnel order', () => {
    // The card's promise is that no step disappears — which is also what lets it become the
    // trainee's own history after they join.
    const steps = candidateTimeline(candidate('c1'), rows);
    expect(steps).toHaveLength(STAGES.length);
    expect(steps.map(s => s.spec.key)).toEqual(STAGES.map(s => s.key));
    expect(steps.filter(s => s.at !== null)).toHaveLength(2);
  });

  it('keeps who did it and what came out of it', () => {
    const call = candidateTimeline(candidate('c1'), rows).find(s => s.spec.key === 'intro_call')!;
    expect(call.recordedBy).toBe('yossi@x.com');
    expect(call.note).toBe('מאוד מתלהב');
  });

  it('prints a duplicated step once, at the earlier time', () => {
    const form = candidateTimeline(candidate('c1'), rows).filter(s => s.spec.key === 'form');
    expect(form).toHaveLength(1);
    expect(form[0].at).toBe('2026-09-08T09:00:00Z');
  });

  it('marks exactly one step as the open one', () => {
    const steps = candidateTimeline(candidate('c1'), rows);
    expect(steps.filter(s => s.current).map(s => s.spec.key)).toEqual(['characterization']);
  });

  it('marks nothing open once they left, and nothing open once they finished', () => {
    expect(candidateTimeline(candidate('c1', { archivedAt: '2026-09-10T09:00:00Z' }), rows).some(s => s.current)).toBe(false);
    const done = STAGES.map(s => event('c2', s.key, '2026-09-10T09:00:00Z'));
    expect(candidateTimeline(candidate('c2'), done).some(s => s.current)).toBe(false);
  });
});
