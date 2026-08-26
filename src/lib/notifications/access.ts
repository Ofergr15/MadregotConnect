// Shared auth decision for both /api/notifications/inbox and
// /api/notifications/unread — an athlete's own notification history/count is
// visible to: the super user, staff (coach/admin/academy_coach), or the
// athlete themself. Was previously wide open on /inbox (any athleteId in the
// query string returned that athlete's full history, no auth check) and
// missed entirely on /unread when /inbox was hardened — kept here once so
// neither route can silently drift from the other again.
export function canViewAthleteNotifications(params: {
  isSuper: boolean;
  caller: { id: string; role: string } | null;
  athleteId: string;
}): boolean {
  const { isSuper, caller, athleteId } = params;
  if (isSuper) return true;
  if (!caller) return false;
  const isStaff = ['coach', 'admin', 'academy_coach'].includes(caller.role);
  return isStaff || caller.id === athleteId;
}
