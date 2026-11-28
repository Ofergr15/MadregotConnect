/**
 * A seeded fake club for the Playwright smoke + axe run (task 111): 3 packs, 12 runners,
 * two weeks of runs, a record board, a champions board and a week-setup snapshot. Every
 * value is made up and fixed, and every date is relative to SEED_NOW, which the spec
 * pins as the page clock, so the screens render the same content on every run.
 *
 * The answers are shaped like the real routes' responses (the types named next to each
 * one). Anything not listed here gets `{}` from the spec, as in the plain axe run.
 * Nothing here reaches a database: the browser's requests are fulfilled in the test.
 */
import { normalizeOwners, readiness } from '@/lib/week-setup/model';

export const SEED_NOW = new Date('2026-11-25T08:00:00Z'); // Wednesday, 10:00 Israel
export const ME_ID = '00000000-0000-4000-8000-0000000000a1';

const id = (prefix: string, n: number) => `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(SEED_NOW.getTime() - n * 86_400_000);

const NAMES = ['נועה לוי', 'איתי כהן', 'דנה פרץ', 'ירדן מזרחי', 'עומר ביטון', 'מאיה אברהם', 'רועי שגיא', 'שירה דהן', 'גיל אורן', 'טל רוזן', 'אלון גל', 'ליאור בן דוד'];
export const SEED_FIRST_RUNNER = NAMES[0];

export const GROUPS = [1, 2, 3].map((i) => ({
  id: id('group', i), name: `Group ${String.fromCharCode(64 + i)} - SUB ${['3:15', '3:45', '4:15'][i - 1]}`,
  paceOffsetSeconds: (i - 1) * 15, level: (['fast', 'medium', 'slow'] as const)[i - 1], marathonGoal: ['3:15', '3:45', '4:15'][i - 1],
}));

export const ATHLETES = NAMES.map((name, i) => ({
  id: i === 0 ? ME_ID : id('athlete', i), name, email: `runner${i}@example.test`,
  groupId: GROUPS[i % 3].id, groupName: GROUPS[i % 3].name, status: 'active' as const,
  lastSynced: daysAgo(i % 3).toISOString(), createdAt: daysAgo(200 + i).toISOString(),
  dataSource: i % 2 ? 'strava' : 'garmin', hasGarmin: i % 2 === 0, hasStrava: i % 2 === 1, stravaEnabled: true,
  onboardingStatus: 'active', gender: i % 2 ? 'female' : 'male',
}));

/** /api/activities rows (route `baseCols`): three runs a week each, two weeks back. */
const ACTIVITIES = ATHLETES.flatMap((a, i) => [1, 3, 5, 8, 10, 12].map((d, j) => {
  const km = 6 + ((i + j) % 5) * 2;
  const pace = 290 + (i % 3) * 20;
  const start = daysAgo(d);
  start.setUTCHours(4, 30, 0, 0);
  return {
    id: id(`act${i}`, j), athlete_id: a.id, athlete_name: a.name, source: a.dataSource, garmin_activity_id: null, strava_activity_id: null,
    activity_name: j % 3 === 0 ? 'אימון קבוצתי' : 'ריצה קלה', activity_type: 'running',
    start_time: start.toISOString().replace('Z', '+00:00'), distance: km * 1000, duration: km * pace, moving_duration: km * pace,
    average_pace: pace, average_hr: 145 + j, max_hr: 170, calories: km * 70, elevation_gain: 30,
    has_polyline: false, created_at: start.toISOString(), splits: null, laps: null, perceived_rpe: null, perceived_feel: null,
  };
}));

const champions = () => {
  const boards: Record<string, { top: unknown[]; me: null }> = {};
  const rows = ATHLETES.slice(0, 6).map((a, i) => ({
    id: id('race', i), athleteId: a.id, name: a.name, avatarUrl: null, gender: a.gender, pack: (i % 3) + 1,
    seconds: 5400 + i * 240, raceName: 'חצי מרתון תל אביב', raceDate: '2026-02-27', rank: i + 1, isNew: i === 0,
  }));
  for (const distance of ['5k', '10k', 'half', 'marathon']) for (const sex of ['men', 'women', 'all']) for (const scope of ['year', 'all']) {
    boards[`${distance}:${sex}:${scope}`] = { top: distance === 'half' ? rows.map((r) => ({ ...r, distance })) : [], me: null };
  }
  return { ready: true, boards, canManage: false, pending: 0 };
};

const records = () => {
  const bucket = (key: string, label: string, meters: number, base: number) => ({
    key, label, meters,
    entries: ATHLETES.slice(0, 8).map((a, i) => ({
      athleteId: a.id, name: a.name, seconds: base + i * 35, date: ymd(daysAgo(20 + i * 9)), activityId: id(`act${i}`, 0),
      activityName: 'מרוץ', fromSegment: false, source: 'auto' as const, note: null,
    })),
  });
  return {
    computedAt: SEED_NOW.toISOString(), athleteCount: ATHLETES.length,
    buckets: [bucket('5k', '5K', 5000, 1140), bucket('10k', '10K', 10000, 2400), bucket('hm', 'Half', 21097, 5400), bucket('fm', 'Marathon', 42195, 11400)],
    recomputed: false,
  };
};

/** WeekSnapshot (lib/week-setup/server.ts) + { me, mine } — the plan week Sun 22 Nov. */
const weekSetup = () => {
  const weekStart = '2026-11-22';
  const day = (n: number) => ymd(new Date(Date.parse(`${weekStart}T12:00:00Z`) + n * 86_400_000));
  const sessions: Record<number, Array<{ name: string; km: number; optional: boolean; type: string }>> = {
    0: [{ name: 'ריצה קלה', km: 8, optional: false, type: 'easy' }],
    2: [{ name: 'אינטרוולים 6×800', km: 10, optional: false, type: 'intervals' }],
    4: [{ name: 'טמפו', km: 9, optional: false, type: 'tempo' }],
    5: [{ name: 'ריצה ארוכה', km: 18, optional: false, type: 'long_run' }],
  };
  return {
    weekStart, plan: { status: 'draft', createdAt: daysAgo(4).toISOString() }, pdf: { training: null, nutrition: null }, weekNumber: 12,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d, date: day(d), sessions: sessions[d] ?? [], daySession: null, team: d === 2 || d === 5, quality: d === 2, folderName: `${day(d)} אימון`,
    })),
    teamDays: [2, 5], workoutHour: 5, qualityDays: [2], qualityPicked: true, folders: {}, timeline: [], approvalMode: 'auto', polls: [],
    owners: normalizeOwners(null),
    staff: [{ id: ME_ID, name: NAMES[0], role: 'coach' }],
    readiness: readiness({ planStatus: 'draft', nutrition: false, qualityPicked: true, toApprove: 0, polls: false, message: false }),
    log: [], watches: null, plannedPolls: [], groups: GROUPS.map((g) => ({ id: g.id, name: g.name })),
    me: { id: ME_ID, admin: false, coach: true, approver: true }, mine: ['workouts', 'quality', 'watches'],
  };
};

/**
 * A browser session as supabase-js stores it, for the made-up project the a11y build
 * points at (playwright.a11y.config.ts). The token is not signed by anything: the
 * browser never verifies it, and every API call is answered by the spec, so it only
 * gets the screens that need a session (apiHeaders) past "not signed in".
 */
export function seededSession(): { key: string; value: string } {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000);
  const user = { id: ME_ID, aud: 'authenticated', role: 'authenticated', email: ATHLETES[0].email, app_metadata: {}, user_metadata: {}, created_at: ATHLETES[0].createdAt };
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'https://a11y-fixture.supabase.co/auth/v1', sub: ME_ID, aud: 'authenticated', role: 'authenticated', email: user.email, exp })}.fake`;
  return { key: 'sb-a11y-fixture-auth-token', value: JSON.stringify({ access_token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }) };
}

