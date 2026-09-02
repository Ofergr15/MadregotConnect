import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { computeChallengeProgress, type ChallengeRow } from '@/lib/challenges/engine';

export const dynamic = 'force-dynamic';

// GET /api/challenges?athleteId=…
// Roadmap #13, Phase 4 — currently-active challenges (today within their
// start/end window) with this athlete's live progress against each. The
// award-evaluation engine (checkAndAwardChallenges) is the only writer of
// completions; this route is purely a read surface for the Profile >
// Challenges screen. Auth mirrors GET /api/athletes/badges: a caller may
// fetch their own progress; staff may fetch anyone's.
interface ChallengeCatalogRow extends ChallengeRow {
  description_he: string | null;
  description_en: string | null;
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: rows, error } = await supabase
      .from('challenges')
      .select('id, badge_id, name_he, name_en, description_he, description_en, metric, target_value, scope, start_date, end_date')
      .eq('active', true)
      .lte('start_date', today)
      .gte('end_date', today)
      .order('end_date', { ascending: true });
    if (error) {
      // migration 062 may not be applied yet in this environment — degrade to
      // "no challenges" instead of 500ing the whole route. PostgREST reports
      // a genuinely missing table via its own PGRST205 (not a Postgres-level
      // 42P01 — that's what you'd get querying a missing table over raw SQL).
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ challenges: [] });
      throw error;
    }

    const catalog = (rows || []) as ChallengeCatalogRow[];
    const badgeIds = catalog.map((c) => c.badge_id);

    // Separate queries + a manual JS join (not an embedded-relation select
    // string) — same reason GET /api/athletes/badges joins in JS: the
    // untyped Supabase client can't infer a proper row type across relations.
    const { data: badgeRows } = await supabase
      .from('badges')
      .select('id, icon, icon_url')
      .in('id', badgeIds.length > 0 ? badgeIds : ['00000000-0000-0000-0000-000000000000']);
    const badgeById = new Map(
      ((badgeRows || []) as Array<{ id: string; icon: string; icon_url: string | null }>).map((b) => [b.id, b]),
    );

    const { data: awards } = await supabase
      .from('athlete_badges')
      .select('badge_id, awarded_at')
      .eq('athlete_id', athleteId)
      .in('badge_id', badgeIds.length > 0 ? badgeIds : ['00000000-0000-0000-0000-000000000000']);
    const awardByBadgeId = new Map(
      (awards || []).map((a: { badge_id: string; awarded_at: string }) => [a.badge_id, a.awarded_at]),
    );

    const challenges = await Promise.all(
      catalog.map(async (c) => {
        const badge = badgeById.get(c.badge_id);
        const completedAt = awardByBadgeId.get(c.badge_id) || null;
        const current = completedAt ? c.target_value : await computeChallengeProgress(supabase, athleteId, c);
        return {
          id: c.id,
          nameHe: c.name_he,
          nameEn: c.name_en,
          descriptionHe: c.description_he,
          descriptionEn: c.description_en,
          icon: badge?.icon || '🏆',
          iconUrl: badge?.icon_url || null,
          metric: c.metric,
          targetValue: c.target_value,
          scope: c.scope,
          startDate: c.start_date,
          endDate: c.end_date,
          current,
          completed: !!completedAt,
          completedAt,
        };
      }),
    );

    return NextResponse.json({ challenges });
  } catch (err) {
    console.error('Challenges error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch challenges';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
