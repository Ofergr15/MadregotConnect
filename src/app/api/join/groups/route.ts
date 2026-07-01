import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ groups: [] });
    }

    const supabase = createServerClient();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('coach_id')
      .eq('invite_token', token)
      .single();

    if (!athlete) {
      return NextResponse.json({ groups: [] });
    }

    const { data: groups } = await supabase
      .from('groups')
      .select('id, name, pace_profile')
      .eq('coach_id', athlete.coach_id)
      .order('name');

    // Transform to include pace offset info and marathon goal
    const transformedGroups = groups?.map(group => {
      const paceProfile = group.pace_profile as any;
      const paceOffsetSeconds = typeof paceProfile === 'object' && paceProfile !== null
        ? (paceProfile.offsetSeconds ?? 0)
        : 0;

      let level: 'fast' | 'medium' | 'slow' = 'medium';
      if (paceOffsetSeconds <= 0) level = 'fast';
      else if (paceOffsetSeconds <= 15) level = 'medium';
      else level = 'slow';

      if (paceProfile?.level) level = paceProfile.level;

      const marathonGoal = paceProfile?.marathonGoal || '';

      const displayName = (() => {
        const n = (group.name || '').toLowerCase();
        if (n.includes('group a') || n.includes('sub 2:30')) return 'Group 1';
        if (n.includes('group b') || n.includes('sub 2:35')) return 'Group 2';
        if (n.includes('group c') || n.includes('sub 2:45')) return 'Group 3';
        return group.name;
      })();

      return {
        id: group.id,
        name: displayName,
        paceOffsetSeconds,
        level,
        marathonGoal,
      };
    });

    return NextResponse.json({ groups: transformedGroups || [] });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
