import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { groupDisplayName } from '@/lib/utils';
import { placeholderNameFromEmail } from '@/lib/signup';

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
      .select('id, coach_id, name, email, group_id, garmin_auth, onboarding_status')
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

    return NextResponse.json({
      groups: transformedGroups || [],
      athlete: {
        name: isPlaceholder ? '' : storedName,
        email,
        groupId: athlete.group_id || null,
        garminConnected: !!athlete.garmin_auth,
      },
    });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
