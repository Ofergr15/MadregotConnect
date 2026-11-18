/**
 * Where a fresh sign-in lands. An academy-only trainee (in the academy, no club group)
 * has no club week, so the feed's week card showed the CLUB plan and its 113 km target
 * (QA 11-18). They land on Today (/dashboard), their own screen; everyone else on the feed.
 * The feed stays reachable from the tab bar — this is only the first screen after login.
 */
export function postLoginPath(p: { role?: string | null; roles?: string[] | null; isAcademy?: boolean | null; groupId?: string | null }): string {
  const academy = !!p.isAcademy || p.role === 'academy_user' || !!p.roles?.includes('academy_user');
  return academy && !p.groupId ? '/dashboard' : '/feed';
}
