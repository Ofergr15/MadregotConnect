'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui';
import { useApi } from '@/lib/api';
import { resolveNavItems, useNavIdentity } from '@/lib/nav-items';
import {
  addedTabs,
  getStoredView,
  homeFor,
  navRoleFor,
  pendingWelcome,
  SEEN_ROLES_KEY,
  setNewTabs,
  switchView,
  viewForRole,
  viewsFor,
  VIEW_TOAST_KEY,
  WELCOME_KEY,
  WELCOME_PARAM,
} from '@/lib/role-views';

// "ברוך הבא לצוות" — what opening the "קיבלת תפקיד חדש" push does (see the
// WELCOME_PARAM block in src/lib/role-views.ts).
//
// Two page loads. The first one sees ?welcome=<role>, switches the account into
// that role's view (a full navigation, like every view switch, because several
// screens read the view once on mount) and leaves the role in sessionStorage.
// The second, the view's home, finds it there and shows the card once, marking
// the added tabs "חדש" in the tab bar.
//
// A grant whose push was missed is caught the same way on the next open: the
// device remembers the roles it last saw and welcomes one that is new.

const ROLE_TITLE: Record<string, string> = {
  coach: 'מאמן',
  academy_coach: 'מאמן אקדמיה',
  academy_manager: 'מנהל אקדמיה',
  admin: 'אדמין',
};

const ROLE_EMOJI: Record<string, string> = {
  coach: '📋',
  academy_coach: '🎓',
  academy_manager: '🎓',
  admin: '🛡️',
};

function readSeen(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_ROLES_KEY) || 'null');
    return Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : null;
  } catch {
    return null;
  }
}

export function RoleWelcome({ name }: { name: string }) {
  const t = useTranslations('nav');
  const identity = useNavIdentity();
  const { data: me } = useApi<{ role?: string; roles?: string[] }>(identity.accountKnown ? '/api/auth/me' : null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ran = useRef(false);

  const roles = me?.roles;
  useEffect(() => {
    if (ran.current || !roles || identity.previewRole) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get(WELCOME_PARAM);
    if (fromLink) {
      params.delete(WELCOME_PARAM);
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    }
    const seen = readSeen();
    localStorage.setItem(SEEN_ROLES_KEY, JSON.stringify(roles));

    // The second load: the switch already happened.
    const landed = sessionStorage.getItem(WELCOME_KEY);
    if (landed) {
      sessionStorage.removeItem(WELCOME_KEY);
      if (roles.includes(landed)) { setWelcome(landed); setOpen(true); }
      return;
    }

    const role = pendingWelcome(roles, fromLink, seen);
    const view = role ? viewForRole(role) : null;
    if (!role || !view || !viewsFor(roles, identity.isSuper).includes(view)) return;

    if (getStoredView() === view && window.location.pathname === homeFor(view, roles)) {
      setWelcome(role);
      setOpen(true);
      return;
    }
    sessionStorage.setItem(WELCOME_KEY, role);
    switchView(view, roles, me?.role);
    // The card says it all; the "עברת לתצוגת…" toast would say it twice.
    sessionStorage.removeItem(VIEW_TOAST_KEY);
  }, [roles, me?.role, identity.previewRole, identity.isSuper]);

  const view = welcome ? viewForRole(welcome) : null;
  const tabs = welcome && view && roles && identity.ready
    ? addedTabs(
        resolveNavItems({ ...identity, previewRole: null, isOperator: false, fallback: true, effectiveRole: navRoleFor(view, roles, me?.role) }),
        resolveNavItems({ ...identity, previewRole: null, isOperator: false, fallback: true, effectiveRole: navRoleFor('runner', roles, me?.role) }),
      )
    : [];

  const marked = useRef(false);
  useEffect(() => {
    if (!open || marked.current || !tabs.length) return;
    marked.current = true;
    setNewTabs(tabs.map(i => i.tab));
    window.dispatchEvent(new Event('new-tabs-changed'));
  }, [open, tabs]);

  if (!welcome) return null;
  const first = name.trim().split(/\s+/)[0] || '';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="space-y-3 pb-2" dir="rtl">
        <div className="text-[34px] leading-none">{ROLE_EMOJI[welcome] || '🎉'}</div>
        <h2 className="text-xl font-extrabold text-ink-700">ברוך הבא לצוות{first ? `, ${first}` : ''}</h2>
        <p className="text-sm leading-relaxed text-ink-500">
          עכשיו אתה גם <b className="text-ink-700">{ROLE_TITLE[welcome] || welcome}</b>.
          {tabs.length ? ' אתה בתצוגה החדשה, ונוספו לך:' : ' אתה בתצוגה החדשה.'}
        </p>
        {tabs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tabs.map(i => (
              <span key={i.tab} className="rounded-[10px] bg-brand-600/[.08] px-2.5 py-1 text-13 font-bold text-brand-600">
                {t(i.labelKey as any)}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs leading-relaxed text-ink-400">
          האימונים שלך כרץ לא הלכו לשום מקום: לוחצים על העיגול עם האותיות שלך ← &quot;התצוגה שלי&quot; ← רץ.
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-12 w-full rounded-pill bg-brand-600 text-base font-bold text-white active:scale-[0.98]"
        >
          הבנתי
        </button>
      </div>
    </Sheet>
  );
}
