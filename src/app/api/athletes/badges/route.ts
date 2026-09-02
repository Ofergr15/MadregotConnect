import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/athletes/badges?athleteId=…
// Achievements & Badges (roadmap #11, Phase 3) — the full badge catalog
// (`badges`) joined with which ones this athlete has earned (`athlete_badges`).
// The award-evaluation engine that decides WHEN a badge is earned is a
// separate task and the only writer of athlete_badges; this route is purely a
// read surface for the Profile > Badges screen and the feed's achievement
// cards' underlying data model. Auth mirrors /api/athletes/prs and
// /api/athletes/races: a caller may fetch their own badge status; staff
// (coach/admin/academy_coach, proven by their session) may fetch anyone's.
interface BadgeCatalogRow {
  id: string;
  code: string;
  name_he: string;
  name_en: string;
  description_he: string | null;
  description_en: string | null;
  icon: string;
  icon_url: string | null;
  rule_type: string;
}

interface AthleteBadgeRow {
  badge_id: string;
  awarded_at: string;
  context: Record<string, unknown> | null;
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    // Authorization: caller must own this athleteId or be staff. The super user
    // may view anyone's badges (consistent w/ view-as) — mayActFor covers that.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Full catalog of active badges, in seed/insertion order (grouped by
    // milestone family — first_5k..first_fm, vol_*, streak_*, first_race,
    // perfect_month_attendance — see migrations/059_badges.sql).
    const { data: catalog, error: catalogError } = await supabase
      .from('badges')
      .select('id, code, name_he, name_en, description_he, description_en, icon, icon_url, rule_type')
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (catalogError) throw catalogError;

    const { data: awards, error: awardsError } = await supabase
      .from('athlete_badges')
      .select('badge_id, awarded_at, context')
      .eq('athlete_id', athleteId);
    if (awardsError) throw awardsError;

    const awardByBadgeId = new Map<string, AthleteBadgeRow>(
      (awards || []).map((a) => [(a as AthleteBadgeRow).badge_id, a as AthleteBadgeRow]),
    );

    const badges = ((catalog || []) as BadgeCatalogRow[]).map((b) => {
      const award = awardByBadgeId.get(b.id);
      return {
        id: b.id,
        code: b.code,
        nameHe: b.name_he,
        nameEn: b.name_en,
        descriptionHe: b.description_he || null,
        descriptionEn: b.description_en || null,
        icon: b.icon,
        // Admin-uploaded artwork, when set, takes visual precedence over the
        // emoji fallback (see migrations/059_badges.sql's `icon_url` comment).
        iconUrl: b.icon_url || null,
        ruleType: b.rule_type,
        earned: !!award,
        awardedAt: award?.awarded_at ?? null,
        context: award?.context ?? null,
      };
    });

    const earnedCount = badges.filter((b) => b.earned).length;

    return NextResponse.json({ badges, earnedCount, totalCount: badges.length });
  } catch (err) {
    console.error('Badges error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch badges';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
