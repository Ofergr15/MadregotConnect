/**
 * Who a poll is for — the same rule the push uses to pick its recipients
 * (lib/push.ts resolveAudience) and the home's "סקר פתוח מחכה לך" uses to list it
 * (GET /api/surveys/open): the whole club, one group (athletes.group_id), the academy,
 * or one athlete. A vote from outside that audience is refused (round 6 bug hunt):
 * before, any member could answer a group's "who is coming tomorrow" poll by opening its
 * URL, and their answer landed in that group's count and name list.
 */
export interface SurveyAudience { audience_type: string | null; audience_id: string | null }
export interface SurveyVoter { id: string; group_id: string | null; is_academy: boolean | null }

export function surveyAudienceAllows(s: SurveyAudience, a: SurveyVoter): boolean {
  switch (s.audience_type ?? 'all') {
    case 'all': return true;
    case 'group': return !!s.audience_id && s.audience_id === a.group_id;
    case 'academy': return a.is_academy === true;
    case 'athlete': return !!s.audience_id && s.audience_id === a.id;
    default: return false;
  }
}
