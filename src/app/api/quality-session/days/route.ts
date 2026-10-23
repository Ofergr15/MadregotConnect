import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isStoryEditor } from '@/lib/quality-session/access';
import { loadQualitySession, loadQualityWorkout } from '@/lib/quality-session/server';
import { packRuns, runnersOf } from '@/lib/quality-session/model';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/quality-session/days — Content › "שיתוף האימון" (mockups/content-share.html,
 * Ofer 10-23): today's session when today is one, with each pack's count and the run
 * suggested for its card (the feed row's rule: the longest), and the sessions before
 * it, newest first — the days the morning push went out for. Same access as
 * /api/quality-session: the super user and the "אינסטגרם" switch.
 */
export interface ShareDays {
  today: null | {
    date: string; name: string; long: boolean; runs: number;
    packs: Array<{ pack: 1 | 2 | 3; done: number; top: { name: string; avatarUrl: string | null } | null }>;
  };
  past: Array<{ date: string; name: string; long: boolean; runs: number }>;
}

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const db = createServerClient();
  if (!auth.user.isSuperUser && !(await isStoryEditor(db, auth.user.athleteId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const date = israelToday();
    const ranOn = async (day: string) => {
      const { data } = await db.from('athlete_activities').select('athlete_id')
        .gte('start_time', `${day}T00:00:00`).lt('start_time', `${day}T12:00:00`).gte('distance', 1000);
      return new Set(((data || []) as { athlete_id: string }[]).map((r) => r.athlete_id)).size;
    };

    let today: ShareDays['today'] = null;
    const workout = await loadQualityWorkout(db, date);
    if (workout) {
      const sess = await loadQualitySession(db, date);
      const packs = ([1, 2, 3] as const).map((pack) => {
        const rs = runnersOf(packRuns(sess, pack, 24 * 60)).sort((a, b) => b.run.dist - a.run.dist);
        return { pack, done: rs.length, top: rs[0]?.run ?? null };
      });
      const ids = packs.flatMap((x) => (x.top ? [x.top.athleteId] : []));
      const { data: av } = ids.length ? await db.from('athletes').select('id, avatar_url').in('id', ids) : { data: [] };
      const avatar = new Map(((av || []) as { id: string; avatar_url: string | null }[]).map((a) => [a.id, a.avatar_url]));
      today = {
        date, name: workout.name, long: !!workout.long || workout.type === 'long_run', runs: packs.reduce((n, x) => n + x.done, 0),
        packs: packs.map((x) => ({ pack: x.pack, done: x.done, top: x.top ? { name: x.top.name, avatarUrl: avatar.get(x.top.athleteId) ?? null } : null })),
      };
    }

    // The days the morning push went out for (the tick's ledger), before today.
    const { data: led } = await db.from('scheduled_notifications').select('url')
      .like('url', '#ledger:qualitySession:%').order('created_at', { ascending: false }).limit(12);
    const days = [...new Set(((led || []) as { url: string }[]).map((r) => r.url.slice('#ledger:qualitySession:'.length)))]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date).slice(0, 8);
    const past = (await Promise.all(days.map(async (d) => {
      const [w, runs] = await Promise.all([loadQualityWorkout(db, d), ranOn(d)]);
      return w ? { date: d, name: w.name, long: !!w.long || w.type === 'long_run', runs } : null;
    }))).filter((x): x is NonNullable<typeof x> => !!x);

    return NextResponse.json({ today, past } satisfies ShareDays);
  } catch (err) {
    console.error('[quality-session/days] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
