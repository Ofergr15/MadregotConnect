import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { groupDisplayName, resolveGroup } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/public/groups — PUBLIC, unauthenticated. The club's pace groups, for
 * the "which group do you belong to?" field on /register.
 *
 * /api/join/groups already returns this shape, but it keys off an invite token to
 * find the coach — and someone filling in the public form has no token yet. So
 * this reads the club's single coach (COACH_ID) instead. Single-club app; there
 * is no other coach to pick.
 *
 * Returns nothing but a group's id, display name and pace band — all of which are
 * already on screen for anyone who opens the app. No member data.
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: groups, error } = await supabase
      .from('groups')
      .select('id, name, pace_profile')
      .eq('coach_id', COACH_ID)
      .order('name');

    if (error) throw error;

    const out = (groups || []).map((group: { id: string; name: string; pace_profile: unknown }) => {
      const paceProfile = (group.pace_profile ?? null) as {
        offsetSeconds?: number;
        level?: 'fast' | 'medium' | 'slow';
        marathonGoal?: string;
      } | null;

      const paceOffsetSeconds = typeof paceProfile?.offsetSeconds === 'number' ? paceProfile.offsetSeconds : 0;

      // Same banding as /api/join/groups — kept identical on purpose so the
      // public form and the invite form colour and order the groups the same way.
      let level: 'fast' | 'medium' | 'slow' = 'medium';
      if (paceOffsetSeconds <= 0) level = 'fast';
      else if (paceOffsetSeconds <= 15) level = 'medium';
      else level = 'slow';
      if (paceProfile?.level) level = paceProfile.level;

      return {
        id: group.id,
        name: groupDisplayName(group.name),
        // The 0-based band index, so the public form can label the group in
        // Hebrew ("דבוקה 1") without re-parsing the raw name. groupDisplayName()
        // is English app-wide and is left that way — this page is the only place
        // that is Hebrew-only, so the translation happens here, not in the util.
        index: resolveGroup(group.name).index,
        paceOffsetSeconds,
        level,
        marathonGoal: paceProfile?.marathonGoal || '',
      };
    });

    return NextResponse.json({ groups: out });
  } catch (err) {
    // An empty list is a usable form — the group field is optional — so a failure
    // here must not stop anyone registering.
    console.error('Failed to load public groups:', err);
    return NextResponse.json({ groups: [] });
  }
}
