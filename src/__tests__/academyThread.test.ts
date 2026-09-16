import { describe, it, expect } from 'vitest';
import {
  SILENT_DAYS,
  academyChannelId,
  awaitingReply,
  buildInbox,
  classify,
  lastActivityAt,
  rank,
  seatFor,
  snapshotFromMessages,
  toThreadMessages,
  type ThreadSnapshot,
} from '@/lib/academy/thread';

const NOW = '2026-09-16T12:00:00.000Z';
const now = new Date(NOW).getTime();

/** Hours before NOW, as an ISO string. */
function hoursAgo(h: number): string {
  return new Date(now - h * 3_600_000).toISOString();
}
function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

function snap(over: Partial<ThreadSnapshot> & { name?: string }): ThreadSnapshot {
  return {
    athleteId: over.athleteId ?? 'a1',
    name: over.name ?? 'Noa',
    lastTraineeMessageAt: null,
    lastStaffMessageAt: null,
    unreadCount: 0,
    ...over,
  };
}

describe('academyChannelId', () => {
  it('is parallel to the run-chat key so one Stream app serves both', () => {
    expect(academyChannelId('abc')).toBe('academy-abc');
  });
});

describe('awaitingReply', () => {
  it('is false when nobody has written', () => {
    expect(awaitingReply(snap({}))).toBe(false);
  });

  it('is false when only staff has written — nobody asked anything', () => {
    expect(awaitingReply(snap({ lastStaffMessageAt: hoursAgo(2) }))).toBe(false);
  });

  it('is true when the trainee wrote and staff never has', () => {
    expect(awaitingReply(snap({ lastTraineeMessageAt: hoursAgo(2) }))).toBe(true);
  });

  it('is true when the staff reply PREDATES the question', () => {
    // The rule that matters: "I replied last week" is not a reply to yesterday.
    expect(awaitingReply(snap({
      lastStaffMessageAt: daysAgo(7),
      lastTraineeMessageAt: hoursAgo(20),
    }))).toBe(true);
  });

  it('is false once staff answers after the question', () => {
    expect(awaitingReply(snap({
      lastTraineeMessageAt: hoursAgo(20),
      lastStaffMessageAt: hoursAgo(1),
    }))).toBe(false);
  });
});

describe('lastActivityAt', () => {
  it('is null in a thread nobody has used', () => {
    expect(lastActivityAt(snap({}))).toBeNull();
  });

  it('takes the most recent of the two sides, whichever it is', () => {
    const s = snap({ lastTraineeMessageAt: daysAgo(5), lastStaffMessageAt: daysAgo(1) });
    expect(lastActivityAt(s)).toBe(daysAgo(1));
    const t = snap({ lastTraineeMessageAt: daysAgo(1), lastStaffMessageAt: daysAgo(5) });
    expect(lastActivityAt(t)).toBe(daysAgo(1));
  });
});

describe('classify', () => {
  it('an unanswered question outranks everything else it also is', () => {
    // This row is simultaneously unread and awaiting a reply. Only one label can
    // be shown and it must be the one that names an obligation.
    const s = snap({ lastTraineeMessageAt: hoursAgo(3), unreadCount: 4 });
    expect(classify(s, now)).toBe('awaiting_reply');
  });

  it('a thread nobody has EVER written in is silent, not quiet', () => {
    expect(classify(snap({}), now)).toBe('silent');
  });

  it('goes silent at the threshold, not after it', () => {
    const s = snap({ lastStaffMessageAt: daysAgo(SILENT_DAYS) });
    expect(classify(s, now)).toBe('silent');
  });

  it('is not silent one hour short of the threshold', () => {
    const s = snap({ lastStaffMessageAt: hoursAgo(SILENT_DAYS * 24 - 1) });
    expect(classify(s, now)).not.toBe('silent');
  });

  it('a recent staff message with unread is unread', () => {
    const s = snap({ lastStaffMessageAt: hoursAgo(2), unreadCount: 2 });
    expect(classify(s, now)).toBe('unread');
  });

  it('a recent answered exchange with nothing unread is quiet', () => {
    const s = snap({ lastTraineeMessageAt: hoursAgo(5), lastStaffMessageAt: hoursAgo(4) });
    expect(classify(s, now)).toBe('quiet');
  });
});

