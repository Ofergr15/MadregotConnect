'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CalendarDays, ChevronLeft, ChevronRight, Home, MessageSquare, Plus, Search, TrendingUp, UserPlus, Users, X,
} from 'lucide-react';
import { cn, israelToday } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Sheet } from '@/components/ui';
import { WeeklyReview } from '@/components/academy/WeeklyReview';
import { AcademyPlanComposer } from '@/components/AcademyPlanComposer';
import { AcademyResults } from '@/components/AcademyResults';
import { AcademySettingsPanel } from '@/components/AcademySettings';
import { AcademyRegistrations } from '@/components/AcademyRegistrations';
import {
  AREA_OF, AREA_TITLE, AREAS, defaultSectionOf, sectionAllowed, sectionForTab, subTabsOf,
  type AcademyArea, type AcademySection,
} from '@/lib/academy/areas';
import { buildWaiting, todayLine, weekSquares, type AcademyHomeResponse, type WaitingItem } from '@/lib/academy/home';
import {
  buildSuggestions, dismissSuggestion, freeSeats, isHidden, nextSuggestion, snoozeUntilTomorrow,
  SUGGESTION_STORE_KEY, type Suggestion, type SuggestionStore,
} from '@/lib/academy/suggestions';
import { DEFAULT_COACH_CAPACITY } from '@/lib/academy/settings';
import type { Inbox } from '@/lib/academy/thread';
import type { DispatchReport } from '@/lib/academy/dispatch';
import type { AcademyPeopleResponse } from '@/lib/academy/manage';
import { AcademyHome, type QuickKey, type SquareKey } from './AcademyHome';
import { AcademyMembers } from './AcademyMembers';
import { AcademyThreads } from './AcademyThreads';
import { WatchDispatch } from './WatchDispatch';
import { CandidateFunnel } from './CandidateFunnel';
import { WorkoutBook } from './WorkoutBook';
import { TestRegistry } from './TestRegistry';
import { AcademyPayments } from './AcademyPayments';
import { TestBoard } from './TestBoard';
import { MemberSheet } from './MemberSheet';
import { AddMemberSheet, ChangeCoachSheet, postBulk } from './ManageMembersSheets';
import { AcademyAdminButton, CoachesSheet } from './AcademyAdmin';
import {
  PeopleSearchSheet, QuickActionSheet, SHEET_HANDOFF_MS, SuggestionSheet, type QuickFlow, type SearchHit,
} from './AcademyQuickSheets';
import { CoachesBoard } from './CoachesBoard';
import { PaceSuggestionScreen } from './tools/PaceSuggestionScreen';
import { MissedWeekScreen } from './tools/MissedWeekScreen';
import { CopyWeekFlow } from './tools/CopyWeekFlow';
import { iso } from './tools/shared';
import { WEEKDAY_KEYS } from './book/WeekBoard';
import { snoozeUntil } from '@/lib/academy/coach-tools';
import type { CoachToolsResponse, MissedPayload, PaceSuggestionPayload } from '@/lib/academy/coach-tools-payload';
import { PlansWeekStatus } from './PlansWeekStatus';
import { memberCoachIds, memberCoachNames } from '@/lib/academy/members';
import {
  fmtRate, initialsOf, shiftWeek, sundayOf,
  type AcademyCoachSummary, type AcademyMember, type AcademyMembersResponse,
} from './types';

// The academy's staff lens: five areas under the title, each with its sub-tabs
// (lib/academy/areas.ts), the title row with the shared search on every area,
// the home, and the sheets every area can open. The manager and a plain academy
// coach see the same shell; the coach's payloads arrive already scoped to their
// own trainees, and the manager-only sub-tabs, the ⚙ and the "+" are not drawn.

const AREA_ICON: Record<AcademyArea, React.ComponentType<{ className?: string }>> = {
  home: Home, people: Users, plans: CalendarDays, track: TrendingUp, threads: MessageSquare,
};

/** Actionable "didn't reach the watch" states — a re-push fixes these, unlike `blind`. */
const RESEND_STATES = new Set(['send_failed', 'unconfirmed']);

/** "4–10.10", or "28.9–4.10" across a month. */
export function shortWeek(weekStart: string): string {
  const s = new Date(`${weekStart}T12:00:00Z`);
  const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
  const sd = s.getUTCDate(), sm = s.getUTCMonth() + 1, ed = e.getUTCDate(), em = e.getUTCMonth() + 1;
  return sm === em ? `${sd}–${ed}.${em}` : `${sd}.${sm}–${ed}.${em}`;
}

