'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  GraduationCap, Plus, Search, Users, ClipboardCheck, CalendarPlus,
  BarChart3, Trophy, Settings as SettingsIcon, UserPlus, LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, Spinner, SkeletonList } from '@/components/ui';
import { AcademyCompliance } from '@/components/AcademyCompliance';
import { AcademyPlanComposer } from '@/components/AcademyPlanComposer';
import { AcademyStats } from '@/components/AcademyStats';
import { AcademyResults } from '@/components/AcademyResults';
import { AcademySettingsPanel } from '@/components/AcademySettings';
import { AcademyRegistrations } from '@/components/AcademyRegistrations';
import { AcademyOverview } from '@/components/academy/AcademyOverview';
import { AcademyMembers } from '@/components/academy/AcademyMembers';
import { AcademyMyView } from '@/components/academy/AcademyMyView';
import { MemberSheet } from '@/components/academy/MemberSheet';
import { sundayOf, type AcademyMember, type AcademyMembersResponse } from '@/components/academy/types';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { getSupabase } from '@/lib/supabase/client';
import { useApi } from '@/lib/api';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';

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

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  status: 'active' | 'invited' | 'paused' | 'disconnected';
  isAcademy?: boolean;
  hasGarmin?: boolean;
}

type Tab = 'overview' | 'members' | 'registrations' | 'plans' | 'compliance' | 'stats' | 'results' | 'settings';

// Same three group hues as lib/utils' groupColorMap (green / sky blue / orange).
const groupColors: Record<string, { bg: string; text: string; border: string }> = {
  'Group 1': { bg: 'bg-accent-600/15', text: 'text-accent-600', border: 'border-accent-600/20' },
  'Group 2': { bg: 'bg-band-2/15', text: 'text-band-2', border: 'border-band-2/20' },
  'Group 3': { bg: 'bg-band-3/15', text: 'text-band-3', border: 'border-band-3/20' },
};

