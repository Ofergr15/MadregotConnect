import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Screen 6's "השיחה על האימון הזה" (trainee-experience-v2): a message sent from a workout
 * carries its date as a Stream custom field, and GET ?workoutDate= answers with the
 * coach's review of that day first, then the last two messages tagged with it.
 */

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: caller() }) }));
vi.mock('@/lib/academy/pairing-server', () => ({ isAcademyManager: () => false }));
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => ['sahar'] }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => undefined }));

const sent: Array<Record<string, unknown>> = [];
let channelMessages: unknown[] = [];
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    queryChannels: async () => [{ state: { messages: channelMessages } }],
    channel: () => ({ sendMessage: async (m: Record<string, unknown>) => { sent.push(m); return { message: { id: 'new' } }; } }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { id: 'shahar', name: 'Shahar Glazner', is_academy: true, academy_coach_id: 'sahar' }, error: null }),
      };
      return q;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/academy/threads/messages/route');
const { messagesForWorkout, toThreadMessages } = await import('@/lib/academy/thread');

const review = (date: string, at: string) => ({
  id: `fb-${date}`, text: '', created_at: at, user: { id: 'sahar', name: 'Sahar' },
  academy_feedback: {
    type: 'academy_feedback', version: 1, workout_date: date, activity_id: null, workout_name: '5 × 1 ק״מ',
    feedback: { execution: ['on_plan'], effort: null, action: 'keep', lapComments: [], note: 'חזרות יציבות', sentAt: at },
  },
});
const msg = (id: string, user: string, text: string, at: string, workout_date?: string) =>
  ({ id, text, created_at: at, user: { id: user, name: user }, ...(workout_date ? { workout_date } : {}) });

beforeEach(() => {
  sent.length = 0;
  caller.mockReturnValue({ athleteId: 'shahar', isStaff: false, isSuperUser: false, role: 'runner' });
  channelMessages = [
    msg('m0', 'shahar', 'unrelated', '2026-10-10T08:00:00Z'),
    review('2026-10-13', '2026-10-13T09:00:00Z'),
    msg('m1', 'shahar', 'first', '2026-10-13T09:10:00Z', '2026-10-13'),
    msg('m2', 'shahar', 'האחרונה הרגישה קלה מדי', '2026-10-13T09:20:00Z', '2026-10-13'),
    msg('m3', 'sahar', 'רואה! שיא', '2026-10-13T09:30:00Z', '2026-10-13'),
    msg('m4', 'sahar', 'other day', '2026-10-13T10:00:00Z', '2026-10-11'),
    review('2026-10-11', '2026-10-11T09:00:00Z'),
  ];
});

describe('messagesForWorkout', () => {
  it('the review of that day first, then the last two messages about it', () => {
    const all = toThreadMessages(channelMessages as never, { athleteId: 'shahar', mentorId: ['sahar'] });
    expect(messagesForWorkout(all, '2026-10-13').map(m => m.id)).toEqual(['fb-2026-10-13', 'm2', 'm3']);
    expect(messagesForWorkout(all, '2026-10-12')).toEqual([]);
  });

  it('a message carries the day it was sent from; the review carries its own', () => {
    const all = toThreadMessages(channelMessages as never, { athleteId: 'shahar', mentorId: ['sahar'] });
    expect(all.find(m => m.id === 'm2')?.workoutDate).toBe('2026-10-13');
    expect(all.find(m => m.id === 'fb-2026-10-11')?.workoutDate).toBe('2026-10-11');
    expect(all.find(m => m.id === 'm0')?.workoutDate).toBeNull();
  });
});

describe('GET ?workoutDate=', () => {
  it('filters the thread to that workout', async () => {
    const body = await (await GET(new Request('http://x/api/academy/threads/messages?athleteId=shahar&workoutDate=2026-10-13'))).json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['fb-2026-10-13', 'm2', 'm3']);
  });

  it('without it, the whole thread as before', async () => {
    const body = await (await GET(new Request('http://x/api/academy/threads/messages?athleteId=shahar'))).json();
    expect(body.messages).toHaveLength(7);
  });

  it('refuses a date that is not a date', async () => {
    expect((await GET(new Request('http://x/api/academy/threads/messages?athleteId=shahar&workoutDate=13.10'))).status).toBe(400);
  });
});

describe('POST workoutDate', () => {
  const post = (body: Record<string, unknown>) => POST(new Request('http://x/api/academy/threads/messages', { method: 'POST', body: JSON.stringify(body) }));

  it('stores the workout\'s date as a custom field on the message', async () => {
    expect((await post({ athleteId: 'shahar', text: 'שאלה', workoutDate: '2026-10-13' })).status).toBe(200);
    expect(sent[0]).toMatchObject({ text: 'שאלה', user_id: 'shahar', workout_date: '2026-10-13' });
  });

  it('a message without one (or with a malformed one) carries none', async () => {
    await post({ athleteId: 'shahar', text: 'hi' });
    await post({ athleteId: 'shahar', text: 'hi', workoutDate: 'yesterday' });
    expect(sent.every(m => !('workout_date' in m))).toBe(true);
  });
});
