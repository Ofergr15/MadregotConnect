/**
 * A deterministic club for the response-size budget: 3 packs, 60 runners + 2 staff,
 * 6 weeks of runs (3-4 a week each), the current and previous group plans, feed items
 * for every run, a few events. Sized like the real club (≈60 members) so a budget
 * breach means a response really grew. No randomness: sizes are stable across runs.
 */
import { COACH_ID } from '@/lib/constants';
import type { Tables } from './fake-db';

export const NOW = new Date('2026-11-25T10:00:00Z'); // a Wednesday
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const uuid = (prefix: string, i: number) => `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, '0')}`;

export const STAFF_ID = uuid('staff', 1);

export function seedClub(): Tables {
  const groups = [1, 2, 3].map((i) => ({ id: uuid('group', i), name: `דבוקה ${i}`, coach_id: COACH_ID, created_at: iso(day(400)) }));
  const athletes: Record<string, unknown>[] = [];
  for (let i = 0; i < 62; i++) {
    const staff = i < 2;
    athletes.push({
      id: i === 0 ? STAFF_ID : uuid('athlete', i),
      name: `Runner ${i} רץ`, email: `runner${i}@example.test`,
      role: staff ? (i === 0 ? 'admin' : 'coach') : 'runner', roles: [],
      status: 'active', approved: true, group_id: groups[i % 3].id, avatar_url: `https://cdn.example.test/a/${i}.jpg`,
      is_academy: i % 10 === 5, is_super_user: false, created_at: iso(day(300 - i)), last_seen_at: iso(day(i % 4)),
      notification_prefs: { reminders: true }, strava_athlete_id: 1000 + i, has_strava: true, has_garmin: i % 2 === 0,
      onboarding_status: 'active', default_hidden_fields: [], coach_id: COACH_ID, data_source: 'garmin', strava_enabled: true,
      groups: { name: `דבוקה ${(i % 3) + 1}` },
    });
  }
  const activities: Record<string, unknown>[] = [];
  const feed: Record<string, unknown>[] = [];
  let n = 0;
  for (const a of athletes.slice(2)) {
    for (let d = 0; d < 42; d++) {
      if ((d + Number(String(a.id).slice(-2))) % 2 !== 0) continue;
      const km = 6 + ((d * 7 + n) % 12);
      const start = new Date(day(d).setUTCHours(5, 30, 0, 0));
      const act = {
        id: uuid('act', n), athlete_id: a.id, source: n % 3 ? 'garmin' : 'strava',
        garmin_activity_id: 20_000_000 + n, strava_activity_id: null, activity_name: 'ריצת בוקר', activity_type: 'running',
        start_time: iso(start), distance: km * 1000, duration: km * 300, moving_duration: km * 295,
        average_pace: 300, average_hr: 148, max_hr: 171, calories: km * 70, elevation_gain: 40,
        location_name: 'תל אביב', perceived_rpe: null, perceived_feel: null, has_polyline: true,
        route_preview: 'a'.repeat(240), route_preview_hd: null,
        splits: Array.from({ length: km }, (_, k) => ({ km: k + 1, pace: 295 + (k % 5), hr: 145 + k })),
        laps: Array.from({ length: km }, (_, k) => ({ distance: 1000, duration: 300, averageHR: 146 + k })),
        created_at: iso(start),
      };
      activities.push(act);
      feed.push({
        id: uuid('feed', n), type: 'activity', author_athlete_id: a.id, activity_id: act.id, body: null, media: null,
        payload: {}, occurred_at: act.start_time, visibility: 'club', group_id: a.group_id, like_count: n % 7, comment_count: n % 3,
        deleted_at: null, created_at: act.start_time,
        athletes: { id: a.id, name: a.name, avatar_url: a.avatar_url, groups: { name: 'דבוקה 1' } },
        athlete_activities: act,
      });
      n++;
    }
  }
  const sunday = (d: Date) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return ymd(x); };
  const plans = [0, 7].map((back, i) => ({
    id: uuid('plan', i), week_start_date: sunday(day(back)), athlete_id: null, status: 'pushed', coach_id: STAFF_ID,
    created_at: iso(day(back + 3)), updated_at: iso(day(back + 3)),
    parsed_workouts: Array.from({ length: 6 }, (_, k) => ({
      dayOfWeek: k, name: `אימון ${k}`, type: 'easy', description: 'ריצה קלה 10 ק״מ 5:30 (5:45) ((6:00))',
      steps: [{ type: 'interval', durationType: 'distance', durationValue: 10000, targetType: 'pace', notes: '5:30 (5:45) ((6:00))' }],
    })),
  }));
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: uuid('event', i), title: `אירוע ${i}`, description: 'פרטים', starts_at: iso(day(-3 - i * 5)), location: 'הירקון',
    created_at: iso(day(10)), created_by: STAFF_ID, cancelled_at: null, hidden: false, capacity: null,
  }));
  return {
    groups, athletes, athlete_activities: activities, feed_items: feed, weekly_plans: plans, events,
    app_settings: [], feature_enablements: [], coaches: [], feed_likes: [], feed_comments: [],
  };
}
