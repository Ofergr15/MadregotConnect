import { describe, expect, it } from 'vitest';
import {
  ATTENTION_ORDER,
  INACTIVE_DAYS,
  LOW_ADHERENCE,
  completionRateOf,
  deriveAttention,
  emptyTeamTotals,
  rollupBands,
  rollupCoaches,
  rollupGroups,
  rollupTeam,
  type AcademyMember,
  type AttentionInput,
} from '@/lib/academy/members';
import {
  MAX_PACE_OFFSET_SEC, MIN_PACE_OFFSET_SEC,
  bandLevel, canResolvePaces, effectiveOffsetSec, fmtOffsetSec, isValidPaceOffset,
  offsetSource, sortBands, toBand, type AcademyBand,
} from '@/lib/academy/bands';
import { fmtRate, rateColor, shiftWeek, sundayOf, initialsOf, fmtWeekRange } from '@/components/academy/types';

// Coverage for the academy centre's judgement calls — the rules that decide
// which member a coach gets sent after, and what the academy's headline number
// says. All pure; no Supabase involved.

const attn = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  approved: true,
  hasWatch: true,
  daysSinceActivity: 1,
  weekRuns: 3,
  plannedCount: 4,
  completionRate: 1,
  ...over,
});

const band = (over: Partial<AcademyBand> = {}): AcademyBand => ({
  id: 'b7',
  bandNumber: 7,
  name: 'דבוקה 7',
  goal: 'הכנה לחצי מרתון',
  paceProfile: { marathonGoal: 'HALF', offsetSeconds: 30 },
  ...over,
});

const member = (over: Partial<AcademyMember> = {}): AcademyMember => ({
  athleteId: 'a1',
  name: 'Athlete',
  email: 'a@example.com',
  avatarUrl: null,
  groupId: 'g1',
  groupName: 'Group 1',
  academyCoachId: null,
  academyCoachName: null,
  band: band(),
  paceOffsetSec: null,
  status: 'active',
  role: 'academy_user',
  approved: true,
  hasWatch: true,
  hasGarmin: true,
  hasStrava: false,
  joinedAt: null,
  academyJoinedOn: null,
  weekKm: 10,
  weekRuns: 3,
  weekDurationMin: 60,
  totalKm: 100,
  totalRuns: 30,
  lastActivityAt: '2026-08-31T06:00:00Z',
  daysSinceActivity: 1,
  plannedCount: 4,
  completedCount: 4,
  completionRate: 1,
  attention: [],
  ...over,
});

describe('completionRateOf', () => {
  it('returns null when nothing was planned, not 0', () => {
    // "We never gave them a plan" and "they did none of their plan" are
    // different problems; rendering both as 0% sends the coach after the wrong
    // person.
    expect(completionRateOf(0, 0)).toBeNull();
  });

  it('returns a real 0 when a plan existed and nothing was done', () => {
    expect(completionRateOf(4, 0)).toBe(0);
  });

  it('divides completed by planned', () => {
    expect(completionRateOf(4, 3)).toBe(0.75);
  });
});

