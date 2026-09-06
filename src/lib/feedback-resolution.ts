/**
 * When marking a report resolved should tell the person who filed it.
 *
 * Pulled out of the PATCH handler as a pure function because the interesting
 * part is not the sending, it's the conditions — and every one of them is a way
 * this feature could turn into a nuisance instead of a courtesy:
 *
 *  - Only on the TRANSITION into a resolved status. Triaging is fiddly (set the
 *    priority, save a note, fix a typo in the note), and each of those saves
 *    PATCHes the same row with the same status. Without a transition check, a
 *    single fixed bug would ping the reporter three or four times.
 *  - Only for a report with an `athlete_id`. Pre-session reports and staff-filed
 *    ones have none, and there is nobody to notify.
 *  - 'done' only, not 'denied'. "We won't do this" is a real answer, but it's a
 *    conversation, not a push notification — and it is not what was asked for.
 */
export type ResolutionStatus = 'new' | 'idea' | 'sprint' | 'denied' | 'done' | null | undefined;

export function shouldNotifyReporter(
  previous: ResolutionStatus,
  next: ResolutionStatus,
  athleteId: string | null | undefined,
): boolean {
  if (!athleteId) return false;
  if (next !== 'done') return false;
  // A row created before `status` had a default reads as null, which is 'new'.
  return (previous || 'new') !== 'done';
}
