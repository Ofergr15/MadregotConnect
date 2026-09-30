// The top bar's view switcher: which of the account's OWN roles the app is
// showing right now.
//
// Not the super user's "view as" (src/lib/impersonation.ts). That one previews
// somebody else's app and deliberately turns things off while it does — no
// open-sync, no identity on the academy and Coach Tools screens — because the
// previewer's own data isn't the previewed account's. This is the person's own
// account in a different hat, so none of that applies, and it has its own key so
// the preview's side effects can never fire for it.
//
// Rendering only. Every route still authorizes the real session, so a stale or
// hand-edited key can show a screen, never data the account may not have.

export type RoleView = 'runner' | 'coach' | 'manager' | 'admin';

const KEY = 'active_view';
/**
 * The nav role that view renders as, stored beside it so the screens that decide
 * synchronously on mount (the dashboard's coach-vs-athlete body, the calendar,
 * Coach Tools, the academy) need no roles list to read it. Written and cleared
 * with KEY, and dropped by the header the moment the account stops holding it.
 */
const ROLE_KEY = 'active_view_role';

export interface RoleViewSpec {
  view: RoleView;
  label: string;
  /** What this view shows, one line — the sheet row's subtitle. */
  description: string;
}

export const ROLE_VIEW_SPECS: Record<RoleView, RoleViewSpec> = {
  runner: { view: 'runner', label: 'רץ', description: 'האימונים, הפיד והתוכנית שלי' },
  coach: { view: 'coach', label: 'מאמן', description: 'המתאמנים שלי' },
  manager: { view: 'manager', label: 'מנהל אקדמיה', description: 'כל האקדמיה, מצטרפים ומאמנים' },
  admin: { view: 'admin', label: 'אדמין', description: 'הכול, כולל ניהול המועדון' },
};

/** Short chip text — "מנהל אקדמיה" does not fit the centre of a 390px bar. */
export const ROLE_VIEW_CHIP: Record<RoleView, string> = {
  runner: 'רץ',
  coach: 'מאמן',
  manager: 'מנהל',
  admin: 'אדמין',
};

/**
 * The views an account can switch between, in the sheet's order. Fewer than two
 * means there is nothing to switch, and the chip is not drawn at all — a plain
 * runner sees the top bar exactly as before.
 */
export function viewsFor(roles: readonly string[], isSuper = false): RoleView[] {
  const out: RoleView[] = ['runner'];
  if (roles.includes('coach') || roles.includes('academy_coach')) out.push('coach');
  if (roles.includes('academy_manager')) out.push('manager');
  if (roles.includes('admin') || isSuper) out.push('admin');
  return out;
}

/**
 * The admin screen's "בראש המסך יראה:" line for a set of roles — whether a chip
 * is drawn at all, and what it will offer. Same rule as the chip itself.
 */
export function rolePreview(roles: readonly string[], shown: RoleView): { chip: boolean; text: string } {
  const views = viewsFor(roles);
  if (views.length < 2) return { chip: false, text: 'בלי תווית, כמו כל רץ' };
  const others = views.filter(v => v !== shown).map(v => ROLE_VIEW_SPECS[v].label);
  return { chip: true, text: `ויוכל לעבור לתצוגת ${others.join(' / ')}` };
}

/** The view an account is in when it never chose one: its primary role's. */
export function defaultViewFor(role: string | null | undefined, isSuper = false): RoleView {
  if (role === 'admin' || isSuper) return 'admin';
  if (role === 'coach' || role === 'academy_coach') return 'coach';
  return 'runner';
}

/**
 * The role the nav, the permission matrix and the role-gated screens render as.
 * The matrix has rows for single roles only, so each view borrows the nearest:
 * the coach view is the club coach's row when the account is one, else the
 * academy coach's; the manager view is the academy coach's staff nav (an admin
 * who manages keeps admin's). The runner view keeps a member role such as
 * `core_runner` rather than flattening it.
 */
export function navRoleFor(view: RoleView, roles: readonly string[], primary: string | null | undefined): string {
  switch (view) {
    case 'admin':
      return 'admin';
    case 'manager':
      return roles.includes('admin') ? 'admin' : 'academy_coach';
    case 'coach':
      return roles.includes('coach') ? 'coach' : 'academy_coach';
    default: {
      const staff = ['admin', 'coach', 'academy_coach'];
      return primary && !staff.includes(primary) ? primary : 'runner';
    }
  }
}

/** Where choosing a view lands. */
export function homeFor(view: RoleView, roles: readonly string[]): string {
  if (view === 'manager') return '/dashboard/academy';
  if (view === 'coach') return roles.includes('academy_coach') ? '/dashboard/academy' : '/dashboard/coach-tools';
  return '/dashboard';
}

export function getStoredView(): RoleView | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(KEY);
  return v === 'runner' || v === 'coach' || v === 'manager' || v === 'admin' ? v : null;
}