describe('deriveAttention', () => {
  it('flags nothing for a connected, approved, on-plan member', () => {
    expect(deriveAttention(attn())).toEqual([]);
  });

  it('flags an unapproved member', () => {
    expect(deriveAttention(attn({ approved: false }))).toContain('not_approved');
  });

  it('flags a member with neither watch connected', () => {
    expect(deriveAttention(attn({ hasWatch: false }))).toContain('no_watch');
  });

  it('treats never-active as inactive', () => {
    expect(deriveAttention(attn({ daysSinceActivity: null }))).toContain('inactive');
  });

  it('flags inactive at the threshold, not just past it', () => {
    expect(deriveAttention(attn({ daysSinceActivity: INACTIVE_DAYS }))).toContain('inactive');
    expect(deriveAttention(attn({ daysSinceActivity: INACTIVE_DAYS - 1, weekRuns: 2 }))).not.toContain('inactive');
  });

  it('does not report both inactive and no_runs for the same silence', () => {
    // One underlying fact — a member who hasn't run in a month has also not run
    // this week — must not list the same person twice under two headings.
    const reasons = deriveAttention(attn({ daysSinceActivity: 30, weekRuns: 0 }));
    expect(reasons).toContain('inactive');
    expect(reasons).not.toContain('no_runs');
  });

  it('reports no_runs for a recently-active member who skipped this week', () => {
    const reasons = deriveAttention(attn({ daysSinceActivity: 8, weekRuns: 0, completionRate: 1 }));
    expect(reasons).toContain('no_runs');
    expect(reasons).not.toContain('inactive');
  });

  it('does not report low_adherence when there was no plan to adhere to', () => {
    const reasons = deriveAttention(attn({ plannedCount: 0, completionRate: null }));
    expect(reasons).toContain('no_plan');
    expect(reasons).not.toContain('low_adherence');
  });

  it('flags low adherence strictly below the threshold', () => {
    expect(deriveAttention(attn({ completionRate: LOW_ADHERENCE - 0.01 }))).toContain('low_adherence');
    expect(deriveAttention(attn({ completionRate: LOW_ADHERENCE }))).not.toContain('low_adherence');
  });

  it('flags an approved trainee with no dedicated coach', () => {
    expect(deriveAttention(attn({ hasCoach: false, academyHasCoaches: true }))).toContain('no_coach');
  });

  it('stays silent about pairing before the academy has any coach to pair with', () => {
    // Otherwise a fresh academy flags all twenty-six trainees for what is one
    // setup task. The directory says it once, in the banner.
    expect(deriveAttention(attn({ hasCoach: false, academyHasCoaches: false }))).not.toContain('no_coach');
    expect(deriveAttention(attn({ hasCoach: false }))).not.toContain('no_coach');
  });

  it('does not ask for a coach for someone whose registration is unreviewed', () => {
    // `not_approved` already has the manager's attention, and pairing a trainee
    // who may yet be rejected is premature.
    const reasons = deriveAttention(attn({ approved: false, hasCoach: false, academyHasCoaches: true }));
    expect(reasons).toContain('not_approved');
    expect(reasons).not.toContain('no_coach');
  });

  it('flags an approved trainee with no goal band', () => {
    // Without a band there are no paces to resolve, so the planner cannot send
    // them a workout even though somebody is responsible for them.
    expect(deriveAttention(attn({ hasBand: false }))).toContain('no_band');
    expect(deriveAttention(attn({ hasBand: true }))).not.toContain('no_band');
  });

  it('stays silent about the band when the route did not evaluate it', () => {
    // An unmigrated schema, or an academy with no bands defined: one setup task,
    // not one flag per trainee.
    expect(deriveAttention(attn())).not.toContain('no_band');
  });

  it('does not ask for a band for someone whose registration is unreviewed', () => {
    const reasons = deriveAttention(attn({ approved: false, hasBand: false }));
    expect(reasons).toContain('not_approved');
    expect(reasons).not.toContain('no_band');
  });

  it('reports reasons in severity order, so a one-badge row shows the worst', () => {
    const reasons = deriveAttention(attn({
      approved: false, hasWatch: false, daysSinceActivity: null, plannedCount: 0, completionRate: null,
    }));
    const positions = reasons.map((r) => ATTENTION_ORDER.indexOf(r));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(reasons[0]).toBe('not_approved');
  });

  it('has a style-order entry for every reason it can emit', () => {
    // Guards the `reason_*` translation keys and the badge palette from drifting
    // out of sync with the rules: any new reason must be added to the order.
    const everyReason = new Set([
      ...deriveAttention(attn({ approved: false, hasWatch: false, daysSinceActivity: null, plannedCount: 0, completionRate: null })),
      ...deriveAttention(attn({ daysSinceActivity: 8, weekRuns: 0 })),
      ...deriveAttention(attn({ completionRate: 0.1 })),
      ...deriveAttention(attn({ hasCoach: false, academyHasCoaches: true })),
      ...deriveAttention(attn({ hasBand: false })),
    ]);
    for (const r of everyReason) expect(ATTENTION_ORDER).toContain(r);
    expect(ATTENTION_ORDER).toHaveLength(8);
  });
});

