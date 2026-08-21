import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { slugify } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// The two metric types the admin "Create New Badge" form supports (Phase 3
// admin extension — see roadmap). The other five `rule_type`s in migration
// 059 (pr_bucket, streak_weeks, race_count, attendance_perfect_month,
// challenge_completed) are only ever set by the v1 seed / other product
// surfaces, not this form.
type AdminRuleType = 'cumulative_distance' | 'cumulative_duration';

const GENERIC_ICON = '🎯'; // default emoji when the admin doesn't upload artwork

/**
 * Generates a unique, stable `code` from the English badge name (slugified),
 * falling back to a timestamp-based code if the name has no ASCII characters
 * to slugify (e.g. a Hebrew-only name) — appending a numeric suffix on
 * collision so the DB's UNIQUE(code) constraint never rejects a create.
 */
async function generateUniqueCode(supabase: ReturnType<typeof createServerClient>, nameEn: string): Promise<string> {
  const base = slugify(nameEn) || `badge_${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  // Small catalog (dozens of rows at most) — a loop of exact-match lookups is
  // simpler and plenty fast; no need for a single clever query.
  while (true) {
    const { data } = await supabase.from('badges').select('id').eq('code', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
}

/**
 * POST /api/admin/badges — staff-only create for an ADDITIONAL milestone badge
 * (distance or time based). Follows the same requireSession + isStaff gate as
 * POST /api/events (the modern, properly-authed pattern in this app) rather
 * than the older /api/admin/* routes, which predate bearer-token auth and
 * rely only on client-side gating.
 *
 * Body: {
 *   nameHe, nameEn: string (required)
 *   descriptionHe?, descriptionEn?: string
 *   metricType: 'distance' | 'duration' (required)
 *   thresholdValue: number (required) — km for 'distance', HOURS for 'duration'
 *   iconUrl?: string — public URL already uploaded via POST /api/admin/badges/icon
 * }
 *
 * rule_params unit convention (read this before changing the award-evaluation
 * engine's cumulative_duration handling):
 *   - cumulative_distance → { km: <number> }      (matches the v1 seed rows)
 *   - cumulative_duration → { hours: <number> }   (admin-facing unit, NOT seconds)
 * `athlete_activities.duration` is stored in SECONDS (see academy/adherence.ts
 * and weekly-snapshots.ts's `duration_s`), so the award engine must compare
 * cumulative seconds against `rule_params.hours * 3600` — the same "store the
 * human unit, convert in the engine" pattern the seed data already uses for
 * cumulative_distance (km, not meters).
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
      metricType,
      thresholdValue,
      iconUrl,
    }: {
      nameHe?: string;
      nameEn?: string;
      descriptionHe?: string;
      descriptionEn?: string;
      metricType?: string;
      thresholdValue?: number;
      iconUrl?: string;
    } = body || {};

    if (!nameHe?.trim() || !nameEn?.trim()) {
      return NextResponse.json({ error: 'nameHe and nameEn are required' }, { status: 400 });
    }
    if (metricType !== 'distance' && metricType !== 'duration') {
      return NextResponse.json({ error: "metricType must be 'distance' or 'duration'" }, { status: 400 });
    }
    const threshold = Number(thresholdValue);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return NextResponse.json({ error: 'thresholdValue must be a positive number' }, { status: 400 });
    }

    const ruleType: AdminRuleType = metricType === 'distance' ? 'cumulative_distance' : 'cumulative_duration';
    const ruleParams = metricType === 'distance' ? { km: threshold } : { hours: threshold };

    const supabase = createServerClient();
    const code = await generateUniqueCode(supabase, nameEn.trim());

    const { data, error } = await supabase
      .from('badges')
      .insert({
        code,
        name_he: nameHe.trim(),
        name_en: nameEn.trim(),
        description_he: descriptionHe?.trim() || null,
        description_en: descriptionEn?.trim() || null,
        icon: GENERIC_ICON,
        icon_url: iconUrl || null,
        rule_type: ruleType,
        rule_params: ruleParams,
        created_by: auth.user.athleteId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ badge: data });
  } catch (error) {
    console.error('Failed to create badge:', error);
    return NextResponse.json({ error: 'Failed to create badge' }, { status: 500 });
  }
}
