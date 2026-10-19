import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelToday } from '@/lib/utils';
import { legacyClosed, loadStory } from '@/lib/birthday-year/server';
import { defaultAccessDeps, storyAccess } from '@/lib/stories/access';
import { recentBirthday } from '@/lib/stories/schedule';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/birthday-year[?athleteId=][&preview=1]
 *
 * A birthday story, through THE STORIES GATE (lib/stories/access.ts): the caller's own
 * (the feed's entry card) or another member's (the club post's "צפו בשנה של…"), only
 * while storyGate('birthday') is open to the owner — and to the viewer — and inside the
 * person's display window. `{ story: null }` otherwise. An admin's `preview=1` (the prep
 * screen) looks outside the window, but never while the feature is 'off'. The old
 * `birthday_year_send` switch and per-story `published:true` open nothing any more.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const isAdmin = caller.isSuperUser || hasRole(caller, 'admin');
  const params = new URL(request.url).searchParams;
  const asked = params.get('athleteId');
  const athleteId = asked || caller.athleteId;
  if (!athleteId) return NextResponse.json({ story: null });
  const forcePreview = isAdmin && !!asked && params.get('preview') === '1';
  try {
    const now = new Date();
    const today = israelToday(now);
    const { data: a } = await supabase.from('athletes').select('birth_date').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
    const period = recentBirthday((a as { birth_date?: string | null } | null)?.birth_date, today, 31);
    const access = await storyAccess('birthday', { viewerId: caller.athleteId, ownerId: athleteId, isAdmin, period, now, forcePreview },
      defaultAccessDeps(supabase));
    if (!access.allowed) return NextResponse.json({ story: null });
    const story = await loadStory(supabase, athleteId, today, { preview: access.preview, lookbackDays: 31 });
    if (!story || (!access.preview && legacyClosed(story.config))) return NextResponse.json({ story: null });
    const headline = access.instance?.custom_text?.headline || null;
    return NextResponse.json({ story, preview: access.preview, tester: access.tester, headline, viewingAs: !!caller.viewingAsBy });
  } catch (err) {
    console.error('birthday-year read failed:', err);
    return NextResponse.json({ error: 'Failed to read the year' }, { status: 500 });
  }
}