describe('rank', () => {
  it('reports waiting hours only for an unanswered question', () => {
    const waiting = rank(snap({ lastTraineeMessageAt: hoursAgo(30) }), now);
    expect(waiting.waitingHours).toBeCloseTo(30, 5);
    expect(waiting.quietDays).toBeNull();

    // Not "waiting 0 hours" — nobody asked, and a 0 there reads as "just answered".
    const quiet = rank(snap({ lastTraineeMessageAt: hoursAgo(5), lastStaffMessageAt: hoursAgo(4) }), now);
    expect(quiet.waitingHours).toBeNull();
  });

  it('reports quiet days only for a silent thread, and null when it never started', () => {
    const dormant = rank(snap({ lastStaffMessageAt: daysAgo(30) }), now);
    expect(dormant.reason).toBe('silent');
    expect(dormant.quietDays).toBeCloseTo(30, 5);

    const never = rank(snap({}), now);
    expect(never.reason).toBe('silent');
    expect(never.quietDays).toBeNull();
  });

  it('a never-used thread sorts to the top of the silent band', () => {
    const never = rank(snap({}), now);
    const dormantForAges = rank(snap({ lastStaffMessageAt: daysAgo(900) }), now);
    expect(never.urgency).toBeGreaterThan(dormantForAges.urgency);
  });

  it('no magnitude promotes a row past its band', () => {
    // A thread silent for three years must still rank below the newest unanswered
    // question, because one of them is a person waiting and the other is not.
    const silentForever = rank(snap({ lastStaffMessageAt: daysAgo(1000) }), now);
    const justAsked = rank(snap({ lastTraineeMessageAt: hoursAgo(0.1) }), now);
    expect(justAsked.urgency).toBeGreaterThan(silentForever.urgency);

    // And a hundred unread messages must not outrank a dormant relationship.
    const loud = rank(snap({ lastStaffMessageAt: hoursAgo(1), unreadCount: 100_000 }), now);
    expect(silentForever.urgency).toBeGreaterThan(loud.urgency);
  });

  it('within awaiting_reply, the longest wait is first', () => {
    const old = rank(snap({ lastTraineeMessageAt: daysAgo(4) }), now);
    const fresh = rank(snap({ lastTraineeMessageAt: hoursAgo(1) }), now);
    expect(old.urgency).toBeGreaterThan(fresh.urgency);
  });
});

describe('buildInbox', () => {
  const snapshots: ThreadSnapshot[] = [
    snap({ athleteId: 'a1', name: 'Amit', lastStaffMessageAt: hoursAgo(1), unreadCount: 3 }),
    snap({ athleteId: 'a2', name: 'Dana', lastTraineeMessageAt: hoursAgo(2), lastStaffMessageAt: hoursAgo(1) }),
    snap({ athleteId: 'a3', name: 'Noa', lastTraineeMessageAt: daysAgo(3), lastStaffMessageAt: daysAgo(9) }),
    snap({ athleteId: 'a4', name: 'Yuval', lastStaffMessageAt: daysAgo(40) }),
  ];

  it('orders by obligation, not by recency', () => {
    const { rows } = buildInbox(snapshots, NOW);
    // Noa asked 3 days ago and the last staff word predates it → top.
    // Yuval's thread has been dead 40 days → next.
    // Amit has 3 unread but nothing is owed → third. Dana is answered → last.
    expect(rows.map(r => r.name)).toEqual(['Noa', 'Yuval', 'Amit', 'Dana']);
  });

  it('the loudest thread is not the first one', () => {
    // The whole reason this screen is not a recency-sorted list: Amit's thread is
    // the most recently active AND has the unread count, and he needs nothing.
    const { rows } = buildInbox(snapshots, NOW);
    expect(rows[0].name).not.toBe('Amit');
  });

  it('counts each reason once', () => {
    const { counts } = buildInbox(snapshots, NOW);
    expect(counts).toEqual({ awaiting_reply: 1, silent: 1, unread: 1, quiet: 1 });
  });

  it('needsAttention excludes unread, because the bell already means unread', () => {
    const { needsAttention } = buildInbox(snapshots, NOW);
    expect(needsAttention).toBe(2);
  });

  it('is stable and alphabetical inside an exact tie', () => {
    const tied = [
      snap({ athleteId: 'b', name: 'ב', lastTraineeMessageAt: hoursAgo(5) }),
      snap({ athleteId: 'a', name: 'א', lastTraineeMessageAt: hoursAgo(5) }),
    ];
    expect(buildInbox(tied, NOW).rows.map(r => r.name)).toEqual(['א', 'ב']);
  });

  it('handles an empty academy without inventing rows', () => {
    const empty = buildInbox([], NOW);
    expect(empty.rows).toEqual([]);
    expect(empty.needsAttention).toBe(0);
  });
});

