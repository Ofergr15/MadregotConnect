import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStoryAdmin } from '@/lib/birthday-year/access';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { STORY_FEATURES, readStorySettings, type StoryFeature } from '@/lib/stories/gate';
import { optedOut, parseStoryPrefs } from '@/lib/stories/prefs';
import { readInstances } from '@/lib/stories/instances';
import { bucketOf, nextAnnualPeriod, upcomingBirthday } from '@/lib/stories/schedule';
import { nextSaturday, rowStatus } from '@/lib/stories/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stories/upcoming?feature=birthday|annual|weekly — who gets it in the
 * next week (היום / מחר / השבוע), each with the status the cron would act on and the
 * override chip. Birthday also lists active members with NO birth date. Admin only.
 */
export async function GET(request: Request) {
  const { denied } = await requireStoryAdmin(request);
  if (denied) return denied;
  const feature = new URL(request.url).searchParams.get('feature') as StoryFeature;
  if (!STORY_FEATURES.includes(feature)) return NextResponse.json({ error: 'bad feature' }, { status: 400 });
  const db = createServerClient();
  const today = israelToday();
  const settings = await readStorySettings(feature, { db: db as never });
  if (!settings) return NextResponse.json({ ready: false, rows: [], noBirthDate: [] });
  const [p, t] = await Promise.all([
    db.from('app_settings').select('value').eq('key', 'stories_paused').maybeSingle(),
    db.from('story_testers').select('athlete_id'),
  ]);
  const paused = (p.data as { value?: string } | null)?.value === 'on';
  const testers = new Set(((t.data || []) as { athlete_id: string }[]).map((r) => r.athlete_id));
  let roster = await db.from('athletes').select('id, name, avatar_url, status, birth_date, story_prefs').eq('coach_id', COACH_ID).eq('status', 'active');
  if (roster.error) roster = await db.from('athletes').select('id, name, avatar_url, status, birth_date').eq('coach_id', COACH_ID).eq('status', 'active') as typeof roster;
  const people = (roster.data || []) as { id: string; name: string | null; avatar_url: string | null; status: string; birth_date: string | null; story_prefs?: unknown }[];

  const wanted: { a: (typeof people)[number]; period: string }[] = [];
  const noBirthDate: { athleteId: string; name: string | null }[] = [];
  let nextAt: string | null = null;
  if (feature === 'birthday') {
    for (const a of people) {
      if (!a.birth_date) { noBirthDate.push({ athleteId: a.id, name: a.name }); continue; }
      const period = upcomingBirthday(a.birth_date, today);
      if (period && bucketOf(period, today) !== 'later') wanted.push({ a, period });
    }
  } else {
    const period = feature === 'annual' ? nextAnnualPeriod(today, settings.annual_date || '12-31') : nextSaturday(today);
    nextAt = period;
    if (bucketOf(period, today) !== 'later') {
      for (const a of people) if (feature !== 'weekly' || settings.state !== 'testers' || testers.has(a.id)) wanted.push({ a, period });
    }
  }
  const { map, ready } = await readInstances(db, feature, wanted.map((w) => w.period)).catch(() => ({ map: new Map(), ready: false }));
  const rows = wanted.map(({ a, period }) => ({
    athleteId: a.id, name: a.name, avatarUrl: a.avatar_url, period, bucket: bucketOf(period, today),
    tester: testers.has(a.id),
    ...rowStatus(settings, paused, period, { id: a.id, active: true, tester: testers.has(a.id), optedOut: optedOut(parseStoryPrefs(a.story_prefs), feature) }, map.get(`${a.id}:${period}`) ?? null),
  })).sort((x, y) => x.period.localeCompare(y.period) || (x.name || '').localeCompare(y.name || ''));
  return NextResponse.json({ ready: true, ready157: ready, today, nextAt, rows: rows.slice(0, 300), total: rows.length, noBirthDate: feature === 'birthday' ? noBirthDate : [] });
}