describe('rollupGroups', () => {
  it('buckets unassigned members instead of dropping them, and sorts them last', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', groupId: null, groupName: null }),
      member({ athleteId: '2', groupId: null, groupName: null }),
      member({ athleteId: '3', groupId: 'g1', groupName: 'Group 1' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].groupId).toBe('g1');
    expect(groups[groups.length - 1].groupId).toBeNull();
    expect(groups[groups.length - 1].members).toBe(2);
  });

  it('sorts named groups by size', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', groupId: 'small', groupName: 'Small' }),
      member({ athleteId: '2', groupId: 'big', groupName: 'Big' }),
      member({ athleteId: '3', groupId: 'big', groupName: 'Big' }),
    ]);
    expect(groups.map((g) => g.groupId)).toEqual(['big', 'small']);
  });

  it("weights a group's adherence by planned sessions, not by member", () => {
    // 1 of 1 and 1 of 5 is 2/6, not the 60% a mean of 100% and 20% would give.
    const groups = rollupGroups([
      member({ athleteId: '1', plannedCount: 1, completedCount: 1 }),
      member({ athleteId: '2', plannedCount: 5, completedCount: 1 }),
    ]);
    expect(groups[0].completionRate).toBeCloseTo(2 / 6);
  });

  it('reports a null rate for a group nobody planned for', () => {
    const groups = rollupGroups([member({ plannedCount: 0, completedCount: 0 })]);
    expect(groups[0].completionRate).toBeNull();
  });

  it('sums weekly km without float drift', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', weekKm: 0.1 }),
      member({ athleteId: '2', weekKm: 0.2 }),
    ]);
    expect(groups[0].weekKm).toBe(0.3);
  });
});

