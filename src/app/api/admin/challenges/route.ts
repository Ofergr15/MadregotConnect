import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { slugify } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const METRICS = ['distance_km', 'workout_count', 'elevation_m'] as const;
type Metric = (typeof METRICS)[number];
const SCOPES = ['individual', 'group'] as const;
type Scope = (typeof SCOPES)[number];

const CHALLENGE_ICON = '🏆'; // default emoji when the admin doesn't upload artwork

/** Same recipe as /api/admin/badges' generateUniqueCode — badges.code is a
 * shared UNIQUE column, so a challenge's underlying badge needs the same
 * collision-safe generation. */
async function generateUniqueCode(supabase: ReturnType<typeof createServerClient>, nameEn: string): Promise<string> {
  const base = `challenge_${slugify(nameEn) || Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const { data } = await supabase.from('badges').select('id').eq('code', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
}

/**
 * GET /api/admin/challenges — staff-only list, including inactive/past ones
 * (the athlete-facing GET /api/challenges only shows currently-active ones).
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('challenges')
    .select('id, badge_id, name_he, name_en, description_he, description_en, metric, target_value, scope, start_date, end_date, active, created_at')
    .order('start_date', { ascending: false });
  if (error) {
    // PGRST205 = PostgREST's "table not in schema cache" — migration 062 may
    // not be applied yet in this environment.
    if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ challenges: [] });
    return NextResponse.json({ error: 'Failed to fetch challenges' }, { status: 500 });
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const badgeIds = rows.map((c) => c.badge_id as string);
  const { data: badgeRows } = await supabase
    .from('badges')
    .select('id, icon, icon_url')
    .in('id', badgeIds.length > 0 ? badgeIds : ['00000000-0000-0000-0000-000000000000']);
  const badgeById = new Map(
    ((badgeRows || []) as Array<{ id: string; icon: string; icon_url: string | null }>).map((b) => [b.id, b]),
  );

  const challenges = rows.map((c) => {
    const badge = badgeById.get(c.badge_id as string);
    return {
      id: c.id,
      nameHe: c.name_he,
      nameEn: c.name_en,
      descriptionHe: c.description_he,
      descriptionEn: c.description_en,
      metric: c.metric,
      targetValue: c.target_value,
      scope: c.scope,
      startDate: c.start_date,
      endDate: c.end_date,
      active: c.active,
      icon: badge?.icon || CHALLENGE_ICON,
      iconUrl: badge?.icon_url || null,
    };
  });

  return NextResponse.json({ challenges });
}

/**
 * POST /api/admin/challenges — staff-only create. Creates the underlying
 * badges row (rule_type='challenge_completed') and the challenges row
 * together; if the second insert fails, the badge row is cleaned up (no real
 * cross-table transaction via the Supabase JS client, so this is a manual
 * compensating rollback).
 *
 * Body: {
 *   nameHe, nameEn: string (required)
 *   descriptionHe?, descriptionEn?: string
 *   metric: 'distance_km' | 'workout_count' | 'elevation_m' (required)
 *   targetValue: number (required) — km / count / meters, matching metric
 *   scope: 'individual' | 'group' (default 'individual')
 *   startDate, endDate: 'YYYY-MM-DD' (required)
 *   iconUrl?: string — public URL already uploaded via POST /api/admin/badges/icon
 * }
 */
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      nameHe,
      nameEn,
      descriptionHe,
      descriptionEn,
      metric,
      targetValue,
      scope,
      startDate,
      endDate,
      iconUrl,
    }: {
      nameHe?: string;
      nameEn?: string;
      descriptionHe?: string;
      descriptionEn?: string;
      metric?: string;
      targetValue?: number;
      scope?: string;
      startDate?: string;
      endDate?: string;
      iconUrl?: string;
    } = body || {};

    if (!nameHe?.trim() || !nameEn?.trim()) {
      return NextResponse.json({ error: 'nameHe and nameEn are required' }, { status: 400 });
    }
    if (!METRICS.includes(metric as Metric)) {
      return NextResponse.json({ error: `metric must be one of ${METRICS.join(', ')}` }, { status: 400 });
    }
    const target = Number(targetValue);
    if (!Number.isFinite(target) || target <= 0) {
      return NextResponse.json({ error: 'targetValue must be a positive number' }, { status: 400 });
    }
    const resolvedScope: Scope = SCOPES.includes(scope as Scope) ? (scope as Scope) : 'individual';
    if (!startDate || !endDate || endDate < startDate) {
      return NextResponse.json({ error: 'startDate and endDate are required, and endDate must not be before startDate' }, { status: 400 });
    }

    const supabase = createServerClient();
    const code = await generateUniqueCode(supabase, nameEn.trim());

    const { data: badge, error: badgeError } = await supabase
      .from('badges')
      .insert({
        code,
        name_he: nameHe.trim(),
        name_en: nameEn.trim(),
        description_he: descriptionHe?.trim() || null,
        description_en: descriptionEn?.trim() || null,
        icon: CHALLENGE_ICON,
        icon_url: iconUrl || null,
        rule_type: 'challenge_completed',
        rule_params: {},
        created_by: auth.user.athleteId,
      })
      .select()
      .single();
    if (badgeError) throw badgeError;

    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .insert({
        badge_id: badge.id,
        name_he: nameHe.trim(),
        name_en: nameEn.trim(),
        description_he: descriptionHe?.trim() || null,
        description_en: descriptionEn?.trim() || null,
        metric,
        target_value: target,
        scope: resolvedScope,
        start_date: startDate,
        end_date: endDate,
        created_by: auth.user.athleteId,
      })
      .select()
      .single();
    if (challengeError) {
      await supabase.from('badges').delete().eq('id', badge.id);
      throw challengeError;
    }

    return NextResponse.json({ challenge, badge });
  } catch (error) {
    console.error('Failed to create challenge:', error);
    return NextResponse.json({ error: 'Failed to create challenge' }, { status: 500 });
  }
}