/** The answer for one request path, or undefined (the spec then answers `{}`). */
export function seededAnswer(pathname: string, search: URLSearchParams): unknown {
  switch (pathname) {
    case '/api/public/stats':
      return { since: '2025-09-01', totalKm: 48210, workouts: 6120, totalHours: 4310, topResults: ATHLETES.slice(0, 3).map((a, i) => ({ name: a.name, timeSeconds: 420 + i * 9, test: '2000 מ׳' })), testDate: '2026-10-14' };
    case '/api/public/groups':
      return { groups: GROUPS.map((g, index) => ({ ...g, index })) };
    case '/api/features/public':
      return { features: {} };
    case '/api/athletes/me': {
      const a = ATHLETES[0];
      return { athlete: { id: a.id, name: a.name, email: a.email, group: { id: a.groupId, name: a.groupName }, hasGarmin: true, hasStrava: false, garminState: 'ok', stravaState: 'none', stravaEnabled: false, data_source: 'garmin', onboardingStatus: 'active', avatarUrl: null, memberSince: a.createdAt, gender: 'male', weekStartDay: 1, discoverable: true } };
    }
    case '/api/athletes':
      return { athletes: ATHLETES };
    case '/api/groups':
      return { groups: GROUPS.map((g) => ({ ...g, athletes: ATHLETES.filter((a) => a.groupId === g.id).map((a) => ({ id: a.id, name: a.name, email: a.email, status: a.status, hasGarmin: a.hasGarmin, hasStrava: a.hasStrava })), athleteCount: ATHLETES.filter((a) => a.groupId === g.id).length })) };
    case '/api/groups/leaderboard': {
      const rows = ATHLETES.map((a, i) => ({ id: a.id, name: a.name, groupId: a.groupId, distanceKm: 60 - i * 3, runs: 6 - (i % 3), durationMin: 300 - i * 12, weekStreak: 10 - (i % 5) }));
      return { leaderboard: rows, leaderboardByStreak: rows, leaderboardByRuns: rows, groupLeaderboards: Object.fromEntries(GROUPS.map((g) => [g.id, rows.filter((r) => r.groupId === g.id)])) };
    }
    case '/api/activities': {
      const self = search.get('scope') === 'self';
      const athleteId = search.get('athleteId');
      const since = search.get('since');
      const until = search.get('until');
      const rows = ACTIVITIES.filter((r) => (!self || r.athlete_id === athleteId) && (!since || r.start_time >= since) && (!until || r.start_time < until));
      return { activities: rows.sort((x, y) => y.start_time.localeCompare(x.start_time)) };
    }
    case '/api/club/upcoming':
      // UpcomingBuckets (lib/events/upcoming.ts) + today.
      return {
        races: [{ id: id('event', 1), kind: 'race', name: 'מרתון ולנסיה', date: '2026-12-06', location: 'ולנסיה', distances: ['42.2'], daysAway: 11 }],
        club: [{ id: id('event', 2), kind: 'social', name: 'ערב מועדון', date: '2026-12-01', start_time: '19:30', location: 'פארק הירקון', daysAway: 6 }],
        birthdays: [], today: ymd(SEED_NOW),
      };
    case '/api/club/today': {
      const top = ATHLETES.slice(1, 6).map((a, i) => ({ id: a.id, name: a.name, avatarUrl: null, km: 14 - i * 2, activityId: id(`act${i + 1}`, 0) }));
      return { runners: 9, km: 86, top, pack: null };
    }
    case '/api/feed': {
      // FeedItem (docs/contracts/feed.md). `athlete=` narrows to one runner, as the route does.
      const only = search.get('athlete');
      const rows = ACTIVITIES.filter((r) => !only || r.athlete_id === only).sort((x, y) => y.start_time.localeCompare(x.start_time)).slice(0, Number(search.get('limit')) || 20);
      const items = rows.map((r) => {
        const a = ATHLETES.find((x) => x.id === r.athlete_id)!;
        return {
          id: `feed-${r.id}`, type: 'activity', author: { athleteId: a.id, name: a.name, avatarUrl: null, groupName: a.groupName },
          body: null, media: [], payload: null, occurredAt: r.start_time, likeCount: 2, commentCount: 0, likedByMe: false,
          likePreview: [], commentPreview: [], canDelete: a.id === ME_ID,
          activity: {
            id: r.id, athleteId: a.id, garminActivityId: null, activityName: r.activity_name, activityType: 'running', startTime: r.start_time,
            distance: r.distance, duration: r.duration, movingDuration: r.moving_duration, averagePace: r.average_pace, averageHr: r.average_hr,
            maxHr: r.max_hr, calories: r.calories, elevationGain: r.elevation_gain, locationName: 'פארק הירקון', perceivedRpe: null, perceivedFeel: null,
            routePreview: null, routeHd: null, hasRoute: false, paceBands: null, lapBands: null, stepBands: null, planVerdict: null, qualityName: null,
          },
        };
      });
      return { items, nextCursor: null };
    }
    case '/api/club/records':
      return records();
    case '/api/club/champions':
      return champions();
    case '/api/week-setup':
      return weekSetup();
    default:
      return undefined;
  }
}