describe('rollupCoaches', () => {
  it('keeps a coach who holds nobody, because spare hours are the point of the view', () => {
    const coaches = rollupCoaches(
      [member({ athleteId: '1', academyCoachId: 'c1', academyCoachName: 'Anat' })],
      [{ coachId: 'c1', coachName: 'Anat' }, { coachId: 'c2', coachName: 'Dror' }],
    );
    expect(coaches.map((c) => c.coachId)).toEqual(['c1', 'c2']);
    expect(coaches[1].trainees).toBe(0);
    expect(coaches[1].completionRate).toBeNull();
  });

  it('names a coach met only through a member, rather than pooling them as unpaired', () => {
    const coaches = rollupCoaches([
      member({ athleteId: '1', academyCoachId: 'ghost', academyCoachName: 'Yael' }),
    ]);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]).toMatchObject({ coachId: 'ghost', coachName: 'Yael', trainees: 1 });
  });

  it('buckets unpaired trainees separately and sorts them last', () => {
    const coaches = rollupCoaches(
      [
        member({ athleteId: '1' }),
        member({ athleteId: '2' }),
        member({ athleteId: '3', academyCoachId: 'c1', academyCoachName: 'Anat' }),
      ],
      [{ coachId: 'c1', coachName: 'Anat' }],
    );
    expect(coaches[0].coachId).toBe('c1');
    expect(coaches[coaches.length - 1].coachId).toBeNull();
    expect(coaches[coaches.length - 1].trainees).toBe(2);
  });

  it('sorts caseloads by size, then by name', () => {
    const coaches = rollupCoaches(
      [
        member({ athleteId: '1', academyCoachId: 'busy', academyCoachName: 'Busy' }),
        member({ athleteId: '2', academyCoachId: 'busy', academyCoachName: 'Busy' }),
        member({ athleteId: '3', academyCoachId: 'zoe', academyCoachName: 'Zoe' }),
      ],
      [{ coachId: 'busy', coachName: 'Busy' }, { coachId: 'zoe', coachName: 'Zoe' }, { coachId: 'ada', coachName: 'Ada' }],
    );
    expect(coaches.map((c) => c.coachId)).toEqual(['busy', 'zoe', 'ada']);
  });

  it("counts the trainees the coach cannot yet be given a plan for", () => {
    // A caseload where nobody's paces resolve is a coach who can't be sent to
    // the planner at all, which is worth surfacing next to their name.
    const coaches = rollupCoaches([
      // Their own override — resolvable whatever the band says.
      member({ athleteId: '1', academyCoachId: 'c1', academyCoachName: 'Anat', paceOffsetSec: 45, band: band({ paceProfile: {} }) }),
      // No band at all.
      member({ athleteId: '2', academyCoachId: 'c1', academyCoachName: 'Anat', band: null }),
      // In a band whose paces the manager hasn't set yet.
      member({ athleteId: '3', academyCoachId: 'c1', academyCoachName: 'Anat', band: band({ paceProfile: { marathonGoal: 'HALF' } }) }),
    ]);
    expect(coaches[0].trainees).toBe(3);
    expect(coaches[0].unpaced).toBe(2);
  });

  it('does not count a +0 override as unpaced', () => {
    // 0 is a decision — "runs exactly at the pace as written" — and treating it
    // as missing would send the coach chasing a setting that is already made.
    const coaches = rollupCoaches([
      member({ athleteId: '1', academyCoachId: 'c1', academyCoachName: 'Anat', paceOffsetSec: 0, band: null }),
    ]);
    expect(coaches[0].unpaced).toBe(0);
  });

  it("weights a coach's adherence by planned sessions, not by trainee", () => {
    const coaches = rollupCoaches([
      member({ athleteId: '1', academyCoachId: 'c1', academyCoachName: 'Anat', plannedCount: 1, completedCount: 1 }),
      member({ athleteId: '2', academyCoachId: 'c1', academyCoachName: 'Anat', plannedCount: 5, completedCount: 1 }),
    ]);
    expect(coaches[0].completionRate).toBeCloseTo(2 / 6);
  });

  it('returns the roster alone for an academy with no members yet', () => {
    // The route's empty-roster short circuit takes this path, and the filter
    // chips must not vanish just because nobody is enrolled.
    const coaches = rollupCoaches([], [{ coachId: 'c1', coachName: 'Anat' }]);
    expect(coaches).toEqual([
      { coachId: 'c1', coachName: 'Anat', trainees: 0, unpaced: 0, weekKm: 0, completionRate: null },
    ]);
  });
});

describe('rollupTeam', () => {
  it('counts only members who actually ran as active', () => {
    const team = rollupTeam([
      member({ athleteId: '1', weekRuns: 2 }),
      member({ athleteId: '2', weekRuns: 0 }),
    ]);
    expect(team.members).toBe(2);
    expect(team.activeThisWeek).toBe(1);
  });

  it('counts members with any attention flag once, regardless of how many', () => {
    const team = rollupTeam([
      member({ athleteId: '1', attention: ['no_watch', 'inactive', 'no_plan'] }),
      member({ athleteId: '2', attention: [] }),
    ]);
    expect(team.needsAttention).toBe(1);
  });

  it('weights club adherence by planned sessions, not by athlete', () => {
    const team = rollupTeam([
      member({ athleteId: '1', plannedCount: 1, completedCount: 1 }),
      member({ athleteId: '2', plannedCount: 5, completedCount: 1 }),
    ]);
    expect(team.planned).toBe(6);
    expect(team.completed).toBe(2);
    expect(team.completionRate).toBeCloseTo(2 / 6);
  });

  it('reports a null rate rather than 0% when the academy has no plans', () => {
    const team = rollupTeam([member({ plannedCount: 0, completedCount: 0 })]);
    expect(team.completionRate).toBeNull();
  });

  it('counts connected and approved separately', () => {
    const team = rollupTeam([
      member({ athleteId: '1', hasWatch: false, approved: true }),
      member({ athleteId: '2', hasWatch: true, approved: false }),
    ]);
    expect(team.connected).toBe(1);
    expect(team.approved).toBe(1);
  });
});

