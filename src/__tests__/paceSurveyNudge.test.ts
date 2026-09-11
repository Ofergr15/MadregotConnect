import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The evening nudge for the recurring pace-group poll — and specifically who it
 * is allowed to bother.
 *
 * The poll asks which דבוקה you're running with tomorrow. The home page's RSVP
 * asks the same question, with the same options, twelve hours earlier — and it
 * is the one people actually use (one Friday: eight RSVPs with a group named, three
 * survey responses). Counting only `survey_responses` meant an athlete who chose
 * דבוקה 2 at 05:31 got a push at 15:00 asking them to answer, which does not read
 * as a reminder — it reads as the app not having heard them.
 *
 * So an RSVP counts as the answer, but only when it actually settled the
 * question: a named group, or a "not coming". A bare yes from the notification's
 * action button carries no `group_label` at all, and that athlete genuinely
 * hasn't said which group — they still get asked.
 */

/** athlete_id → what they answered in survey_responses. */
let responded: string[];
/** Every athlete in the club. */
let everyone: string[];
/** Who each push went to, in order. */
let pushedTo: string[];

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'survey_responses') {
        return {
          select: () => ({
            eq: async () => ({ data: responded.map((athlete_id) => ({ athlete_id })), error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/push', () => ({
  allAthleteIds: async () => everyone,
  subscriptionsForAthletes: async (ids: string[]) => ids.map((athlete_id) => ({ athlete_id })),
  sendPushLocalized: async (subs: { athlete_id: string }[]) => {
    pushedTo = subs.map((s) => s.athlete_id);
    return { sent: subs.length, byAthlete: {} };
  },
  resolveAudience: async () => [],
}));

const { notifySurveyNonResponders, rsvpSettlesPaceGroup } = await import('@/lib/surveys');

const nudge = (answeredElsewhere?: string[]) =>
  notifySurveyNonResponders({
    surveyId: 'survey-1',
    audienceType: 'all',
    copy: () => ({ title: 'poll', body: 'which group?' }),
    tag: 'paceSurveyNudge:2026-09-06:5',
    answeredElsewhere,
  });

beforeEach(() => {
  everyone = ['sahar', 'itai', 'dana'];
  responded = [];
  pushedTo = [];
});

describe('notifySurveyNonResponders', () => {
  it('nudges everyone who has not answered', async () => {
    expect(await nudge()).toBe(3);
    expect(pushedTo).toEqual(['sahar', 'itai', 'dana']);
  });

  it('never re-asks someone with a survey response', async () => {
    responded = ['itai'];
    expect(await nudge()).toBe(2);
    expect(pushedTo).not.toContain('itai');
  });

  it('treats an answer given elsewhere as an answer', async () => {
    // The bug, in one line: Sahar picked her group on the home page and was
    // nudged anyway, because the pick landed in workout_attendance.
    expect(await nudge(['sahar'])).toBe(2);
    expect(pushedTo).toEqual(['itai', 'dana']);
  });

  it('sends nothing at all when both sources are covered', async () => {
    responded = ['itai'];
    expect(await nudge(['sahar', 'dana'])).toBe(0);
    expect(pushedTo).toEqual([]);
  });

  it('counts someone who answered in both places once', async () => {
    responded = ['sahar'];
    expect(await nudge(['sahar'])).toBe(2);
  });
});

describe('rsvpSettlesPaceGroup', () => {
  it('accepts an RSVP that named a group', () => {
    expect(rsvpSettlesPaceGroup({ attending: true, group_label: 'דבוקה 2' })).toBe(true);
  });

  it('accepts a "not coming", which has no group to ask about', () => {
    expect(rsvpSettlesPaceGroup({ attending: false, group_label: null })).toBe(true);
  });

  it('still asks the bare yes from a notification button', () => {
    // The service worker's rsvp_yes action has no group picker behind it, so
    // this athlete is coming and hasn't said with whom.
    expect(rsvpSettlesPaceGroup({ attending: true, group_label: null })).toBe(false);
    expect(rsvpSettlesPaceGroup({ attending: true })).toBe(false);
  });
});