function getGroupStyle(name: string | null) {
  if (!name) return null;
  // A squad we don't recognise gets neutral ink, not a fourth hue.
  return groupColors[name] || { bg: 'bg-ink-300/20', text: 'text-ink-500', border: 'border-ink-300/40' };
}

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Local scrollable variant of the shared SegmentedControl (src/components/ui):
// same track + pill visual language, but segments are `shrink-0` and the
// track scrolls horizontally instead of splitting into equal `flex-1` slots —
// SegmentedControl can't fit 8 options on a single row. Kept local to this
// page rather than changing the shared primitive.
function ScrollableSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }>; badge?: number }>;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-0.5 overflow-x-auto scrollbar-hide rounded-xl bg-card p-1 border border-page', className)}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => { if (!active) { try { navigator.vibrate?.(6); } catch { /* no-op */ } onChange(opt.value); } }}
            className={cn(
              'shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors min-h-[44px]',
              active ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-400 hover:text-ink-900'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
            {/* A count on the tab itself, so pending work is visible without
                opening the tab that holds it. */}
            {!!opt.badge && (
              <span className={cn(
                'ms-0.5 min-w-[18px] px-1 rounded-full text-3xs font-bold tabular-nums',
                active ? 'bg-page text-ink-700' : 'bg-band-3/20 text-band-3',
              )}>
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function AcademyPage() {
  const t = useTranslations('academy');

  // ── Who is looking? Same resolution order as Coach Tools. ──────────────────
  const viewMode = getViewMode();
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;

  const [email, setEmail] = useState<string | null>(null);
  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);
  useEffect(() => {
    setMyAthleteId(localStorage.getItem('athlete_id') || '');
    if (previewRole) { setEmail(''); return; }
    const stored = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (stored) { setEmail(stored); return; }
    getSupabase().auth.getSession()
      .then(({ data }) => setEmail(data.session?.user?.email || ''))
      .catch(() => setEmail(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: meData, isLoading: roleLoading } = useApi<{ role?: string }>(
    !previewRole && email ? '/api/auth/me' : null,
  );
  const role = previewRole || (isSuperUser(email) ? 'admin' : meData?.role) || null;
  const isManager = role === 'admin';
  // Plain `coach` is included because the route serves them, and since migration
  // 077 it serves them a *scoped* payload: any staff caller who isn't the manager
  // sees only the trainees dedicated to them. A club coach with no academy
  // trainees therefore gets an empty academy rather than everyone's, which is the
  // correct answer — the tab still isn't linked for them from Coach Tools.
  const isStaff = isManager || role === 'academy_coach' || role === 'coach';
  // `email === null` means we haven't even looked yet — distinct from "looked
  // and found nobody", which is a real anonymous visitor.
  const resolving = email === null || (!previewRole && !!email && roleLoading);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<Tab>('overview');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  // The open drill-in is held by id, not as a copy of the member. Editing a
  // trainee's coach or their standing hour revalidates the payload, and a
  // snapshot taken when the sheet opened would keep showing what was true
  // before the edit. It also closes itself when the member leaves the payload —
  // which is exactly what should happen on "remove from academy".
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    // Deep-link to a tab, e.g. /dashboard/academy?tab=results (from the header bell).
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (!tab) return;
    // `roster` is the old name for what is now the members directory — links
    // already out in notifications and shared URLs must keep working.
    const normalized = tab === 'roster' ? 'members' : tab;
    const valid: Tab[] = ['overview', 'members', 'registrations', 'plans', 'compliance', 'stats', 'results', 'settings'];
    if (valid.includes(normalized as Tab)) setView(normalized as Tab);
  }, []);

  // ── The one staff payload. Overview and the directory are the same data seen
  //    two ways, so they share a fetch and can't disagree. ────────────────────
  const { data: members, isLoading: membersLoading, mutate: refreshMembers } = useApi<AcademyMembersResponse>(
    isStaff ? `/api/academy/members?weekStart=${weekStart}` : null,
  );

  const selected = useMemo(
    () => members?.members.find((m) => m.athleteId === selectedId) ?? null,
    [members, selectedId],
  );
  const selectMember = useCallback((member: AcademyMember) => setSelectedId(member.athleteId), []);
  // SWR's mutate resolves with the refreshed payload; the sheet only needs to
  // know the refresh finished, and passing the data through would invite a
  // second copy of it living in the child.
  const reloadMembers = useCallback(async () => { await refreshMembers(); }, [refreshMembers]);

  // The club-wide roster is only needed to *add* someone, so it loads when the
  // add sheet is first opened rather than blocking the page's first paint.
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const loadAthletes = useCallback(async () => {
    try {
      const res = await fetch('/api/athletes');
      const data = await res.json();
      setAthletes(data.athletes || []);
    } catch (err) {
      console.error('Failed to fetch athletes:', err);
      setAthletes([]);
    }
  }, []);
  const openAdd = () => { setShowAdd(true); if (athletes === null) loadAthletes(); };

  const setAcademy = async (athleteId: string, isAcademy: boolean) => {
    setSaving(athleteId);
    setAthletes(prev => prev && prev.map(a => (a.id === athleteId ? { ...a, isAcademy } : a)));
    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ id: athleteId, isAcademy }),
      });
      if (!res.ok) throw new Error('save failed');
      // One revalidation refreshes the overview tiles, the group rollup and the
      // directory together — they're all views of this key.
      await refreshMembers();
      // Removing them from the academy drops them from the payload, which closes
      // the sheet on its own now that `selected` is derived from it.
    } catch (err) {
      console.error('Failed to update academy status:', err);
      setAthletes(prev => prev && prev.map(a => (a.id === athleteId ? { ...a, isAcademy: !isAcademy } : a)));
    } finally {
      setSaving(null);
    }
  };

  const addableAthletes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (athletes || [])
      .filter(a => !a.isAcademy && a.status !== 'invited')
      .filter(a => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [athletes, search]);

  // The band and the pace override travel with each trainee: the planner shifts
  // every pace by them before saving and pushing, so it has to resolve them the
  // same way the directory displays them rather than refetch and possibly disagree.
  const planComposerAthletes = useMemo(
    () => (members?.members || []).map(m => ({
      id: m.athleteId,
      name: m.name,
      hasGarmin: m.hasGarmin,
      band: m.band,
      paceOffsetSec: m.paceOffsetSec,
    })),
    [members],
  );

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
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-brand-600/20 w-12 h-12 rounded-2xl flex items-center justify-center ring-1 ring-brand-600/20">
            <GraduationCap className="h-6 w-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-ink-700">{t('title')}</h1>
            <p className="text-sm text-ink-400">{t('mySubtitle')}</p>
          </div>
        </div>
        {/* Passed raw, not `|| null`: `null` means "haven't read storage yet"
            and `''` means "read it, nobody's signed in" — collapsing the two
            would leave an anonymous visitor on a skeleton that never resolves. */}
        <AcademyMyView athleteId={myAthleteId} />
      </div>
    );
  }

  // ── Manager / coach lens ──────────────────────────────────────────────────
  const tabs: Array<{ value: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { value: 'overview', label: t('tabOverview'), icon: LayoutDashboard },
    { value: 'members', label: t('tabMembers'), icon: Users },
    { value: 'registrations', label: t('tabRegistrations'), icon: UserPlus, badge: members?.pending.registrations },
    { value: 'plans', label: t('tabPlans'), icon: CalendarPlus },
    { value: 'compliance', label: t('tabCompliance'), icon: ClipboardCheck },
    { value: 'stats', label: t('tabStats'), icon: BarChart3 },
    { value: 'results', label: t('tabResults'), icon: Trophy, badge: members?.pending.results },
    // Academy-wide settings (registration window, public form copy) are a
    // manager decision, not a per-coach one.
    ...(isManager ? [{ value: 'settings' as Tab, label: t('tabSettings'), icon: SettingsIcon }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-brand-600/20 w-12 h-12 rounded-2xl flex items-center justify-center ring-1 ring-brand-600/20">
            <GraduationCap className="h-6 w-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-ink-700">{t('title')}</h1>
            <p className="text-sm text-ink-400">
              {/* A coach's payload is their own caseload, so calling it the
                  academy's member count would overstate what they're looking at. */}
              {!members
                ? t('subtitle')
                : members.scope === 'coach'
                  ? t('myTraineesCount', { count: members.team.members })
                  : t('membersCount', { count: members.team.members })}
            </p>
          </div>
        </div>
      </div>

      <ScrollableSegmentedControl
        value={view}
        onChange={setView}
        options={tabs}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 mb-6"
      />

      {view === 'overview' ? (
        <AcademyOverview
          data={members}
          isLoading={membersLoading}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          onSelectMember={selectMember}
          onGoTab={setView}
          onChanged={reloadMembers}
        />
      ) : view === 'members' ? (
        <AcademyMembers
          data={members}
          isLoading={membersLoading}
          onSelectMember={selectMember}
          onAdd={openAdd}
        />
      ) : view === 'registrations' ? (
        <AcademyRegistrations />
      ) : view === 'stats' ? (
        <AcademyStats />
      ) : view === 'results' ? (
        <AcademyResults />
      ) : view === 'settings' ? (
        <AcademySettingsPanel />
      ) : view === 'compliance' ? (
        <AcademyCompliance />
      ) : (
        <AcademyPlanComposer athletes={planComposerAthletes} />
      )}

      {/* One drill-in, shared by the overview's lists and the directory — a
          member surfaced anywhere opens the same sheet. */}
      <MemberSheet
        member={selected}
        weekStart={weekStart}
        onOpenChange={(o) => { if (!o) setSelectedId(null); }}
        onRemove={(id) => setAcademy(id, false)}
        removing={!!selected && saving === selected.athleteId}
        // Who coaches whom, and which דבוקה they're in, are the manager's calls; a
        // coach still owns their own trainees' paces, which CoachPairing lets them
        // edit either way.
        coaches={members?.coaches}
        bands={members?.bands}
        canAssign={isManager}
        onChanged={reloadMembers}
      />

      {/* Add Sheet */}
      <Sheet
        open={showAdd}
        onOpenChange={(o) => { if (!o) setShowAdd(false); }}
        title={t('addToAcademy')}
        bodyClassName="px-2"
      >
        <div className="px-2 pb-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('searchAthletes')}
              className="w-full bg-page border border-page rounded-xl ps-9 pe-3 min-h-[44px] text-sm text-ink-700 placeholder:text-ink-400 focus:outline-none focus:border-brand-600"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {athletes === null ? (
            <div className="flex justify-center py-8"><Spinner size={20} /></div>
          ) : addableAthletes.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-8">
              {search ? t('noMatchingAthletes') : t('allAlreadyInAcademy')}
            </p>
          ) : (
            addableAthletes.map(a => {
              const gs = getGroupStyle(a.groupName);
              return (
                <button
                  key={a.id}
                  onClick={() => setAcademy(a.id, true)}
                  disabled={saving === a.id}
                  className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-page/50 active:scale-[0.98] transition-all text-start disabled:opacity-50"
                >
                  <div className="bg-page w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-ink-500 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-700 text-sm truncate">{a.name}</div>
                    <div className="text-xs text-ink-400 truncate">{a.email}</div>
                  </div>
                  {a.groupName && gs && (
                    <span className={cn('text-3xs font-bold px-2 py-0.5 rounded-md border', gs.bg, gs.text, gs.border)}>
                      {a.groupName}
                    </span>
                  )}
                  {saving === a.id ? (
                    <Spinner size={16} className="shrink-0" />
                  ) : (
                    <Plus className="h-4 w-4 text-brand-600 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </Sheet>
    </div>
  );
}
