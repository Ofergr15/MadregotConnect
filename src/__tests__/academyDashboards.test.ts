import { describe, expect, it } from 'vitest';
import { buildWaiting, QUIET_DAYS } from '@/lib/academy/home';
import { SEAT_ORDER, SEAT_STYLE, seatInitials } from '@/lib/academy/seat-style';
import { seatFor } from '@/lib/academy/thread';
import { WEEK_ACCENT } from '@/components/profile/MyWeekCard';

const NOW = '2026-10-19T08:00:00.000Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

describe('academy home — the trainee checks in "מחכה לך"', () => {
  it('raises no plan, quiet and no test, one row per kind', () => {
    const w = buildWaiting({
      now: NOW,
      trainees: [
        { athleteId: 'a', name: 'Shahar Glazner', hasPersonalPlan: false, hasTest: false, lastSeenAt: daysAgo(12) },
        { athleteId: 'b', name: 'Ofer Grosfeld', hasPersonalPlan: false, hasTest: true, lastSeenAt: daysAgo(0) },
      ],
    });
    expect(w.map((x) => x.kind)).toEqual(['no_plan', 'quiet', 'no_test']);
    expect(w[0].title).toBe('2 בלי תוכנית אישית לשבוע');
    expect(w[0].target).toEqual({ section: 'members' });
    // One trainee opens their own page.
    expect(w[1]).toMatchObject({ title: 'Shahar · לא נכנס/ה', target: { section: 'members', athleteId: 'a' } });
    expect(w[2].target.athleteId).toBe('a');
  });

  it('an unread field raises nothing — never a false alarm', () => {
    const w = buildWaiting({ now: NOW, trainees: [{ athleteId: 'a', name: 'X', lastSeenAt: null }] });
    expect(w).toEqual([]);
  });

  it(`quiet starts at ${QUIET_DAYS} days`, () => {
    const at = (d: number) => buildWaiting({ now: NOW, trainees: [{ athleteId: 'a', name: 'X', lastSeenAt: daysAgo(d) }] }).length;
    expect(at(QUIET_DAYS - 1)).toBe(0);
    expect(at(QUIET_DAYS)).toBe(1);
  });

  it('a person waiting on an answer still comes first', () => {
    const w = buildWaiting({
      now: NOW,
      threads: [{ athleteId: 'b', name: 'Ofer', waitingHours: 2 }],
      trainees: [{ athleteId: 'a', name: 'Shahar', hasPersonalPlan: false }],
    });
    expect(w.map((x) => x.kind)).toEqual(['threads', 'no_plan']);
  });
});

describe('chat speaker colours', () => {
  it('one colour per seat: coach green, trainee purple, manager amber', () => {
    expect(SEAT_STYLE.coach.ink).toBe('#16A34A');
    expect(SEAT_STYLE.trainee.ink).toBe('#7C3AED');
    expect(SEAT_STYLE.manager.ink).toBe('#D97706');
    expect(new Set(SEAT_ORDER.map((s) => SEAT_STYLE[s].ink)).size).toBe(3);
  });

  it('the seat is the relation to the thread, not the person: Ofer is the trainee in his own, the manager elsewhere', () => {
    const ofer = 'ofer'; const yair = 'yair';
    expect(seatFor(ofer, ofer, [yair])).toBe('trainee');
    expect(seatFor(ofer, 'shahar', ['sahar'])).toBe('manager');
    expect(seatFor(yair, ofer, [yair])).toBe('coach');
  });

  it('initials', () => {
    expect(seatInitials('Shahar Glazner')).toBe('SG');
    expect(seatInitials('  שחר ')).toBe('ש');
  });
});

describe('week card accent', () => {
  it('the club stays blue, the academy is purple', () => {
    expect(WEEK_ACCENT.club.main).toBe('#1525FF');
    expect(WEEK_ACCENT.academy.main).toBe('#7C3AED');
  });
});

describe('academy-only trainee — no club pack to wait for', () => {
  it('drops the "דבוקת קצב" row, keeps it for everyone else', async () => {
    const { computeSetupState } = await import('@/lib/onboarding/setup-tasks');
    const input = {
      hasGarminAuth: false, hasStravaAuth: false, dataSource: null, avatarUrl: null, phone: null, birthDate: null,
      gender: null, shirtSize: null, pantsSize: null, tightsSize: null, socksSize: null, shoeSize: null,
      pushSubscriptions: 0, groupName: null, hasActiveShoe: false,
    };
    expect(computeSetupState(input, { academyOnly: true }).info.map((i) => i.key)).toEqual(['activeShoe']);
    expect(computeSetupState(input).info.map((i) => i.key)).toEqual(['paceGroup', 'activeShoe']);
  });
});
