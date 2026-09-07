'use client';

import { useEffect, useState } from 'react';
import { LogOut, ShieldCheck, Stamp, IdCard, Tag, Smartphone, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { APP_VERSION } from '@/lib/version';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { getViewMode, startViewAs, stopViewAs, VIEW_AS_SCENARIOS, MAINTENANCE_MODE } from '@/lib/impersonation';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { MaintenanceRow } from '@/components/MaintenanceToggle';

// ═════════════════════════════════════════════════════════════════════════════
// THE ADMIN'S PROFILE — an account, not an athlete.
//
// The admin account exists so the club can be run from a session that isn't
// anybody's member account. Until now its Profile tab was the member one: weekly
// kilometres, personal records, a pace group, a Garmin connection and a "share
// your workout" row — every line of it about a runner who doesn't exist. The
// control room on /dashboard made the same call for the home screen (v2.39.104);
// this is the other half, and with ADMIN_HIDDEN_TABS the admin's nav now has no
// screen left that is about this account's own training.
//
// What an admin actually needs from a profile is what nothing else in the app
// holds: WHO am I signed in as (three login paths and a view-as switch make that
// a real question), WHAT am I allowed to do, WHICH build is this, and HOW do I
// get out. So: identity, privileges, view-as, system state, sign out.
//
// Deliberately not a second Settings. Every management screen already lives one
// tab away and the control room lists what needs a human today — the rows here
// are the ones that are about the SESSION rather than about the club, which is
// why "view as" moved in: it was reachable only from the header's overflow and
// the tab bar's More sheet, neither of which is a place you'd look for it.
// ═════════════════════════════════════════════════════════════════════════════

interface Me {
  role?: string;
  isSuper?: boolean;
  canApprove?: boolean;
  membership?: string;
}

export function AdminAccount() {
  const t = useTranslations('adminAccount');
  const tCommon = useTranslations('common');
  const { data: me } = useApi<Me>('/api/auth/me');

  // Identity as the rest of the app reads it (same keys as the Header) — the
  // session's own address is the fallback, because a coach-only account has no
  // athlete row and therefore no athlete_name/athlete_email to read.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setName(localStorage.getItem('athlete_name') || '');
    setEmail(localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '');
    setStandalone(window.matchMedia('(display-mode: standalone)').matches);
    setViewMode(getViewMode());
  }, []);

  const initials = (name || email || '?')
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    setSigningOut(true);
    // Same pair as the Header: clear all four claims, then a HARD navigation —
    // a soft one keeps SWR's cache, so the previous account's data sits in
    // memory behind the landing page.
    await signOutEverywhere();
    window.location.href = '/';
  };

  // `common` has no yes/no pair, and adding one there would be a global string
  // three namespaces would then race to own — these read as answers to the rows
  // above them ("granted" / "not granted"), so they live with them.
  const yes = t('granted');
  const no = t('notGranted');

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <header className="flex items-center gap-3 mb-6">
        <span className="shrink-0 w-14 h-14 rounded-full bg-violet-600 text-white flex items-center justify-center text-lg font-bold">
          {initials}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-700 truncate" dir="auto">
            {name || t('title')}
          </h1>
          <p className="text-sm text-ink-400 truncate" dir="ltr">{email}</p>
        </div>
      </header>

      <InsetSection header={t('thisAccount')}>
        <InsetRow
          icon={IdCard}
          iconBg="bg-violet-500"
          label={t('role')}
          value={t('systemAdmin')}
        />
        <InsetRow
          icon={ShieldCheck}
          iconBg="bg-violet-500"
          label={t('superUser')}
          sublabel={t('superUserHint')}
          // The pair below is the whole reason this section exists: both are DB
          // flags an admin can grant another account (migration 084), so "am I
          // the one holding them" was a question with no screen to answer it.
          value={me ? (me.isSuper ? yes : no) : '—'}
          valueSuccess={!!me?.isSuper}
        />
        <InsetRow
          icon={Stamp}
          iconBg="bg-violet-500"
          label={t('approver')}
          sublabel={t('approverHint')}
          value={me ? (me.canApprove ? yes : no) : '—'}
          valueSuccess={!!me?.canApprove}
        />
      </InsetSection>

      {/* Only the super-user can preview a role at all, so the section hides for
          a plain admin rather than offering rows that do nothing. */}
      {me?.isSuper && (
        <InsetSection header={t('viewAs')}>
          {VIEW_AS_SCENARIOS.map(s => (
            <InsetRow
              key={s.mode}
              icon={s.icon}
              iconBg={s.mode === MAINTENANCE_MODE ? 'bg-band-3' : 'bg-ink-400'}
              label={s.label}
              value={viewMode === s.mode ? t('active') : undefined}
              valueSuccess={viewMode === s.mode}
              onClick={() => startViewAs(s.mode)}
            />
          ))}
          {viewMode && (
            <InsetRow
              icon={Undo2}
              iconBg="bg-accent-600"
              label={t('backToMyView')}
              onClick={() => stopViewAs()}
            />
          )}
        </InsetSection>
      )}

      <InsetSection header={t('system')}>
        {/* The same component the Settings screen uses, not a copy of it: the
            gate is the one switch an admin reaches for in a hurry. */}
        <MaintenanceRow />
        <InsetRow
          icon={Tag}
          iconBg="bg-ink-400"
          label={t('version')}
          // The number a bug report has to carry. It's pinned to package.json by
          // versionSync.test.ts, so what this says did actually ship.
          value={APP_VERSION}
        />
        <InsetRow
          icon={Smartphone}
          iconBg="bg-ink-400"
          label={t('installed')}
          sublabel={t('installedHint')}
          value={standalone == null ? '—' : standalone ? t('installedApp') : t('installedBrowser')}
        />
      </InsetSection>

      <InsetSection>
        <InsetRow
          icon={LogOut}
          iconBg="bg-accent-red"
          label={signingOut ? tCommon('loading') : tCommon('signOut')}
          danger
          onClick={signingOut ? undefined : handleSignOut}
        />
      </InsetSection>
    </div>
  );
}
