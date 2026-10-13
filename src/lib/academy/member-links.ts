import { activityLocalDateStr } from '@/lib/utils';
import { academyBoardUrl } from './deep-links';

type Db = { from: (table: string) => any };

/**
 * Where a coach's reply to a post-run report lands (launch N22). The club's feedback page
 * (`/dashboard/feedback?activity=`) carries club RSVP and nutrition and is not in an
 * academy trainee's nav; an academy member lands on their board, on that run's day.
 * Best-effort: any failed read keeps the club link.
 */
export async function feedbackReplyUrl(
  supabase: Db,
  athleteId: string,
  garminActivityId: number | string | null | undefined,
): Promise<string> {
  const club = garminActivityId ? `/dashboard/feedback?activity=${garminActivityId}` : '/dashboard';
  try {
    const { data: me } = await supabase.from('athletes').select('is_academy').eq('id', athleteId).maybeSingle();
    if (!(me as { is_academy?: boolean } | null)?.is_academy) return club;
    let open: string | null = null;
    if (garminActivityId) {
      const { data: act } = await supabase
        .from('athlete_activities')
        .select('start_time')
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', garminActivityId)
        .maybeSingle();
      const start = (act as { start_time?: string } | null)?.start_time;
      if (start) open = activityLocalDateStr(start);
    }
    return academyBoardUrl({ open });
  } catch {
    return club;
  }
}

/** The board on the first day a watch push carried, for an academy member (plan_pushed). */
export function planPushedUrl(isAcademy: boolean | null | undefined, weekStartDate: string, days: number[]): string {
  if (!isAcademy) return '/dashboard/program';
  const first = days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)[0];
  if (first == null) return academyBoardUrl();
  const d = new Date(`${weekStartDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + first);
  return academyBoardUrl({ open: d.toISOString().slice(0, 10) });
}
