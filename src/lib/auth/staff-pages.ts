/**
 * Screens that are the club staff's own. A plain member who reaches one by its
 * address (the menu never offers them) gets one clear "this is for the club's staff"
 * screen instead of a staff screen's empty shell, or the English error of the API
 * it can't read (screens audit 2026-10-19, items 2 + 8).
 *
 * An explicit list, not the menu's permission matrix: the matrix turns `settings`
 * off for runners, yet a runner's own settings live on that page. Each screen's API
 * still decides on its own; this only decides what is drawn.
 */
export const STAFF_ONLY_PATHS = [
  '/dashboard/people',
  '/dashboard/roles',
  '/dashboard/entry-queue',
  '/dashboard/athletes',
  '/dashboard/groups',
  '/dashboard/history',
  '/dashboard/plan/new',
  '/dashboard/content',
  '/dashboard/control-room',
  '/dashboard/move',
  '/dashboard/week',
] as const;

/** Any staff role opens them all; approving members is enough for the entry queue. */
const STAFF = new Set(['admin', 'coach', 'academy_coach', 'academy_manager']);

export function isStaffOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return STAFF_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface StaffGateMe { role?: string; roles?: string[]; isSuper?: boolean; canApprove?: boolean }

/** Whether this account may see the staff screen at `pathname`. Unknown → yes (the API still answers). */
export function mayOpenStaffPage(me: StaffGateMe | null | undefined, pathname: string): boolean {
  if (!me) return true;
  if (me.isSuper) return true;
  const held = [me.role, ...(me.roles ?? [])].filter(Boolean) as string[];
  if (held.some((r) => STAFF.has(r))) return true;
  if (me.canApprove && (pathname === '/dashboard/entry-queue' || pathname.startsWith('/dashboard/entry-queue/'))) return true;
  return false;
}