function readStore(): SuggestionStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(SUGGESTION_STORE_KEY) || '{}'); } catch { return {}; }
}

export function AcademyShell({
  isManager, scopeCoach, canEditRoles, canViewAs, myAthleteId, linkTab, linkThread,
}: {
  isManager: boolean;
  /** A manager's account in its "coach" view: every payload narrowed to their own trainees. */
  scopeCoach: boolean;
  canEditRoles: boolean;
  canViewAs: boolean;
  myAthleteId: string | null;
  /** `?tab=` from the URL (already checked against the page's allow-list). */
  linkTab: string | null;
  /** `?thread=<traineeId>` for staff. */
  linkThread: string | null;
}) {
  const [now] = useState(() => new Date());
  const thisWeek = sundayOf(now);
  const [section, setSection] = useState<AcademySection>('overview');
  const [dispatchWeek, setDispatchWeek] = useState(thisWeek);

  // Sheets and jumps.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [threadAthlete, setThreadAthlete] = useState<string | null>(null);
  const [planAthlete, setPlanAthlete] = useState<string | null>(null);
  const [coachMove, setCoachMove] = useState<AcademyMember | null>(null);
  const [coachesOpen, setCoachesOpen] = useState(false);
  const [focusCoach, setFocusCoach] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quick, setQuick] = useState<QuickFlow | null>(null);
  const [quickCoach, setQuickCoach] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [registrationsOpen, setRegistrationsOpen] = useState(false);
  const [more, setMore] = useState<Suggestion | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [traineeFilter, setTraineeFilter] = useState<SquareKey | null>(null);
  const [funnelKey, setFunnelKey] = useState(0);
  const [store, setStore] = useState<SuggestionStore>({});
  useEffect(() => { setStore(readStore()); }, []);
  // The coach tools' screens (mockup academy-coach-tools.html). Held as the payload that
  // opened them, so a screen stays up after its row leaves the list.
  const [paceOpen, setPaceOpen] = useState<PaceSuggestionPayload | null>(null);
  const [missedOpen, setMissedOpen] = useState<MissedPayload | null>(null);
  const [copyOpen, setCopyOpen] = useState<{ athleteId: string; weekStart: string; preselect?: string[] } | null>(null);
  const tt = useTranslations('academyTools');
  const router = useRouter();

  const area: AcademyArea | null = AREA_OF[section];
  const scopeQ = scopeCoach ? 'scope=coach' : '';

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: members, isLoading: membersLoading, mutate: refreshMembers } = useApi<AcademyMembersResponse>(
    `/api/academy/members?weekStart=${thisWeek}${scopeQ ? `&${scopeQ}` : ''}`,
  );
  const { data: prev } = useApi<AcademyMembersResponse>(
    section === 'overview' ? `/api/academy/members?weekStart=${shiftWeek(thisWeek, -1)}${scopeQ ? `&${scopeQ}` : ''}` : null,
  );
  const { data: home, mutate: refreshHome } = useApi<AcademyHomeResponse>(`/api/academy/home${scopeQ ? `?${scopeQ}` : ''}`);
  const { data: inbox } = useApi<Inbox>('/api/academy/threads/inbox');
  const { data: dispatch } = useApi<DispatchReport>(section === 'overview' ? `/api/academy/dispatch?weekStart=${thisWeek}` : null);
  const { data: tools, mutate: refreshTools } = useApi<CoachToolsResponse>(
    section === 'overview' ? `/api/academy/coach-tools${scopeQ ? `?${scopeQ}` : ''}` : null,
  );
  const manager = isManager && members?.scope !== 'coach' && !scopeCoach;
  const { data: people, mutate: refreshPeople } = useApi<AcademyPeopleResponse>(manager && addOpen ? '/api/academy/members/people' : null);

  const roster = useMemo(() => members?.members ?? [], [members]);
  const coaches = useMemo(() => members?.coaches ?? [], [members]);
  const capacity = home?.coachCapacity ?? DEFAULT_COACH_CAPACITY;
  const selected = useMemo(() => roster.find((m) => m.athleteId === selectedId) ?? null, [roster, selectedId]);

  const reload = useCallback(async () => { await Promise.all([refreshMembers(), refreshHome()]); }, [refreshMembers, refreshHome]);

  // ── Deep links ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tab = linkTab || (linkThread ? 'threads' : null);
    const next = sectionForTab(tab, isManager);
    if (next) setSection(next);
    if (tab === 'registrations' && isManager) setRegistrationsOpen(true);
    if (linkThread) setThreadAthlete(linkThread);
  }, [linkTab, linkThread, isManager]);

  const go = useCallback((s: AcademySection) => {
    setThreadAthlete(null); setPlanAthlete(null);
    if (s !== 'members') setTraineeFilter(null);
    setSection(sectionAllowed(s, manager) ? s : 'overview');
  }, [manager]);

  const openFunnelCard = useCallback((candidateId: string) => {
    // CandidateFunnel opens `?candidate=` once on mount, as the applicant mail's link does;
    // the key remounts it when the funnel is already showing.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'funnel');
      url.searchParams.set('candidate', candidateId);
      window.history.replaceState(null, '', url.toString());
    } catch { /* the board still opens */ }
    setSelectedId(null);
    setFunnelKey((k) => k + 1);
    setSection('funnel');
  }, []);
  const openThread = useCallback((id: string) => { setSelectedId(null); setThreadAthlete(id); setSection('threads'); }, []);
  const openPlan = useCallback((id: string) => { setSelectedId(null); setPlanAthlete(id); setSection('plans'); }, []);
  const openCoach = useCallback((id: string | null) => { setFocusCoach(id); setCoachesOpen(true); }, []);

  const removeFromAcademy = async (athleteId: string) => {
    setSaving(athleteId);
    try {
      await postBulk({ athleteIds: [athleteId], action: 'remove' });
      await reload();
    } finally { setSaving(null); }
  };

  // ── Waiting, suggestions, badges ──────────────────────────────────────────
  const awaiting = useMemo(() => (inbox?.rows ?? []).filter((r) => r.reason === 'awaiting_reply'), [inbox]);
  const resendRows = useMemo(() => (dispatch?.needsAttention ?? []).filter((r) => RESEND_STATES.has(r.state)), [dispatch]);
  // The coach tools' rows, worded here (messages/*.json) with every number isolated. Hidden
  // on this device when snoozed or decided — the server hides them too once 139 records it.
  const toolRows = useMemo(() => {
    if (!tools) return [];
    const nowMs = Date.now();
    const firstName = (n: string) => n.split(' ')[0] || n;
    const rows: Parameters<typeof buildWaiting>[0]['tools'] = [];
    for (const p of tools.pace) {
      if (isHidden(store, p.key, nowMs)) continue;
      const lead = p.kinds[0];
      const kinds = p.kinds.map((k) => tt(`kindIn.${k.kind}`)).join(tt('waiting.and'));
      rows.push({
        key: p.key, kind: 'pace', ageHours: null, action: tt('waiting.paceAction'),
        title: tt(lead.direction === 'faster' ? 'waiting.paceFaster' : 'waiting.paceSlower', { name: firstName(p.name), kinds }),
        sub: tt('waiting.paceSub', {
          moved: iso(lead.moved), of: iso(lead.sessions.length), sec: iso(Math.abs(lead.deltaSec)),
          dir: tt(lead.direction === 'faster' ? 'waiting.faster' : 'waiting.slower'),
        }),
        target: { section: 'overview', tool: { kind: 'pace', athleteId: p.athleteId } },
      });
    }
    for (const m of tools.missed) {
      if (isHidden(store, m.key, nowMs)) continue;
      const what = (s: MissedPayload['sessions'][number]) =>
        s.isLong ? 'long' : s.label === 'טמפו' ? 'tempo' : /×/.test(s.label) ? 'reps' : 'run';
      const list = m.sessions.filter((s) => s.color === 'red')
        .map((s) => tt('waiting.missedOf', { what: tt(`what.${what(s)}`), day: tt(`dayOn.${WEEKDAY_KEYS[s.dayOfWeek]}`) }))
        .join(tt('waiting.and'));
      rows.push({
        key: m.key, kind: 'missed', ageHours: null, action: tt('waiting.missedAction'),
        title: m.rule === 'long'
          ? tt('waiting.missedLong', { name: firstName(m.name) })
          : tt(m.weekStart === tools.thisWeek ? 'waiting.missedThis' : 'waiting.missedLast', { name: firstName(m.name), missed: iso(m.missed), planned: iso(m.planned) }),
        sub: list,
        target: { section: 'overview', tool: { kind: 'missed', athleteId: m.athleteId } },
      });
    }
    const e = tools.emptyNext;
    if (e && e.sourceId && !isHidden(store, e.key, nowMs)) {
      rows.push({
        key: e.key, kind: 'copy', ageHours: null, action: tt('waiting.copyAction'),
        title: e.trainees.length === 1 ? tt('waiting.copyOne', { name: firstName(e.trainees[0].name) }) : tt('waiting.copyMany', { count: iso(e.trainees.length) }),
        sub: tt('waiting.copySub'),
        target: { section: 'overview', tool: { kind: 'copy', athleteId: e.sourceId } },
      });
    }
    return rows;
  }, [tools, store, tt]);

  const waiting: WaitingItem[] = useMemo(() => buildWaiting({
    now: now.toISOString(),
    threads: awaiting.map((r) => ({ athleteId: r.athleteId, name: r.name, waitingHours: r.waitingHours })),
    dispatch: resendRows.map((r) => ({ athleteId: r.athleteId, name: r.name, sentAt: r.sentAt })),
    forms: manager ? home?.funnel?.forms : [],
    stuck: manager ? home?.funnel?.stuck : [],
    approvals: home?.approvals,
    registrations: manager ? members?.pending.registrations : 0,
    results: members?.pending.results,
    tools: toolRows,
  }), [now, awaiting, resendRows, manager, home, members, toolRows]);

  const suggestions = useMemo(() => buildSuggestions({
    members: roster, coaches, capacity, isManager: manager,
    dispatch: resendRows.map((r) => ({ athleteId: r.athleteId, name: r.name })),
    today: israelToday(now),
  }), [roster, coaches, capacity, manager, resendRows, now]);
  const suggestion = nextSuggestion(suggestions, store, Date.now());
  const saveStore = (next: SuggestionStore) => {
    setStore(next);
    try { localStorage.setItem(SUGGESTION_STORE_KEY, JSON.stringify(next)); } catch { /* memory only */ }
  };

  const unpaired = roster.filter((m) => m.approved && memberCoachIds(m).length === 0).length;
  const badges: Record<AcademyArea, number> = {
    home: 0,
    people: manager ? unpaired + (home?.funnel?.forms.length ?? 0) + (members?.pending.registrations ?? 0) : 0,
    plans: 0,
    track: (home?.approvals.length ?? 0) + (members?.pending.results ?? 0),
    threads: inbox?.counts.awaiting_reply ?? 0,
  };

  const runSuggestion = async (s: Suggestion) => {
    if (s.kind === 'pair' && s.coachId) {
      setAssigning(true);
      // 'addCoach', not 'coach': if somebody got a coach meanwhile, they keep them.
      const r = await postBulk({ athleteIds: s.people.map((p) => p.id), action: 'addCoach', coachIds: [s.coachId], notify: true });
      setAssigning(false);
      if (r.ok) await reload();
      return;
    }
    if (s.kind === 'write') { openThread(s.people[0].id); return; }
    go('dispatch');
  };

  const onWaiting = (w: WaitingItem) => {
    const tool = w.target.tool;
    if (tool && tools) {
      if (tool.kind === 'pace') { setPaceOpen(tools.pace.find((p) => p.athleteId === tool.athleteId) ?? null); return; }
      if (tool.kind === 'missed') { setMissedOpen(tools.missed.find((m) => m.athleteId === tool.athleteId) ?? null); return; }
      if (tool.kind === 'copy' && tool.athleteId) {
        setCopyOpen({ athleteId: tool.athleteId, weekStart: tools.thisWeek, preselect: tools.emptyNext?.trainees.map((x) => x.id) });
        return;
      }
    }
    if (w.target.candidateId) { openFunnelCard(w.target.candidateId); return; }
    if (w.target.threadId) { openThread(w.target.threadId); return; }
    go(w.target.section);
    if (w.target.registrations) setRegistrationsOpen(true);
  };

  const onQuick = (k: QuickKey) => {
    if (k === 'add') setAddOpen(true);
    else if (k === 'move') setQuick('move');
    else openCoach(null);
  };

  const onSearch = (hit: SearchHit) => {
    if (hit.kind === 'candidate') { openFunnelCard(hit.id); return; }
    if (hit.kind === 'coach') { openCoach(hit.id); return; }
    if (area === 'threads') { openThread(hit.id); return; }
    if (area === 'plans') { openPlan(hit.id); return; }
    setSelectedId(hit.id);
  };

  // ── Title row ─────────────────────────────────────────────────────────────
  const funnelLive = home?.funnel?.live ?? 0;
  const coachCount = coaches.filter((c) => c.coachId).length;
  const approvedCount = roster.filter((m) => m.approved).length;
  const today = todayLine(home?.today);
  const week = <>השבוע <bdi dir="ltr">{shortWeek(section === 'dispatch' ? dispatchWeek : thisWeek)}</bdi></>;
  const subtitle: React.ReactNode =
    area === 'home' ? <>{week}{today && <> · <span className="font-extrabold text-[#5B21D6]">{today}</span></>}</>
    : area === 'people' ? (manager
      ? <><bdi dir="ltr">{approvedCount}</bdi> מתאמנים · <bdi dir="ltr">{funnelLive}</bdi> מועמדים · <bdi dir="ltr">{coachCount}</bdi> מאמנים</>
      : <><bdi dir="ltr">{approvedCount}</bdi> מתאמנים</>)
    : area === 'threads' ? (awaiting.length ? <><bdi dir="ltr">{awaiting.length}</bdi> מחכות לתשובה</> : 'כל השיחות')
    : area ? week
    : 'ניהול האקדמיה';
  const title = area ? AREA_TITLE[area] : section === 'payments' ? 'תשלומים' : 'הגדרות';
  const searchHint = area === 'threads' ? 'מתאמן נפתח בשיחה שלו' : area === 'plans' ? 'מתאמן נפתח בתוכנית שלו' : undefined;

  const subTabs = area ? subTabsOf(area, manager) : [];
  const subCount: Partial<Record<AcademySection, number>> = { members: approvedCount, funnel: funnelLive, coaches: coachCount };

  return (
    <div dir="rtl">
      <div className="mb-2.5 flex items-center gap-2">
        {!area && (
          <button type="button" onClick={() => go('overview')} aria-label="חזרה לבית"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-ink-500"><ChevronRight className="h-5 w-5" /></button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[25px] font-black leading-[1.05] tracking-tight text-ink-700">{title}</h1>
          <small className="mt-0.5 block truncate text-xs font-semibold text-ink-400">{subtitle}</small>
        </div>
        {section === 'dispatch' && (
          <span className="flex shrink-0 items-center gap-1">
            <RoundButton label="השבוע הקודם" onClick={() => setDispatchWeek(shiftWeek(dispatchWeek, -1))}><ChevronRight className="h-5 w-5" /></RoundButton>
            <RoundButton label="השבוע הבא" onClick={() => setDispatchWeek(shiftWeek(dispatchWeek, 1))} disabled={dispatchWeek >= thisWeek}><ChevronLeft className="h-5 w-5" /></RoundButton>
          </span>
        )}
        <RoundButton label="חיפוש" onClick={() => setSearchOpen(true)}><Search className="h-5 w-5" /></RoundButton>
        {area === 'people' && manager && (
          <RoundButton label="פעולה מהירה" onClick={() => setQuick('menu')} primary><Plus className="h-5 w-5" /></RoundButton>
        )}
        {area === 'home' && manager && (
          <AcademyAdminButton
            onOpenCoaches={() => openCoach(null)}
            onOpenSettings={() => go('settings')}
            onOpenPayments={() => go('payments')}
            canEditRoles={canEditRoles}
            members={roster}
            onGoTab={(t) => go(t)}
          />
        )}
      </div>

      <AreasBar value={area} badges={badges} onChange={(a) => go(defaultSectionOf(a))} />

      {subTabs.length > 1 && (
        <div className="mt-2.5 flex rounded-[13px] bg-ink-300/30 p-[3px]" role="tablist">
          {subTabs.map((t) => {
            const on = t.section === section;
            const n = subCount[t.section];
            return (
              <button key={t.section} type="button" role="tab" aria-selected={on} onClick={() => go(t.section)}
                className={cn('min-h-[38px] flex-1 rounded-[10px] text-[13px] font-extrabold', on ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400')}>
                {t.label}{n !== undefined && <em className="ms-1 not-italic opacity-55 tabular-nums">{n}</em>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2.5">
        {section === 'overview' ? (
          <AcademyHome
            data={members}
            isLoading={membersLoading}
            prev={prev}
            home={home}
            waiting={waiting}
            suggestion={suggestion}
            suggestionBusy={assigning}
            capacity={capacity}
            isManager={manager}
            onSquare={(k) => { setTraineeFilter(k); setSection('members'); }}
            onSuggestion={(s) => void runSuggestion(s)}
            onSuggestionMore={setMore}
            onQuick={onQuick}
            onWaiting={onWaiting}
            strips={tools?.strips}
            onStrip={(id) => router.push(`/dashboard/academy/week?athleteId=${encodeURIComponent(id)}`)}
          />
        ) : section === 'members' ? (
          traineeFilter ? (
            <FilteredTrainees members={roster} filter={traineeFilter} onClear={() => setTraineeFilter(null)} onSelect={(m) => setSelectedId(m.athleteId)} />
          ) : (
            <AcademyMembers
              data={members}
              isLoading={membersLoading}
              onSelectMember={(m) => setSelectedId(m.athleteId)}
              isManager={manager}
              onChanged={reload}
              onOpenFunnel={openFunnelCard}
              myAthleteId={myAthleteId}
              embedded
            />
          )
        ) : section === 'funnel' ? (
          <>
            {!!members?.pending.registrations && (
              <button type="button" onClick={() => setRegistrationsOpen(true)}
                className="mb-2.5 flex min-h-[52px] w-full items-center gap-3 rounded-card bg-card px-3.5 text-start">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-600/15 text-accent-900"><UserPlus className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0 flex-1 text-sm font-bold text-ink-700">
                  {members.pending.registrations === 1 ? 'טופס הצטרפות חדש למועדון' : <><bdi dir="ltr">{members.pending.registrations}</bdi> טפסי הצטרפות חדשים למועדון</>}
                </span>
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
              </button>
            )}
            <CandidateFunnel key={funnelKey} showRegistrations={false} />
          </>
        ) : section === 'coaches' ? (
          <CoachesBoard members={roster} onSelectMember={(m) => setSelectedId(m.athleteId)} onOpenCoach={(id) => openCoach(id)} canManage={manager} />
        ) : section === 'plans' ? (
          <>
          {/* Who still needs something this week, above the composer that fixes it. */}
          {!planAthlete && <div className="mb-3"><PlansWeekStatus weekStart={sundayOf(new Date())} members={roster} onBuild={openPlan} /></div>}
          <AcademyPlanComposer
            key={planAthlete ?? 'plans'}
            athletes={roster.map((m) => ({ id: m.athleteId, name: m.name, hasGarmin: m.hasGarmin, band: m.band, paceOffsetSec: m.paceOffsetSec }))}
            initialAthleteId={planAthlete}
          />
          </>
        ) : section === 'book' ? (
          <WorkoutBook />
        ) : section === 'dispatch' ? (
          <WatchDispatch weekStart={dispatchWeek} onBuild={openPlan} />
        ) : section === 'compliance' ? (
          <WeeklyReview />
        ) : section === 'tests' ? (
          <TestRegistry scheduling={<TestBoard onSelectAthlete={setSelectedId} />} />
        ) : section === 'results' ? (
          <AcademyResults />
        ) : section === 'threads' ? (
          <AcademyThreads key={threadAthlete ?? 'inbox'} initialOpenId={threadAthlete} />
        ) : section === 'payments' && manager ? (
          <AcademyPayments />
        ) : section === 'settings' && manager ? (
          <AcademySettingsPanel />
        ) : null}
      </div>

      {/* ── The coach tools ── */}
      {paceOpen && (
        <PaceSuggestionScreen
          suggestion={paceOpen}
          onClose={() => setPaceOpen(null)}
          onDone={(action) => {
            // The device remembers too: "לא עכשיו" for two weeks, an update until the next
            // test (the key carries the test date). The server agrees once 139 is pasted.
            saveStore({ ...readStore(), [paceOpen.key]: action === 'snooze' ? { until: snoozeUntil(Date.now()) } : { dismissed: true } });
            void refreshTools();
          }}
        />
      )}
      {missedOpen && (
        <MissedWeekScreen
          missed={missedOpen}
          thisWeek={thisWeek}
          onClose={() => setMissedOpen(null)}
          onDone={() => { saveStore({ ...readStore(), [missedOpen.key]: { dismissed: true } }); void refreshTools(); }}
          onTalk={(id) => { setMissedOpen(null); openThread(id); }}
        />
      )}
      {copyOpen && (
        <CopyWeekFlow
          athleteId={copyOpen.athleteId}
          weekStart={copyOpen.weekStart}
          preselect={copyOpen.preselect}
          onClose={() => setCopyOpen(null)}
          onDone={() => void refreshTools()}
        />
      )}

      {/* ── Sheets ── */}
      <PeopleSearchSheet open={searchOpen} onOpenChange={setSearchOpen} members={roster} coaches={coaches}
        isManager={manager} onPick={onSearch} hint={searchHint} />

      {manager && (
        <>
          <QuickActionSheet
            open={quick !== null}
            onOpenChange={(o) => { if (!o) { setQuick(null); setQuickCoach(null); } }}
            start={quick ?? 'menu'}
            coachPreset={quickCoach}
            members={roster}
            coaches={coaches}
            capacity={capacity}
            multiCoach={members?.multiCoach}
            onDone={reload}
            onAddTrainee={() => setAddOpen(true)}
            onNewCoach={() => openCoach(null)}
            onInvite={() => setAddOpen(true)}
          />
          <SuggestionSheet
            suggestion={more}
            onOpenChange={(o) => { if (!o) setMore(null); }}
            members={roster}
            coaches={coaches}
            capacity={capacity}
            multiCoach={members?.multiCoach}
            onDone={reload}
            onOpenMember={setSelectedId}
            onOpenThread={openThread}
            onOpenDispatch={() => go('dispatch')}
            onSnooze={(key) => saveStore(snoozeUntilTomorrow(store, key, Date.now()))}
            onDismiss={(key) => saveStore(dismissSuggestion(store, key))}
          />
          <AddMemberSheet
            open={addOpen}
            onOpenChange={setAddOpen}
            addable={people?.addable}
            coaches={coaches}
            bands={members?.bands ?? []}
            multiCoach={members?.multiCoach}
            onDone={async () => { await Promise.all([reload(), refreshPeople()]); }}
            onOpenFunnel={(id) => { setAddOpen(false); setTimeout(() => openFunnelCard(id), SHEET_HANDOFF_MS); }}
          />
          <CoachesSheet
            open={coachesOpen}
            onOpenChange={setCoachesOpen}
            members={roster}
            onSelectMember={(m) => setSelectedId(m.athleteId)}
            focusCoach={focusCoach}
          />
          <Sheet open={registrationsOpen} onOpenChange={setRegistrationsOpen} title="טפסי הצטרפות למועדון">
            <AcademyRegistrations />
          </Sheet>
          <ChangeCoachSheet
            open={!!coachMove}
            onOpenChange={(o) => {
              if (o) return;
              const back = coachMove?.athleteId ?? null;
              setCoachMove(null);
              if (back) setTimeout(() => setSelectedId(back), SHEET_HANDOFF_MS);
            }}
            members={coachMove ? [coachMove] : []}
            coaches={coaches}
            multiCoach={members?.multiCoach}
            onDone={reload}
          />
        </>
      )}
      {/* A coach's ⋯ (a "write to" suggestion) needs no roster rights. */}
      {!manager && (
        <SuggestionSheet
          suggestion={more}
          onOpenChange={(o) => { if (!o) setMore(null); }}
          members={roster}
          coaches={coaches}
          capacity={capacity}
          onDone={reload}
          onOpenMember={setSelectedId}
          onOpenThread={openThread}
          onOpenDispatch={() => go('dispatch')}
          onSnooze={(key) => saveStore(snoozeUntilTomorrow(store, key, Date.now()))}
          onDismiss={(key) => saveStore(dismissSuggestion(store, key))}
        />
      )}

      <MemberSheet
        member={selected}
        weekStart={thisWeek}
        onOpenChange={(o) => { if (!o) setSelectedId(null); }}
        onRemove={manager ? (id) => void removeFromAcademy(id) : undefined}
        removing={!!selected && saving === selected.athleteId}
        coaches={members?.coaches}
        bands={members?.bands}
        canAssign={manager}
        onChanged={reload}
        onChangeCoach={manager ? (m) => { setSelectedId(null); setTimeout(() => setCoachMove(m), SHEET_HANDOFF_MS); } : undefined}
        onOpenThread={openThread}
        onOpenPlan={openPlan}
        onOpenTests={() => { setSelectedId(null); go('tests'); }}
        canViewAs={canViewAs}
      />
    </div>
  );
}

// ── The areas bar ───────────────────────────────────────────────────────────

export function AreasBar({ value, badges, onChange }: {
  value: AcademyArea | null;
  badges: Partial<Record<AcademyArea, number>>;
  onChange: (a: AcademyArea) => void;
}) {
  return (
    <nav className="grid grid-cols-5 gap-0.5 rounded-[18px] bg-card p-1" aria-label="אזורי האקדמיה">
      {AREAS.map(({ key, label }) => {
        const Icon = AREA_ICON[key];
        const on = value === key;
        const n = badges[key] ?? 0;
        return (
          <button key={key} type="button" onClick={() => { if (!on) { try { navigator.vibrate?.(6); } catch { /* no-op */ } onChange(key); } }}
            aria-current={on ? 'page' : undefined}
            aria-label={n ? `${label}, ${n} מחכים` : label}
            className={cn('relative flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[14px] text-[11px] font-extrabold',
              on ? 'bg-brand-600 text-white shadow-[0_4px_12px_rgba(21,37,255,.28)]' : 'text-ink-400')}>
            {n > 0 && (
              <b className={cn('absolute top-0.5 h-[17px] min-w-[17px] rounded-[9px] border-2 bg-[#E5484D] px-1 text-center text-[10px] leading-[13px] text-white tabular-nums',
                on ? 'border-brand-600' : 'border-card')} style={{ left: 'calc(50% - 22px)' }}>{n}</b>
            )}
            <Icon className="h-5 w-5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function RoundButton({ label, onClick, children, primary, disabled }: {
  label: string; onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} disabled={disabled}
      className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-30',
        primary ? 'bg-brand-600 text-white' : 'bg-card text-ink-700 active:bg-page')}>
      {children}
    </button>
  );
}

// ── People → trainees, filtered from a home square ──────────────────────────

const FILTER_LABEL: Record<SquareKey, string> = { onPlan: 'בתוכנית', behind: 'מאחור', notRun: 'לא רצו' };

function FilteredTrainees({ members, filter, onClear, onSelect }: {
  members: AcademyMember[]; filter: SquareKey; onClear: () => void; onSelect: (m: AcademyMember) => void;
}) {
  const list = weekSquares(members)[filter];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-ink-500">השבוע:</span>
        <button type="button" onClick={onClear} className="flex min-h-[36px] items-center gap-1.5 rounded-pill bg-ink-700 px-3 text-xs font-bold text-white">
          {FILTER_LABEL[filter]} <bdi dir="ltr">{list.length}</bdi> <X className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onClear} className="ms-auto min-h-[44px] px-1 text-xs font-bold text-brand-600">כל המתאמנים</button>
      </div>
      <div className="overflow-hidden rounded-card bg-card">
        {list.map((m) => (
          <button key={m.athleteId} type="button" onClick={() => onSelect(m)}
            className="flex h-[54px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/15 text-xs font-black text-brand-600">{initialsOf(m.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-extrabold text-ink-700" dir="auto">{m.name}</span>
              <span className="block truncate text-2xs text-ink-400">
                {m.weekRuns === 0
                  ? (m.daysSinceActivity !== null ? `לא רץ ${m.daysSinceActivity} ימים` : 'לא רץ השבוע')
                  : m.plannedCount > 0 ? <><bdi dir="ltr">{m.completedCount}/{m.plannedCount}</bdi> השבוע</> : `${m.weekRuns} ריצות השבוע`}
                {memberCoachNames(m).filter(Boolean).length ? ` · ${memberCoachNames(m).filter(Boolean).map((n) => n.split(' ')[0]).join(', ')}` : ''}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
          </button>
        ))}
        {list.length === 0 && <p className="px-4 py-5 text-sm text-ink-400">אין אף אחד כאן השבוע</p>}
      </div>
    </div>
  );
}

// ── People → coaches (inline until the coaches board lands) ─────────────────


