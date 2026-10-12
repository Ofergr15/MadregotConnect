import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { resolveGroup } from '@/lib/utils';
import { buildLineup, type LineupRow } from '@/lib/attendance/lineup';

export const dynamic = 'force-dynamic';

/**
 * GET /api/attendance/lineup?weekStart=YYYY-MM-DD&day=0..6
 *
 * Who is coming to one practice, per pack — the feed's next-session card. Any
 * signed-in member: it names only who said YES, with the name and photo the feed
 * already shows them for every run, and the caller's own answer. The full roster
 * (who said no, who didn't answer) stays staff-only in /api/attendance?roster.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get('weekStart') || '';
    const day = Number(searchParams.get('day'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Number.isInteger(day) || day < 0 || day > 6) {
      return NextResponse.json({ error: 'weekStart and day required' }, { status: 400 });
    }
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const { data, error } = await createServerClient()
      .from('workout_attendance')
      .select('athlete_id, attending, group_label, athletes(name, avatar_url, groups!group_id(name))')
      .eq('week_start_date', weekStart)
      .eq('day_of_week', day)
      .order('updated_at', { ascending: true });
    if (error) throw error;

    const me = caller.athleteId || null;
    // Only the caller's own "no" leaves the server; everyone else's is dropped here.
    const rows: LineupRow[] = (data || [])
      .filter((r: any) => r.attending || r.athlete_id === me)
      .map((r: any) => ({
        athlete_id: r.athlete_id,
        attending: !!r.attending,
        group_label: r.group_label,
        name: r.athletes?.name ?? null,
        avatar_url: r.athletes?.avatar_url ?? null,
        home: r.athletes?.groups?.name ? resolveGroup(r.athletes.groups.name).index : -1,
      }));
    // The caller's own pack, so the card can put their lane first before they answer.
    let homeIndex = -1;
    if (me) {
      const { data: a } = await createServerClient().from('athletes').select('groups!group_id(name)').eq('id', me).maybeSingle();
      const gname = (a as any)?.groups?.name as string | undefined;
      if (gname) homeIndex = resolveGroup(gname).index;
    }
    return NextResponse.json({ ...buildLineup(rows, me), homeIndex });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