describe('snapshotFromMessages', () => {
  const T = 'noa';
  const msg = (who: string, at: string) => ({ user: { id: who }, created_at: at });

  it('separates the trainee from every staff seat', () => {
    const s = snapshotFromMessages(T, 'Noa', [
      msg('yossi', '2026-09-07T17:00:00.000Z'),
      msg(T, '2026-09-08T18:00:00.000Z'),
      msg('ofer', '2026-09-12T06:00:00.000Z'),
      msg(T, '2026-09-13T15:00:00.000Z'),
    ], 2);
    expect(s.lastTraineeMessageAt).toBe('2026-09-13T15:00:00.000Z');
    // The manager's message is the last STAFF word even though a coach also wrote:
    // there is no manager role in this app, so both sides collapse into "not them".
    expect(s.lastStaffMessageAt).toBe('2026-09-12T06:00:00.000Z');
    expect(s.unreadCount).toBe(2);
  });

  it('does not assume the messages arrived in order', () => {
    const s = snapshotFromMessages(T, 'Noa', [
      msg(T, '2026-09-13T15:00:00.000Z'),
      msg(T, '2026-09-01T15:00:00.000Z'),
      msg('yossi', '2026-09-02T15:00:00.000Z'),
      msg('yossi', '2026-09-12T15:00:00.000Z'),
    ], 0);
    expect(s.lastTraineeMessageAt).toBe('2026-09-13T15:00:00.000Z');
    expect(s.lastStaffMessageAt).toBe('2026-09-12T15:00:00.000Z');
  });

  it('accepts the flat user_id shape as well as the nested one', () => {
    const s = snapshotFromMessages(T, 'Noa', [
      { user_id: T, created_at: '2026-09-13T15:00:00.000Z' },
    ], 0);
    expect(s.lastTraineeMessageAt).toBe('2026-09-13T15:00:00.000Z');
  });

  it('skips messages with no usable timestamp instead of poisoning the sort', () => {
    const s = snapshotFromMessages(T, 'Noa', [
      { user: { id: T }, created_at: null },
      { user: { id: T }, created_at: 'not a date' },
      msg(T, '2026-09-13T15:00:00.000Z'),
    ], 0);
    expect(s.lastTraineeMessageAt).toBe('2026-09-13T15:00:00.000Z');
  });

  it('reads an empty channel as a thread nobody has used', () => {
    const s = snapshotFromMessages(T, 'Noa', [], 0);
    expect(s.lastTraineeMessageAt).toBeNull();
    expect(s.lastStaffMessageAt).toBeNull();
    // Which classify() must call silent, not quiet — the strongest version of the
    // problem, not the absence of one.
    expect(classify(s, Date.parse('2026-09-16T12:00:00.000Z'))).toBe('silent');
  });

  it('is correct on a truncated window: staff older than the window still awaits', () => {
    // The route asks Stream for the last N messages. If the coach's reply fell out
    // of that window, the trainee still spoke last and is still owed an answer.
    const s = snapshotFromMessages(T, 'Noa', [msg(T, '2026-09-13T15:00:00.000Z')], 0);
    expect(s.lastStaffMessageAt).toBeNull();
    expect(awaitingReply(s)).toBe(true);
  });
});

/** The trainee whose thread it is. Same id the block above uses, scoped for these. */
const T = 'noa';

describe('seatFor', () => {
  it('separates the mentor from every other staff seat', () => {
    expect(seatFor(T, T, 'mentor-1')).toBe('trainee');
    expect(seatFor('mentor-1', T, 'mentor-1')).toBe('coach');
    expect(seatFor('admin-9', T, 'mentor-1')).toBe('manager');
  });

  it('reads an unpaired trainee`s staff messages as the manager', () => {
    // Nobody is assigned, so nobody can be the coach. The alternative — defaulting to
    // 'coach' — would label an admin as this trainee's mentor on screen.
    expect(seatFor('admin-9', T, null)).toBe('manager');
  });

  it('never calls an unknown author the trainee', () => {
    // A deleted or system author must not be given the trainee's own bubble side,
    // which is what "mine" is decided from.
    expect(seatFor(null, T, 'mentor-1')).toBe('manager');
  });
});

describe('toThreadMessages', () => {
  const opts = { athleteId: T, mentorId: 'mentor-1' };
  const m = (over: Record<string, unknown>) => ({
    id: 'm1', text: 'שלום', created_at: '2026-09-14T10:00:00.000Z',
    user: { id: T, name: 'נועה' }, ...over,
  });

  it('orders oldest first regardless of what Stream handed back', () => {
    const out = toThreadMessages([
      m({ id: 'b', created_at: '2026-09-15T10:00:00.000Z' }),
      m({ id: 'a', created_at: '2026-09-14T10:00:00.000Z' }),
    ], opts);
    expect(out.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('keeps a message that is only a feedback card', () => {
    const fb = { type: 'academy_feedback', version: 1, workout_date: '2026-09-14', activity_id: null, workout_name: null, feedback: {} };
    const out = toThreadMessages([m({ text: '', academy_feedback: fb })], opts);
    expect(out).toHaveLength(1);
    expect(out[0].feedback).toBe(fb);
  });

  it('drops a message with neither text nor a card', () => {
    expect(toThreadMessages([m({ text: '   ' })], opts)).toEqual([]);
  });

  it('drops the role suffix Stream carries on the display name', () => {
    // The token route sets "Name · role" so run-chat can show it. Here the seat badge
    // already says it, and printing both gives "יוסי · מאמן" beside a coach label.
    const out = toThreadMessages([m({ user: { id: 'mentor-1', name: 'יוסי · מאמן' } })], opts);
    expect(out[0].authorName).toBe('יוסי');
    expect(out[0].seat).toBe('coach');
  });

  it('skips anything unusable rather than rendering a broken bubble', () => {
    expect(toThreadMessages([
      m({ id: null }),
      m({ created_at: null }),
      m({ created_at: 'not a date' }),
    ], opts)).toEqual([]);
  });
});