describe('emptyTeamTotals', () => {
  it('matches the shape rollupTeam returns for an empty academy', () => {
    // The route short-circuits on an empty roster; the two shapes must agree or
    // the overview renders undefined tiles for a brand-new academy.
    expect(emptyTeamTotals()).toEqual(rollupTeam([]));
  });
});

describe('academy bands', () => {
  it('accepts whole-second offsets inside the range migration 077 allows', () => {
    expect(isValidPaceOffset(0)).toBe(true);
    expect(isValidPaceOffset(45)).toBe(true);
    expect(isValidPaceOffset(MIN_PACE_OFFSET_SEC)).toBe(true);
    expect(isValidPaceOffset(MAX_PACE_OFFSET_SEC)).toBe(true);
  });

  it('rejects anything the CHECK constraint would reject on write', () => {
    // The endpoint validates with this before touching Postgres, so a gap here
    // becomes a 500 from the database instead of a message the coach can read.
    expect(isValidPaceOffset(MIN_PACE_OFFSET_SEC - 1)).toBe(false);
    expect(isValidPaceOffset(MAX_PACE_OFFSET_SEC + 1)).toBe(false);
    expect(isValidPaceOffset(15.5)).toBe(false);
    expect(isValidPaceOffset('30')).toBe(false);
    expect(isValidPaceOffset(null)).toBe(false);
    expect(isValidPaceOffset(undefined)).toBe(false);
    expect(isValidPaceOffset(NaN)).toBe(false);
  });

  it("prefers the trainee's own override over their band", () => {
    expect(effectiveOffsetSec(90, band({ paceProfile: { offsetSeconds: 30 } }))).toBe(90);
  });

  it('falls back to the band when the trainee has no override', () => {
    expect(effectiveOffsetSec(null, band({ paceProfile: { offsetSeconds: 30 } }))).toBe(30);
    expect(effectiveOffsetSec(undefined, band({ paceProfile: { offsetSeconds: 30 } }))).toBe(30);
  });

  it('treats a stored 0 as a real answer, not as missing', () => {
    // The safety property the whole two-tier model rests on: "runs exactly at
    // the pace as written" must not collapse into "follows the band", or an
    // override of +0 would silently re-pace to the band's own offset.
    expect(effectiveOffsetSec(0, band({ paceProfile: { offsetSeconds: 30 } }))).toBe(0);
    expect(effectiveOffsetSec(0, null)).toBe(0);
    expect(canResolvePaces(0, null)).toBe(true);
  });

  it('resolves to null when nobody has said what this trainee runs', () => {
    // Not 0. The planner refuses to re-pace on null rather than send a workout
    // written for a sub-3 marathoner to someone starting from zero.
    expect(effectiveOffsetSec(null, null)).toBeNull();
    expect(effectiveOffsetSec(null, band({ paceProfile: {} }))).toBeNull();
    expect(effectiveOffsetSec(null, band({ paceProfile: { marathonGoal: 'HALF' } }))).toBeNull();
    expect(canResolvePaces(null, band({ paceProfile: {} }))).toBe(false);
  });

  it('names where an offset came from, so an edit says what it will move', () => {
    expect(offsetSource(45, band())).toBe('athlete');
    expect(offsetSource(0, band())).toBe('athlete');
    expect(offsetSource(null, band({ paceProfile: { offsetSeconds: 0 } }))).toBe('band');
    expect(offsetSource(null, band({ paceProfile: {} }))).toBe('unset');
    expect(offsetSource(null, null)).toBe('unset');
  });

  it('derives a band level from its offset, and honours a stored one', () => {
    expect(bandLevel(band({ paceProfile: { offsetSeconds: 0 } }))).toBe('fast');
    expect(bandLevel(band({ paceProfile: { offsetSeconds: 15 } }))).toBe('medium');
    expect(bandLevel(band({ paceProfile: { offsetSeconds: 120 } }))).toBe('slow');
    expect(bandLevel(band({ paceProfile: { offsetSeconds: 120, level: 'fast' } }))).toBe('fast');
  });

  it('has no level for a band whose paces are unset', () => {
    expect(bandLevel(band({ paceProfile: {} }))).toBeNull();
    expect(bandLevel(null)).toBeNull();
  });

  it('signs an offset with a real minus so RTL bidi cannot eat it', () => {
    expect(fmtOffsetSec(0)).toBe('0');
    expect(fmtOffsetSec(30)).toBe('+30');
    // U+2212, not a hyphen.
    expect(fmtOffsetSec(-8)).toBe('−8');
  });

  it('orders bands the way the academy counts them', () => {
    const sorted = sortBands([
      band({ id: '9', bandNumber: 9 }),
      band({ id: '4', bandNumber: 4 }),
      band({ id: '7', bandNumber: 7 }),
    ]);
    expect(sorted.map((b) => b.bandNumber)).toEqual([4, 7, 9]);
  });

  it('does not mutate the list it was given', () => {
    const list = [band({ id: '9', bandNumber: 9 }), band({ id: '4', bandNumber: 4 })];
    sortBands(list);
    expect(list.map((b) => b.bandNumber)).toEqual([9, 4]);
  });

  it('maps a row from academy_bands into the client shape', () => {
    expect(toBand({
      id: 'b1', band_number: 4, name: 'דבוקה 4', goal: 'מרתון סאב 3',
      pace_profile: { marathonGoal: 'SUB3', offsetSeconds: 0 },
    })).toEqual({
      id: 'b1', bandNumber: 4, name: 'דבוקה 4', goal: 'מרתון סאב 3',
      paceProfile: { marathonGoal: 'SUB3', offsetSeconds: 0 },
    });
  });

  it('tolerates a pace_profile that is not an object', () => {
    // JSONB with a `{}` default, but nothing stops a hand-written SQL edit — and
    // reading `.offsetSeconds` off a string would throw on the server.
    expect(toBand({ id: 'b', band_number: 6, name: 'ד6', pace_profile: null }).paceProfile).toEqual({});
    expect(toBand({ id: 'b', band_number: 6, name: 'ד6', pace_profile: 'fast' }).paceProfile).toEqual({});
    expect(toBand({ id: 'b', band_number: 6, name: 'ד6', pace_profile: [1] }).paceProfile).toEqual({});
    expect(toBand({ id: 'b', band_number: 6, name: 'ד6' }).paceProfile).toEqual({});
    expect(toBand({ id: 'b', band_number: 6, name: 'ד6' }).goal).toBeNull();
  });
});

