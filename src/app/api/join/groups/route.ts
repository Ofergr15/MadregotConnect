import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { groupDisplayName } from '@/lib/utils';
import { placeholderNameFromEmail } from '@/lib/signup';
import { nameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { quoteFilterValue } from '@/lib/db/like';

/**
 * GET /api/join/groups?token=… — everything /join/{token} needs to render.
 *
 * The invite token IS the credential: unguessable, scoped to exactly one
 * athlete row, and it arrived in that person's own inbox. So besides the pace
 * groups this also returns that row's current state, which is what lets the
 * join screen skip work the athlete has already done — above all, NOT asking
 * for Garmin credentials again when the watch is already connected.
 *
 * `garminConnected` is a boolean and nothing more. The stored credential is
 * encrypted at rest and never leaves the server.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ groups: [] });
    }

    const supabase = createServerClient();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, coach_id, name, email, group_id, garmin_auth, onboarding_status, is_academy')
      .eq('invite_token', token)
      .single();

    if (!athlete) {
      return NextResponse.json({ groups: [] });
    }

    // An academy trainee arrives here from the "you're in" email and is not choosing
    // a club pace group: their coach places them. No groups = no group step, and the
    // join screen's "pick a group" check has nothing to demand.
    const { data: groups } = athlete.is_academy ? { data: [] as any[] } : await supabase
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

      const displayName = groupDisplayName(group.name);

      return {
        id: group.id,
        name: displayName,
        paceOffsetSeconds,
        level,
        marathonGoal,
      };
    });

    // An approved /register request seeds `name` from the email's local part
    // (placeholderNameFromEmail), so echoing it back would prefill the form with
    // a machine guess the athlete would just tap past — and "Dana Levi92" would
    // become their real name in the club. Only a name they actually chose is
    // worth prefilling; the placeholder comes back as empty.
    const email = athlete.email || '';
    const storedName = athlete.name || '';
    const isPlaceholder = !!email && storedName === placeholderNameFromEmail(email);
    // Approved before the approval learned to use it: the name they typed on
    // /register is on their request. Offered only when it is a usable roster name.
    let typedName = '';
    if (isPlaceholder || !storedName) {
      const { data: req } = await supabase.from('signup_requests').select('full_name')
        .or(`athlete_id.eq.${athlete.id},email.eq.${quoteFilterValue(email.toLowerCase())}`)
        .not('full_name', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const t = ((req as { full_name?: string | null } | null)?.full_name || '').trim();
      if (t && nameProblem(t) === null) typedName = normalizeDisplayName(t);
    }

    return NextResponse.json({
      groups: transformedGroups || [],
      athlete: {
        name: isPlaceholder || !storedName ? typedName : storedName,
        email,
        groupId: athlete.group_id || null,
        garminConnected: !!athlete.garmin_auth,
        isAcademy: !!athlete.is_academy,
      },
    });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
