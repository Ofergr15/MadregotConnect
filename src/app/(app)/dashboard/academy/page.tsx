'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { SkeletonList } from '@/components/ui';
import { AcademyMyView } from '@/components/academy/AcademyMyView';
import { AcademyShell } from '@/components/academy/AcademyShell';
import { getSupabase } from '@/lib/supabase/client';
import { useApi } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';
import { getActiveViewRole, getStoredView } from '@/lib/role-views';
import { getViewedPerson, isViewingPerson, type ViewedPerson } from '@/lib/view-as-person';
import { hasRole } from '@/lib/auth/roles';
import { readAcademyDeepLink } from '@/lib/academy/deep-links';

// The academy centre. Three audiences, three lenses off the same route:
//
//   admin          → manager: every tab, including Settings and Registrations
//   academy_coach  → coach: the same minus Settings
//   everyone else  → their own academy view (/api/academy/me)
//
// The last one is new. This route used to be coach-only in practice — migration
// 022 denies `academy_user` the academy nav tab on purpose — but tab permissions
// only filter which nav items render, they don't gate the route, so an academy
// athlete who reached the URL got the admin console. Now they get a screen built
// for them, and staff-only data never loads for them at all: the manager payload
// (/api/academy/members, which carries every member's email and approval state)
// is fetched only in the staff branch.
//
// The coach lens is now a real one rather than the manager's screen with fewer
// tabs. Training here is 1:1 — every trainee has one dedicated coach — so the
// payload arrives already scoped to the coach's own trainees, and only the
// manager gets the coach roster, the load-by-coach filter and the ability to
// change who coaches whom.

// Every `?tab=` value a link may carry. The staff screen is five areas now
// (lib/academy/areas.ts maps each of these onto an area and its sub-tab), but links
// already out in notifications and shared URLs name the old fourteen sections, so
// all of them stay valid — `academyFlowMap.test.ts` fails on any gap.
type Tab = 'overview' | 'threads' | 'funnel' | 'members' | 'registrations' | 'coaches' | 'plans' | 'book' | 'dispatch' | 'compliance' | 'tests' | 'stats' | 'results' | 'payments' | 'settings' | 'roster';

export default function AcademyPage() {

  // ── Who is looking? Same resolution order as Coach Tools. ──────────────────
  const viewMode = getViewMode();
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;

  const [email, setEmail] = useState<string | null>(null);
  const myAthleteId = useAthleteId();
  useEffect(() => {
    if (previewRole) { setEmail(''); return; }
    const stored = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    // Not the session's address while viewing as somebody: that one is the admin's.
    if (stored || isViewingPerson()) { setEmail(stored); return; }
    getSupabase().auth.getSession()
      .then(({ data }) => setEmail(data.session?.user?.email || ''))
      .catch(() => setEmail(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: meData, isLoading: roleLoading } = useApi<{ role?: string; roles?: string[] }>(
    !previewRole && email ? '/api/auth/me' : null,
  );
  // The account's own view switch (role-views.ts). Not a preview: identity and
  // /api/auth/me stay on. "Manager" is the academy's manager whatever the nav
  // borrows for it; "coach" on a manager's account narrows the payload to their
  // own trainees (the server honours that — it only ever narrows).
  const activeView = previewRole ? null : getStoredView();
  // Viewing the app as a particular person (lib/auth/view-as.ts): their role, as
  // the server resolves it, decides the lens — not the admin's own. The banner
  // that says so is the shell's (ViewAsBanner), on every screen, not this page's.
  const [viewed, setViewed] = useState<ViewedPerson | null>(null);
  useEffect(() => { setViewed(getViewedPerson()); }, []);
  const { data: viewer } = useApi<{ role: string; roles: string[]; isStaff: boolean; isManager: boolean }>(
    viewed ? '/api/academy/viewer' : null,
  );
  const viewedRole = viewer
    ? (viewer.isManager ? 'admin' : viewer.roles.includes('academy_coach') ? 'academy_coach' : viewer.isStaff ? viewer.role : 'runner')
    : null;
  const role = viewed ? viewedRole : (previewRole || getActiveViewRole() || (isSuperUser(email) ? 'admin' : meData?.role) || null);
  const isManager = viewed ? !!viewer?.isManager : (activeView === 'manager' || (role === 'admin' && activeView !== 'coach'));
  // Plain `coach` is included because the route serves them, and since migration
  // 077 it serves them a *scoped* payload: any staff caller who isn't the manager
  // sees only the trainees dedicated to them. A club coach with no academy
  // trainees therefore gets an empty academy rather than everyone's, which is the
  // correct answer — the tab still isn't linked for them from Coach Tools.
  const isStaff = isManager || role === 'academy_coach' || role === 'coach';
  // `email === null` means we haven't even looked yet — distinct from "looked
  // and found nobody", which is a real anonymous visitor.
  const resolving = email === null || (!previewRole && !!email && roleLoading) || (!!viewed && !viewer);

  // Read through `useSearchParams`, not `window.location` once on mount: a push
  // tapped while this screen is already open is a router navigation to the same
  // route, which keeps the component mounted — so only a hook re-reads the new
  // `?thread=` / `?tab=`. The scheme lives in lib/academy/deep-links.ts.
  const searchParams = useSearchParams();
  const deepLink = useMemo(() => readAcademyDeepLink(searchParams), [searchParams]);
  const valid: Tab[] = ['overview', 'threads', 'funnel', 'members', 'registrations', 'coaches', 'plans', 'book', 'dispatch', 'compliance', 'tests', 'stats', 'results', 'payments', 'settings', 'roster'];
  const linkTab = deepLink.tab && valid.includes(deepLink.tab as Tab) ? deepLink.tab : null;
  const linkThread = deepLink.thread && deepLink.thread !== 'mine' ? deepLink.thread : null;

  if (resolving) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SkeletonList count={5} />
      </div>
    );
  }

  // ── Athlete lens ──────────────────────────────────────────────────────────
  if (!isStaff) {
    return (
      // No page title here: the trainee home draws its own header row (coach,
      // "האקדמיה שלי", the week and its arrows), and it is meant to fit one phone
      // screen (2026-10-06), so on a phone the page adds no padding of its own —
      // the shell's <main> already pads it — exactly like the manager lens.
      <div className="max-w-3xl mx-auto sm:px-6 sm:py-8">
        {/* Passed raw, not `|| null`: `null` means "haven't read storage yet"
            and `''` means "read it, nobody's signed in" — collapsing the two
            would leave an anonymous visitor on a skeleton that never resolves. */}
        <AcademyMyView
          athleteId={viewed ? viewed.id : myAthleteId}
          openThread={deepLink.thread === 'mine'}
          raiseTest={deepLink.test}
        />
      </div>
    );
  }

  // ── Manager / coach lens ──────────────────────────────────────────────────
  return (
    // On a phone the shell's <main> already pads this page, so the page adds no
    // padding of its own there.
    <div className="max-w-5xl mx-auto sm:px-6 lg:px-8 sm:py-8">
      <AcademyShell
        isManager={isManager}
        scopeCoach={activeView === 'coach'}
        canEditRoles={role === 'admin'}
        canViewAs={!viewed && (isSuperUser(email) || hasRole(meData, 'admin'))}
        myAthleteId={myAthleteId}
        linkTab={linkTab}
        linkThread={linkThread}
      />
    </div>
  );
}