describe('rollupBands', () => {
  it('keeps a band nobody is in, because it is still assignable', () => {
    const bands = rollupBands([], [band({ id: 'b4', bandNumber: 4 }), band({ id: 'b9', bandNumber: 9 })]);
    expect(bands.map((b) => b.id)).toEqual(['b4', 'b9']);
    expect(bands.every((b) => b.trainees === 0)).toBe(true);
  });

  it('counts trainees per band', () => {
    const bands = rollupBands(
      [
        member({ athleteId: '1', band: band({ id: 'b4', bandNumber: 4 }) }),
        member({ athleteId: '2', band: band({ id: 'b4', bandNumber: 4 }) }),
        member({ athleteId: '3', band: band({ id: 'b9', bandNumber: 9 }) }),
      ],
      [band({ id: 'b4', bandNumber: 4 }), band({ id: 'b9', bandNumber: 9 })],
    );
    expect(bands.map((b) => b.trainees)).toEqual([2, 1]);
  });

  it('reports bands in band-number order regardless of size', () => {
    // Unlike coaches, these are not sorted by load: the numbers are how the
    // academy refers to them, so 4 always comes before 9.
    const bands = rollupBands(
      [member({ athleteId: '1', band: band({ id: 'b9', bandNumber: 9 }) })],
      [band({ id: 'b9', bandNumber: 9 }), band({ id: 'b4', bandNumber: 4 })],
    );
    expect(bands.map((b) => b.bandNumber)).toEqual([4, 9]);
  });

  it('has no bucket for unbanded trainees', () => {
    // "No band" is an attention reason on the trainee, not a band of its own —
    // otherwise the picker would offer it as somewhere to assign someone.
    const bands = rollupBands(
      [member({ athleteId: '1', band: null }), member({ athleteId: '2', band: band({ id: 'b4', bandNumber: 4 }) })],
      [band({ id: 'b4', bandNumber: 4 })],
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].trainees).toBe(1);
  });
});

