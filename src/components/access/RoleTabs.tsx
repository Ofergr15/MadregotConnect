'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// הרשאות, stage 3 (mockups/access-hub.html, Ofer 10-23: one area; sentences, not a
// grid): what each role sees ("עמודים") and which staff alerts each role receives
// ("התראות"), written as one card per page / per alert with the roles that have it.
// A role chip toggles it. The same data and the same saves as the two screens these
// replace in Settings (role_tab_permissions via /api/admin/tab-permissions, and
// notification_routing via /api/admin/notifications) — those pages stay, off the menu.
// ═════════════════════════════════════════════════════════════════════════════

const ROLE_LABEL: Record<string, string> = {
  admin: 'מנהלים', coach: 'מאמנים', academy_coach: 'מאמני אקדמיה', runner: 'רצים',
  core_runner: 'רצי גרעין', academy_user: 'מתאמני אקדמיה', viewer: 'צופים',
};
const PAGE_ROLES = ['coach', 'academy_coach', 'runner', 'core_runner', 'academy_user', 'viewer'];
const PAGES: Array<{ key: string; nav: string }> = [
  { key: 'dashboard', nav: 'dashboard' }, { key: 'program', nav: 'program' }, { key: 'activities', nav: 'activities' },
  { key: 'records', nav: 'records' }, { key: 'athletes', nav: 'athletes' }, { key: 'groups', nav: 'groups' },
  { key: 'academy', nav: 'academy' }, { key: 'practice-attendance', nav: 'practiceAttendance' },
  { key: 'workout-feedback', nav: 'workoutFeedback' }, { key: 'team-volume', nav: 'teamVolume' },
  { key: 'plan/new', nav: 'planner' }, { key: 'history', nav: 'history' }, { key: 'review', nav: 'review' },
  { key: 'control-room', nav: 'controlRoom' }, { key: 'settings', nav: 'settings' },
];

function Chip({ on, locked, label, busy, onClick }: { on: boolean; locked?: boolean; label: string; busy?: boolean; onClick?: () => void }) {
  return (
    <button type="button" disabled={locked || busy} onClick={onClick} aria-pressed={on}
      className={cn('inline-flex h-[28px] items-center rounded-full px-2.5 text-[12px] font-bold transition-colors disabled:cursor-default',
        on ? 'bg-[#EEF0FF] text-[#1D2A99]' : 'border-[1.5px] border-dashed border-[#d1d5db] bg-transparent text-ink-400',
        busy && 'opacity-50')}>
      {on ? label : `+ ${label}`}{locked ? ' · תמיד' : ''}
    </button>
  );
}

export function PagesTab() {
  const t = useTranslations('nav');
  const { data, mutate } = useApi<{ permissions?: Array<{ role: string; tab: string; enabled: boolean }> }>('/api/admin/tab-permissions');
  const [busy, setBusy] = useState<string | null>(null);
  const has = (role: string, tab: string) => !!data?.permissions?.some((p) => p.role === role && p.tab === tab && p.enabled);
  const toggle = async (role: string, tab: string) => {
    setBusy(`${role}:${tab}`);
    try {
      await fetch('/api/admin/tab-permissions', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ role, tab, enabled: !has(role, tab) }) });
      await mutate();
    } finally { setBusy(null); }
  };
  if (!data) return <div className="h-48 animate-pulse rounded-[16px] bg-card" />;
  return (
    <>
      <p className="mb-2.5 px-1 text-[12.5px] text-ink-500">כל עמוד — מי רואה אותו בתפריט. מנהלים רואים הכל, תמיד. לחיצה על תפקיד מוסיפה או מורידה. אדם אחד שצריך עמוד נוסף — בלשונית אנשים.</p>
      {PAGES.map((pg) => {
        const label = t.has(pg.nav as never) ? t(pg.nav as never) : pg.key;
        const on = PAGE_ROLES.filter((r) => has(r, pg.key));
        return (
          <section key={pg.key} className="mb-2 rounded-[16px] bg-card px-3 py-2.5">
            <b className="block text-[15px] text-ink-900">{label}</b>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="w-[44px] shrink-0 text-[12px] font-extrabold text-[#15803d]">רואים</span>
              <Chip on locked label={ROLE_LABEL.admin} />
              {PAGE_ROLES.map((r) => <Chip key={r} on={on.includes(r)} label={ROLE_LABEL[r]} busy={busy === `${r}:${pg.key}`} onClick={() => void toggle(r, pg.key)} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

interface Routed { kind: string; label: string; hint: string; roles: Record<string, boolean>; recipients?: Array<{ name: string; muted: boolean }> }
export function AlertsTab() {
  const { data, mutate } = useApi<{ migrated: boolean; roles: Array<{ role: string; people: number }>; kinds: Routed[] }>('/api/admin/notifications');
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (k: Routed, role: string) => {
    setBusy(`${k.kind}:${role}`);
    try {
      await fetch('/api/admin/notifications', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ kind: k.kind, role, enabled: !k.roles[role] }) });
      await mutate();
    } finally { setBusy(null); }
  };
  if (!data) return <div className="h-48 animate-pulse rounded-[16px] bg-card" />;
  if (!data.migrated) return <p className="rounded-[16px] bg-card px-4 py-4 text-[14px] text-ink-600">ניתוב התראות הניהול מחכה למיגרציה 099.</p>;
  const roles = data.roles.map((r) => r.role);
  return (
    <>
      <p className="mb-2.5 px-1 text-[12.5px] text-ink-500">כל התראת ניהול — מי מקבל אותה. כל אחד עדיין יכול לכבות אצלו את ערוץ הניהול.</p>
      {data.kinds.map((k) => {
        const names = (k.recipients ?? []).map((p) => (p.muted ? `${p.name} (כיבה)` : p.name));
        return (
          <section key={k.kind} className="mb-2 rounded-[16px] bg-card px-3 py-2.5">
            <b className="block text-[15px] text-ink-900">{k.label}</b>
            <small className="block text-[11.5px] text-ink-400">{k.hint}</small>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] shrink-0 text-[12px] font-extrabold text-[#15803d]">מקבלים</span>
              {roles.map((r) => <Chip key={r} on={!!k.roles[r]} label={ROLE_LABEL[r] ?? r} busy={busy === `${k.kind}:${r}`} onClick={() => void toggle(k, r)} />)}
            </div>
            {names.length > 0 && <p className="mt-1.5 text-[11.5px] text-ink-500">בפועל: {names.join(', ')}</p>}
            {names.length === 0 && <p className="mt-1.5 text-[11.5px] font-bold text-[#b91c1c]">אף אחד לא מקבל את זה כרגע</p>}
          </section>
        );
      })}
    </>
  );
}