/**
 * The view to render: the stored choice when the account still holds it, else
 * the default. A role taken away since the choice was made just falls back — the
 * key is cleared by the caller that notices.
 */
export function resolveView(stored: RoleView | null, views: readonly RoleView[], fallback: RoleView): RoleView {
  if (stored && views.includes(stored)) return stored;
  return views.includes(fallback) ? fallback : views[0] ?? 'runner';
}

/**
 * The nav role for the chosen view, or null when nothing was chosen (or the
 * choice is no longer held) so the caller renders the account as it always did.
 * For the screens that read the role synchronously and have `/api/auth/me`
 * cached by the time they mount.
 */
export function activeNavRole(roles: readonly string[] | undefined, primary: string | null | undefined, isSuper = false): string | null {
  const stored = getStoredView();
  if (!stored || !roles) return null;
  if (!viewsFor(roles, isSuper).includes(stored)) return null;
  return navRoleFor(stored, roles, primary);
}

export const VIEW_TOAST_KEY = 'active_view_toast';

/** The stored view's nav role, for the synchronous readers. See ROLE_KEY. */
export function getActiveViewRole(): string | null {
  if (typeof window === 'undefined' || !getStoredView()) return null;
  return localStorage.getItem(ROLE_KEY);
}

/** Remember the choice and go to that view's home. The toast is shown after the load. */
export function switchView(view: RoleView, roles: readonly string[], primary: string | null | undefined) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, view);
  localStorage.setItem(ROLE_KEY, navRoleFor(view, roles, primary));
  sessionStorage.setItem(VIEW_TOAST_KEY, view);
  window.location.assign(homeFor(view, roles));
}

export function clearStoredView() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(ROLE_KEY);
}

// ── A role just granted (the "קיבלת תפקיד חדש" push) ────────────────────────
//
// Granting a role changes nothing on the person's screen by itself: an extra role
// keeps them in the view they were in, and the new tabs only appear once they
// switch in the avatar menu, which most people never open. So the grant sends a
// push to /dashboard?welcome=<role>, and opening it switches them into the role's
// view and shows a one-time card naming the tabs they got.

/** The query parameter the role push carries. */
export const WELCOME_PARAM = 'welcome';
/** sessionStorage: the role to welcome on the page the switch lands on. */
export const WELCOME_KEY = 'role_welcome';
/** localStorage: tabs to mark "חדש" in the tab bar until each is opened once. */
export const NEW_TABS_KEY = 'new_nav_tabs';
/** localStorage: the roles this device last saw, to welcome a grant made while the push was missed. */
export const SEEN_ROLES_KEY = 'seen_roles';

/** Highest first — the one a multi-role grant opens on. */
const WELCOME_ORDER = ['admin', 'academy_manager', 'coach', 'academy_coach'] as const;

/** The view a granted role opens in; null for a role that has none (runner). */
export function viewForRole(role: string): RoleView | null {
  if (role === 'admin') return 'admin';
  if (role === 'academy_manager') return 'manager';
  if (role === 'coach' || role === 'academy_coach') return 'coach';
  return null;
}

/** Roles in `after` that `before` lacked, highest first. */
export function newlyGranted(before: readonly string[], after: readonly string[]): string[] {
  return WELCOME_ORDER.filter(r => after.includes(r) && !before.includes(r));
}

/** The role a welcome is about: the highest of `roles` that has a view of its own. */
export function welcomeRoleOf(roles: readonly string[]): string | null {
  return WELCOME_ORDER.find(r => roles.includes(r)) ?? null;
}

/** Tabs the view adds over the runner view, in nav order — what the card lists. */
export function addedTabs<T extends { tab: string }>(viewItems: readonly T[], runnerItems: readonly T[]): T[] {
  const had = new Set(runnerItems.map(i => i.tab));
  return viewItems.filter(i => !had.has(i.tab) && i.tab !== 'profile');
}

export function getNewTabs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(NEW_TABS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function setNewTabs(tabs: readonly string[]) {
  if (typeof window === 'undefined') return;
  if (tabs.length) localStorage.setItem(NEW_TABS_KEY, JSON.stringify(tabs));
  else localStorage.removeItem(NEW_TABS_KEY);
}

/**
 * What this device should welcome, given the account's roles now: the role named
 * in the push link when the account holds it, else a staff role that appeared
 * since this device last looked. The first look ever records the roles silently,
 * so a device that simply never recorded any does not greet an old coach as new.
 */
export function pendingWelcome(
  roles: readonly string[],
  fromLink: string | null,
  seen: readonly string[] | null,
): string | null {
  if (fromLink && roles.includes(fromLink) && viewForRole(fromLink)) return fromLink;
  if (!seen) return null;
  const fresh = newlyGranted(seen, roles);
  return fresh[0] ?? null;
}