describe('fmtRate / rateColor', () => {
  it('renders an em dash for "no plan" and a percent for a real rate', () => {
    expect(fmtRate(null)).toBe('—');
    expect(fmtRate(0)).toBe('0%');
    expect(fmtRate(0.755)).toBe('76%');
  });

  // Asserts the exact tokens, not hue substrings: the light system's severity
  // ramp is accent-600 / band-3 / accent-red, and "band" here is a rate bracket,
  // not the `band-N` colour tokens — a substring match on 'band' would pass on
  // the wrong colour.
  it('colours by band, with a neutral colour for no plan', () => {
    expect(rateColor(null)).toBe('text-ink-400');
    expect(rateColor(0.9)).toBe('text-accent-600');
    expect(rateColor(0.6)).toBe('text-band-3');
    expect(rateColor(0.2)).toBe('text-accent-red');
  });
});

describe('week helpers', () => {
  it('resolves a Sunday from any day of that week', () => {
    // 2026-08-26 is a Wednesday; its week starts Sunday 2026-08-23.
    expect(sundayOf(new Date('2026-08-26T09:00:00Z'))).toBe('2026-08-23');
    expect(sundayOf(new Date('2026-08-23T09:00:00Z'))).toBe('2026-08-23');
    // Saturday is the last day of the same week, not the first of the next.
    // 18:00Z, not 21:00Z as this used to say: 2026-08-29T21:00Z is already Sunday
    // 00:00 in Israel, so it was asserting the UTC answer while describing the
    // Israeli one — and pinning the very off-by-a-week the helper now avoids.
    expect(sundayOf(new Date('2026-08-29T18:00:00Z'))).toBe('2026-08-23');
    // The small hours of Sunday in Israel belong to the week that is starting.
    expect(sundayOf(new Date('2026-08-29T21:00:00Z'))).toBe('2026-08-30');
  });

  it('shifts whole weeks in both directions across a month boundary', () => {
    expect(shiftWeek('2026-08-30', 1)).toBe('2026-09-06');
    expect(shiftWeek('2026-09-06', -1)).toBe('2026-08-30');
    expect(shiftWeek('2026-08-23', 0)).toBe('2026-08-23');
  });

  it('renders a Sunday-to-Saturday range', () => {
    const label = fmtWeekRange('2026-08-23', 'en-US');
    expect(label).toContain('23');
    expect(label).toContain('29');
  });
});

describe('initialsOf', () => {
  it('takes up to two initials and falls back for a blank name', () => {
    expect(initialsOf('Dana Levi')).toBe('DL');
    expect(initialsOf('Dana')).toBe('D');
    expect(initialsOf('Dana Levi Cohen')).toBe('DL');
    expect(initialsOf('')).toBe('?');
  });
});
