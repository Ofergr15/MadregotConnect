import { defaultViewFor, navRoleFor, viewsFor, type RoleView } from '@/lib/role-views';

/**
 * Which lens /dashboard/academy renders for the account's OWN session (not a
 * preview, not view-as) — pulled out of the page so the launch fixes are testable:
 *
 *  - BL5 / N4: no stored view → the DEFAULT view from the whole roles list, so a
 *    manager starts as the manager; the coach lens is always scoped to the coach's
 *    own trainees (`scopeCoach`) — a manager's account in it must not be fed the
 *    whole academy.
 *  - N9: a STAFF link (`?tab=`, `?thread=<traineeId>`) opened while the account sits
 *    in its runner view switches it to the staff view that link needs (`adopt`), and
 *    keeps the params — instead of the trainee lens' "אינך חבר באקדמיה".
 *  - N10: a TRAINEE link (`?thread=mine`, `?test=mine|entry`) opened by an academy
 *    member who also holds a staff role gets the trainee lens, so a coach who is
 *    also a trainee can read his own thread and confirm his own test.
 */
export interface LensInput {
  /** localStorage `active_view`, or null. */
  storedView: RoleView | null;
  primaryRole: string | null | undefined;
  roles: readonly string[];
  isSuper: boolean;
  /** /api/auth/me `isAcademy`. */
  isAcademy: boolean;
  /** `?tab=` already checked against the page's allow-list. */
  linkTab: string | null;
  /** `?thread=<traineeId>` (not `mine`). */
  linkThread: string | null;
  /** `?thread=mine`, `?test=mine` or `?test=entry`. */
  traineeLink: boolean;
}

export interface Lens {
  view: RoleView;
  /** The nav role the page reasons with ('admin', 'academy_coach', 'coach', 'runner', …). */
  role: string;
  isManager: boolean;
  isStaff: boolean;
  scopeCoach: boolean;
  /** A view to store quietly (N9), or null. */
  adopt: RoleView | null;
}

const MANAGER_TABS = new Set(['funnel', 'registrations', 'coaches', 'settings', 'payments']);

export function academyLens(input: LensInput): Lens {
  const views = viewsFor(input.roles, input.isSuper);
  const stored = input.storedView && views.includes(input.storedView) ? input.storedView : null;
  let view: RoleView = stored ?? defaultViewFor(input.primaryRole, input.isSuper, input.roles);
  if (!views.includes(view)) view = views[0] ?? 'runner';

  let adopt: RoleView | null = null;
  const staffLink = !!input.linkTab || !!input.linkThread;
  if (view === 'runner' && staffLink && !input.traineeLink) {
    const wantsManager = !!input.linkTab && MANAGER_TABS.has(input.linkTab);
    const pick: RoleView | null = wantsManager && views.includes('manager') ? 'manager'
      : views.includes('coach') ? 'coach'
        : views.includes('manager') ? 'manager'
          : views.includes('admin') ? 'admin' : null;
    if (pick) { view = pick; adopt = pick; }
  }

  const role = navRoleFor(view, input.roles, input.primaryRole);
  if (input.traineeLink && input.isAcademy) {
    return { view, role, isManager: false, isStaff: false, scopeCoach: false, adopt: null };
  }
  const isManager = view === 'manager' || view === 'admin';
  const isStaff = isManager || role === 'academy_coach' || role === 'coach';
  return { view, role, isManager, isStaff, scopeCoach: isStaff && !isManager, adopt };
}
