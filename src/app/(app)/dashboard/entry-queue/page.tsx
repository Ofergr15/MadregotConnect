'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Wrench, Search, Lock, Unlock, Bell, BellOff, Watch, Activity,
  CheckCircle2, UserCheck, ChevronLeft, Users as UsersIcon,
  UserPlus, Mail, Smartphone, AlertTriangle, HelpCircle,
} from 'lucide-react';
import { cn, getGroupChip, groupDisplayName } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import {
  FLOW_GROUPS,
  FLOW_STEPS,
  flowFunnel,
  flowGroup,
  GROUP_OF_STEP,
  memberFlow,
  type EntryQueueMember,
  type FlowGroup,
  type FlowStep,
  type PendingSignupRequest,
} from '@/lib/admin/entry-queue';

// ═════════════════════════════════════════════════════════════════════════════
// "מחכים להיכנס" — the entry queue, as the flow somebody actually walks.
//
// One card per person who isn't all the way in, showing the SIX steps between
// signing up and being a working member, which of them they've passed, and the one
// that is stopping them right now — plus the one action that moves it.
//
// WHAT THIS REPLACED, and why. The screen used to show a row of five or six
// independent chips per person ("לא נכנס מעולם", "אין שעון", "הגדרה 0/5", …). Every
// fact was there and the ORDER wasn't, so reading a card meant reconstructing the
// sequence in your head, and two very different people looked identical: the member
// who never once tried to log in, and the member who logged in successfully and
// whose session was eaten by iOS's in-app browser sheet (migration 082). The first
// needs a reminder; the second needs to be told to reopen the app from its icon. A
// chip that says "לא נכנס מעולם" for both is worse than useless.
//
// So: `memberFlow()` in lib/admin/entry-queue orders the same facts, names the one
// blocking step, and the funnel at the top counts how far the club as a whole gets.
// The step evidence is all server-resolved — approval and the maintenance window
// (both doors), `auth.users` for "did they ever start", `last_seen_at` for "did they
// arrive", credentials for the watch, the scored setup tasks for the profile.
//
// The button still does both doors at once: POST /api/admin/approve approves AND
// takes them off the maintenance block (see lib/maintenance-release.ts).
// ═════════════════════════════════════════════════════════════════════════════

interface QueueResponse {
  maintenance: boolean;
  canApprove: boolean;
  members: EntryQueueMember[];
  /** /register applicants with no athlete row yet — see PendingSignupRequest. */
  orphanRequests?: PendingSignupRequest[];
  groups?: Array<{ id: string; name: string }>;
}

/** The list's filter: one group, or everybody. */
type Filter = FlowGroup | 'all';

/** Deep links from Coach Tools predate the flow; keep them landing sensibly. */
const LEGACY_BUCKET: Record<string, Filter> = {
  waiting: 'mine',
  stuck: 'login',
  ready: 'ready',
  all: 'all',
};

/**
 * The funnel's colours: ONE hue for the journey, green only at the finish.
 *
 * Six different colours for six steps of a single journey is what the first cut
 * did, and it read as six unrelated categories — the eye hunts for what "orange"
 * means instead of comparing lengths, which is the only comparison on the card.
 * The bars are one blue, the last is green because finishing is different in kind,
 * and the alarm lives in the red drop-off number where it can be read as a number.
 */
const STEP_FILL: Record<FlowStep, string> = {
  signedUp: 'bg-brand-600',
  approved: 'bg-brand-600',
  loginStarted: 'bg-brand-600',
  loggedIn: 'bg-brand-600',
  watch: 'bg-brand-600',
  profile: 'bg-accent-600',
};

const STEP_ICON: Record<FlowStep, React.ComponentType<{ className?: string }>> = {
  signedUp: UserPlus,
  approved: Unlock,
  loginStarted: Smartphone,
  loggedIn: CheckCircle2,
  watch: Watch,
  profile: UserCheck,
};

export default function EntryQueuePage() {
  const t = useTranslations('entryQueue');
  const { data, isLoading, mutate } = useApi<QueueResponse>('/api/admin/entry-queue');
  // The allowlist comes back only to an approver, and it is what "shut them back
  // out" needs to write. Its absence — not `maintenance` — is what hides that
  // action, exactly as on the roster.
  const { data: maintenanceData, mutate: mutateMaintenance } =
    useApi<{ maintenance: boolean; allowlist?: string[] }>('/api/maintenance');
  const allowlist = maintenanceData?.allowlist;
  const canEditAllowlist = Array.isArray(allowlist);

  const searchParams = useSearchParams();
  // null = "haven't chosen", which resolves to 'mine' when somebody is waiting on
  // the coach and to 'all' when nobody is. Landing on an empty list because the
  // default filter happened to be empty is a dead end, and it was the first thing
  // this screen did every time the queue was clear.
  const [chosenFilter, setFilter] = useState<Filter | null>(() => {
    const at = searchParams.get('at');
    if (at && ([...FLOW_GROUPS, 'all'] as string[]).includes(at)) return at as Filter;
    return LEGACY_BUCKET[searchParams.get('bucket') || ''] || null;
  });
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; unreachable: number; failed: number } | null>(null);
  // A /register applicant has no דבוקה until somebody picks one, and approving
  // without one is a 400 from the API — so the choice lives on their card.
  const [orphanGroup, setOrphanGroup] = useState<Record<string, string>>({});
  const [orphanResult, setOrphanResult] = useState<Record<string, 'approved' | 'rejected' | 'failed' | null>>({});
  // Per-person outcome of a reminder: sent, sent-but-nowhere-to-land, or failed.
  const [nudged, setNudged] = useState<Record<string, 'sent' | 'unreachable' | 'failed' | null>>({});
  // What the last "let in" did: both doors, or only the approval because the club
  // was already open. Two different facts, and the admin has to be able to tell.
  const [letInResult, setLetInResult] = useState<Record<string, 'released' | 'approved' | 'failed' | null>>({});

  const members = useMemo(() => data?.members || [], [data]);
  const maintenanceOn = !!data?.maintenance;
  const canApprove = !!data?.canApprove;

  const orphans = useMemo(() => data?.orphanRequests || [], [data]);
  const groups = useMemo(() => data?.groups || [], [data]);

  /** Every member's flow, computed once — the card, the counts and the sort. */
  const flows = useMemo(
    () => new Map(members.map((m) => [m.id, memberFlow(m)] as const)),
    [members],
  );
  const groupOf = useMemo(
    () => new Map(members.map((m) => [m.id, flowGroup(m)] as const)),
    [members],
  );

  // An orphan request is a person waiting on a decision, so it counts as one — in
  // the funnel, in the groups and in the headline. Anything less and the screen
  // says "nobody is waiting" while somebody is.
  const counts = useMemo(() => {
    const out = { mine: 0, login: 0, watch: 0, profile: 0, ready: 0, all: 0 } as Record<Filter, number>;
    for (const m of members) out[groupOf.get(m.id)!] += 1;
    out.mine += orphans.length;
    out.all = members.length + orphans.length;
    return out;
  }, [members, orphans, groupOf]);

  /** The funnel: "signed up 25 → approved 23 → …". Orphans stop at step one. */
  const funnel = useMemo(() => {
    const f = flowFunnel(members);
    return { ...f, signedUp: f.signedUp + orphans.length };
  }, [members, orphans]);

  const filter: Filter = chosenFilter ?? (counts.mine > 0 ? 'mine' : 'all');

  const needle = query.trim().toLowerCase();
  const visible = members.filter((m) => {
    if (needle && !`${m.name} ${m.email || ''}`.toLowerCase().includes(needle)) return false;
    return filter === 'all' || groupOf.get(m.id) === filter;
  });

  const visibleOrphans = orphans.filter(
    (r) => (filter === 'mine' || filter === 'all') && (!needle || r.email.toLowerCase().includes(needle)),
  );

  /** The bulk target: everybody in view the app can still be nudged about. */
  const nudgeable = visible.filter((m) => {
    const g = groupOf.get(m.id);
    return g === 'login' || g === 'watch' || g === 'profile';
  });

  /**
   * Approve + release, in one request. Both doors, one tap.
   *
   * The response says which doors it actually opened, and that gets shown: a
   * release you can't see is a release nobody believes happened.
   */
  const letIn = async (member: EntryQueueMember) => {
    setBusyId(member.id);
    setLetInResult((prev) => ({ ...prev, [member.id]: null }));
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: member.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setLetInResult((prev) => ({ ...prev, [member.id]: body.released ? 'released' : 'approved' }));
        mutate();
        mutateMaintenance();
      } else {
        setLetInResult((prev) => ({ ...prev, [member.id]: 'failed' }));
      }
    } catch {
      setLetInResult((prev) => ({ ...prev, [member.id]: 'failed' }));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * The nudge for somebody nothing is holding out who hasn't finished. Push only —
   * half the club has no real address — so the result says whether their phone
   * could actually be reached rather than just ticking.
   */
  const nudge = async (member: EntryQueueMember) => {
    setBusyId(member.id);
    setNudged((prev) => ({ ...prev, [member.id]: null }));
    try {
      const res = await fetch('/api/admin/entry-queue/nudge', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: member.id }),
      });
      const body = await res.json().catch(() => ({}));
      setNudged((prev) => ({ ...prev, [member.id]: res.ok ? (body.reachable ? 'sent' : 'unreachable') : 'failed' }));
    } catch {
      setNudged((prev) => ({ ...prev, [member.id]: 'failed' }));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * The same reminder, to everybody currently in view who hasn't finished.
   *
   * The point of the club-members card: most of the "requests" in production are
   * existing members who just never finished connecting, and chasing them one card
   * at a time is why nobody did. The result is reported in three numbers because
   * push has three outcomes and "sent to 23" would be a lie about most of them.
   */
  const remindEveryone = async () => {
    if (!nudgeable.length) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/admin/entry-queue/nudge', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteIds: nudgeable.map((m) => m.id) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setBulkResult({ sent: body.sent || 0, unreachable: body.unreachable || 0, failed: body.failed || 0 });
        setNudged((prev) => ({ ...prev, ...(body.results || {}) }));
      } else {
        setBulkResult({ sent: 0, unreachable: 0, failed: nudgeable.length });
      }
    } catch {
      setBulkResult({ sent: 0, unreachable: 0, failed: nudgeable.length });
    } finally {
      setBulkBusy(false);
    }
  };

  /**
   * Approve or turn down a /register applicant.
   *
   * The public form is open to anybody with the link, so refusing one has to be
   * possible from the same card — otherwise a spam signup sits in the queue forever
   * and the count at the top stops meaning anything.
   */
  const decideOrphan = async (req: PendingSignupRequest, action: 'approve' | 'reject') => {
    const groupId = orphanGroup[req.id] || req.groupId;
    if (action === 'approve' && !groupId) return;
    setBusyId(req.id);
    setOrphanResult((prev) => ({ ...prev, [req.id]: null }));
    try {
      const res = await fetch('/api/admin/registrations/approve', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify(action === 'approve' ? { id: req.id, action, groupId } : { id: req.id, action }),
      });
      setOrphanResult((prev) => ({ ...prev, [req.id]: res.ok ? (action === 'approve' ? 'approved' : 'rejected') : 'failed' }));
      if (res.ok) mutate();
    } catch {
      setOrphanResult((prev) => ({ ...prev, [req.id]: 'failed' }));
    } finally {
      setBusyId(null);
    }
  };

  /** Shut somebody back out of an open window — the undo for a mistaken release. */
  const blockAgain = async (member: EntryQueueMember) => {
    if (!canEditAllowlist) return;
    setBusyId(member.id);
    try {
      const handles = [member.id, member.email]
        .map((h) => String(h || '').toLowerCase().trim())
        .filter(Boolean);
      const res = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ allowlist: allowlist!.filter((entry) => !handles.includes(entry)) }),
      });
      if (res.ok) {
        mutate();
        mutateMaintenance();
      }
    } finally {
      setBusyId(null);
    }
  };

  const turnMaintenanceOff = async () => {
    setTurningOff(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ on: false }),
      });
      if (res.ok) {
        mutate();
        mutateMaintenance();
      }
    } finally {
      setTurningOff(false);
    }
  };

  const dateOnly = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) : null;

  /** Whole days since a date — how long the club has been failing this person. */
  const daysSince = (iso: string | null | undefined) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
  };

  /**
   * The one sentence that says what is wrong, per blocking step.
   *
   * The 'loggedIn' case is the one this screen exists for: a member with an auth
   * account and no last_seen_at logged in and never landed inside the app, which is
   * a specific, fixable iOS problem — not somebody ignoring the club.
   */
  const stuckLine = (m: EntryQueueMember, stuck: FlowStep) => {
    switch (stuck) {
      case 'approved':
        return m.approved ? t('whyBlocked') : t('whyPending');
      case 'loginStarted':
        return t('whyNoLogin');
      case 'loggedIn':
        return t('whyLoginStuck');
      case 'watch':
        return t('whyNoWatch');
      case 'profile':
        return t('whyProfile', {
          items: (m.setupMissing || []).map((k) => t(`missing_${k}` as never)).join(' · '),
        });
      default:
        return t('whySignedUp');
    }
  };

  /** The date the current wait started, so "how long" is honest per step. */
  const waitingSince = (m: EntryQueueMember, stuck: FlowStep) => {
    if (stuck === 'approved') return m.createdAt;
    if (stuck === 'loginStarted') return m.approvedAt || m.createdAt;
    if (stuck === 'loggedIn') return m.lastSignInAt || m.authAccountAt;
    return m.lastSeenAt || m.approvedAt || m.createdAt;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-card" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-card" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* The window itself, and its off switch — this is the screen where you can
          see exactly who it costs, so it is the screen that should be able to end
          it. Shown to approvers only, who are the only callers allowed to write. */}
      {maintenanceOn && (
        <Card variant="solid" className="border border-accent-red/40 bg-accent-red/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-9 h-9 rounded-full bg-accent-red/15 flex items-center justify-center">
                <Wrench className="h-4 w-4 text-accent-red" />
              </span>
              <div>
                <p className="font-semibold text-accent-red">{t('maintenanceOn')}</p>
                <p className="text-sm text-ink-400 mt-0.5">
                  {t('maintenanceBlockedCount', { count: members.filter((m) => m.blocked).length })}
                </p>
              </div>
            </div>
            {canApprove && (
              <Button variant="primary" onClick={turnMaintenanceOff} disabled={turningOff}>
                <Wrench className="h-4 w-4" />
                {turningOff ? t('saving') : t('maintenanceTurnOff')}
              </Button>
            )}
          </div>
        </Card>
      )}

      <div>
        <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
        <p className="text-ink-400 mt-1 text-sm" dir="rtl">
          {t('subtitle', { waiting: counts.mine, total: counts.all })}
        </p>
      </div>

      {/* THE FUNNEL. Six steps, one row each, longest bar first — so where the club
          loses people is the shape of the card, and every row is the way into the
          people who are stuck at it. Rows rather than a stacked bar because six
          labels do not fit across a phone, and unlabelled segments are decoration. */}
      {counts.all > 0 && (
        <Card variant="solid">
          <p className="text-xs font-semibold text-ink-500" dir="rtl">{t('flowTitle', { total: counts.all })}</p>
          <div className="mt-3 space-y-1.5" dir="rtl">
            {FLOW_STEPS.map((step) => {
              const Icon = STEP_ICON[step];
              const n = funnel[step];
              const lost = step === 'signedUp' ? 0 : funnel[FLOW_STEPS[FLOW_STEPS.indexOf(step) - 1]] - n;
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => setFilter(GROUP_OF_STEP[step])}
                  className="w-full flex items-center gap-2 text-start group"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className="w-[86px] shrink-0 text-2xs font-semibold text-ink-500 truncate">
                    {t(`step_${step}` as never)}
                  </span>
                  <span className="flex-1 h-2.5 rounded-full bg-page overflow-hidden">
                    <span
                      className={cn('block h-full rounded-full', STEP_FILL[step])}
                      style={{ width: `${counts.all ? (n / counts.all) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-2xs font-bold tabular-nums text-ink-700 text-end">{n}</span>
                  {/* The drop-off, which is the number that actually matters: 25
                      signed up and 9 got in means 14 people the club lost here. */}
                  <span className="w-11 shrink-0 text-2xs tabular-nums text-accent-red text-end">
                    {lost > 0 ? `−${lost}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* The groups, by what the next action is: yours, a reminder, or nothing. */}
      <div className="flex flex-wrap items-center gap-2" dir="rtl">
        {([...FLOW_GROUPS, 'all'] as Filter[]).map((g) => {
          const on = filter === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setFilter(g)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 min-h-[36px] text-xs font-semibold transition-colors',
                on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-card border-page text-ink-500',
              )}
            >
              {t(`group_${g}` as never)}
              <span className={cn('tabular-nums', on ? 'text-white/70' : 'text-ink-300')}>{counts[g]}</span>
            </button>
          );
        })}
      </div>

      <label className="relative block">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full bg-card border border-page rounded-full ps-9 pe-4 py-2.5 min-h-[44px] text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </label>

      {/* One action for the whole group in view. This is the card the club needed:
          the people here are mostly existing members who never finished, and they
          were never going to be worked through 23 cards at a time. */}
      {canApprove && nudgeable.length > 1 && (
        <Card variant="solid">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0" dir="rtl">
              <span className="shrink-0 w-9 h-9 rounded-full bg-brand-600/15 flex items-center justify-center">
                <UsersIcon className="h-4 w-4 text-brand-600" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink-700">{t('bulkTitle', { count: nudgeable.length })}</p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {t('bulkSubtitle', { reachable: nudgeable.filter((m) => m.hasPush).length })}
                </p>
              </div>
            </div>
            <Button variant="primary" onClick={remindEveryone} disabled={bulkBusy}>
              <Bell className="h-4 w-4" />
              {bulkBusy ? t('saving') : t('bulkRemind', { count: nudgeable.length })}
            </Button>
          </div>
          {bulkResult && (
            <p className="mt-2.5 text-xs font-semibold text-ink-500" dir="rtl">
              {t('bulkResult', bulkResult)}
            </p>
          )}
        </Card>
      )}

      {/* The /register applicants, ahead of the members: somebody outside the club
          is waiting on an answer, which outranks a member who hasn't finished. */}
      {visibleOrphans.length > 0 && (
        <div className="space-y-3">
          {visibleOrphans.map((r) => {
            const chosen = orphanGroup[r.id] || r.groupId || '';
            return (
              <Card key={r.id} variant="solid">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                    <UserPlus className="h-4 w-4 text-brand-600" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink-700 truncate" dir="ltr">{r.email}</p>
                    <p className="text-xs text-ink-400 mt-0.5" dir="rtl">
                      {t('orphanLine', { date: dateOnly(r.createdAt) || '—' })}
                    </p>
                  </div>
                </div>

                {/* The same track as a member's, so an applicant reads on the same
                    scale: they are at step one of six and everything is ahead. */}
                <FlowTrack
                  reached={1}
                  stuckIndex={1}
                  unknownAfter={1}
                  label={(step) => t(`stepShort_${step}` as never)}
                />
                <p className="mt-2 text-xs font-semibold text-accent-red flex items-center gap-1.5" dir="rtl">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t('whyPending')}
                  <Chip tone="muted" icon={Mail} label={t('orphanNoAccount')} />
                </p>

                {/* The דבוקה picker, because approval without one is refused by the
                    API — and a disabled approve button with no way to fix it was the
                    whole complaint about the screen this replaces. */}
                <p className="mt-3 text-xs font-semibold text-ink-700" dir="rtl">{t('orphanPickGroup')}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setOrphanGroup((prev) => ({ ...prev, [r.id]: g.id }))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-semibold',
                        chosen === g.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-card border-page text-ink-500',
                      )}
                    >
                      {groupDisplayName(g.name)}
                    </button>
                  ))}
                </div>
                {canApprove && (
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={() => decideOrphan(r, 'approve')}
                      disabled={busyId === r.id || !chosen}
                      title={chosen ? undefined : t('orphanPickGroup')}
                    >
                      <UserCheck className="h-4 w-4" />
                      {busyId === r.id ? t('saving') : t('orphanApprove')}
                    </Button>
                    <Button variant="ghost" onClick={() => decideOrphan(r, 'reject')} disabled={busyId === r.id}>
                      {t('orphanReject')}
                    </Button>
                  </div>
                )}
                {orphanResult[r.id] && (
                  <p
                    className={cn(
                      'mt-2.5 text-xs font-semibold',
                      orphanResult[r.id] === 'approved' ? 'text-accent-900'
                        : orphanResult[r.id] === 'rejected' ? 'text-ink-400' : 'text-accent-red',
                    )}
                    dir="rtl"
                  >
                    {orphanResult[r.id] === 'approved'
                      ? t('orphanApproved')
                      : orphanResult[r.id] === 'rejected'
                        ? t('orphanRejected')
                        : t('resultFailed')}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        visibleOrphans.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            title={query.trim() ? t('noMatches') : t(`empty_${filter}` as never)}
            description={query.trim() ? undefined : t('emptyDescription')}
          />
        )
      ) : (
        <div className="space-y-3">
          {visible.map((m) => {
            const flow = flows.get(m.id)!;
            const stuck = flow.stuckAt;
            const initials = m.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
            const groupStyle = getGroupChip(m.groupName);
            const busy = busyId === m.id;
            const mine = groupOf.get(m.id) === 'mine';
            const days = stuck ? daysSince(waitingSince(m, stuck)) : null;
            return (
              <Card key={m.id} variant="solid">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="shrink-0 w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                      <span className="text-brand-600 font-semibold text-xs">{initials}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-700 truncate" dir="auto">{m.name}</p>
                      {m.email && <p className="text-xs text-ink-300 truncate">{m.email}</p>}
                    </div>
                  </div>
                  {/* דבוקה — the first thing asked about anybody in this queue, and
                      the coach's call rather than the member's, so its absence is
                      information too. */}
                  <span
                    className={cn(
                      'shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold',
                      m.groupName ? cn(groupStyle?.bg, groupStyle?.text) : 'bg-page text-ink-400',
                    )}
                  >
                    {m.groupName || t('noGroup')}
                  </span>
                </div>

                {/* The track: where they got to, and the step that stopped them. */}
                <FlowTrack
                  reached={flow.reached}
                  stuckIndex={stuck ? FLOW_STEPS.indexOf(stuck) : -1}
                  passedLater={flow.steps.map((s) => s.done)}
                  unknown={flow.steps.map((s) => s.unknown)}
                  label={(step) => t(`stepShort_${step}` as never)}
                />

                {/* The one sentence: what is wrong, and for how long. */}
                {stuck ? (
                  <div className="mt-3" dir="rtl">
                    <p className={cn(
                      'text-[13px] font-semibold flex items-start gap-1.5',
                      mine ? 'text-accent-red' : 'text-band-3-ink',
                    )}>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{stuckLine(m, stuck)}</span>
                    </p>
                    {days !== null && (
                      <p className="text-2xs text-ink-400 mt-1 ps-5">
                        {t('waitingDays', { days, date: dateOnly(waitingSince(m, stuck)) || '—' })}
                      </p>
                    )}
                    {/* The fix for the iOS sheet, spelled out — the coach has to be
                        able to tell them what to do, not just that it's broken. */}
                    {stuck === 'loggedIn' && (
                      <p className="text-2xs text-ink-500 mt-1.5 ps-5 leading-relaxed">{t('hintLoginStuck')}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] font-semibold text-accent-900 flex items-center gap-1.5" dir="rtl">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {t('whyReady', { date: dateOnly(m.lastSeenAt) || '—' })}
                  </p>
                )}

                {/* The connections, each named and each answered — Garmin and Strava
                    separately, because "אין שעון" hid which one they tried. */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Chip tone={m.hasGarmin ? 'ok' : 'muted'} icon={Watch} label={t(m.hasGarmin ? 'garminOn' : 'garminOff')} />
                  <Chip tone={m.hasStrava ? 'ok' : 'muted'} icon={Activity} label={t(m.hasStrava ? 'stravaOn' : 'stravaOff')} />
                  <Chip tone={m.hasPush ? 'ok' : 'muted'} icon={m.hasPush ? Bell : BellOff} label={t(m.hasPush ? 'pushOn' : 'pushOff')} />
                  <Chip tone={m.setupDone >= m.setupTotal ? 'ok' : 'muted'} icon={UserCheck} label={t('setupProgress', { done: m.setupDone, total: m.setupTotal })} />
                </div>

                {/* One action per card. For anybody the club is holding out, it is
                    the same button whichever door is shut: approve and release. */}
                <div className="flex items-center gap-2 mt-4">
                  {mine && canApprove ? (
                    <Button variant="primary" className="flex-1" onClick={() => letIn(m)} disabled={busy}>
                      <Unlock className="h-4 w-4" />
                      {busy ? t('saving') : m.approved ? t('releaseEntry') : t('approveEntry')}
                    </Button>
                  ) : stuck && canApprove ? (
                    // Nothing is holding them out — they just haven't finished. This
                    // is the only way the app has to reach them at all.
                    <Button variant="secondary" className="flex-1" onClick={() => nudge(m)} disabled={busy}>
                      <Bell className="h-4 w-4" />
                      {busy
                        ? t('saving')
                        : nudged[m.id] === 'sent'
                          ? t('reminderSent')
                          : nudged[m.id] === 'unreachable'
                            ? t('reminderUnreachable')
                            : nudged[m.id] === 'failed'
                              ? t('reminderFailed')
                              : t('sendReminder')}
                    </Button>
                  ) : (
                    <Link href={`/dashboard/teammate/${m.id}`} className="flex-1">
                      <Button variant="secondary" className="w-full">
                        <ChevronLeft className="h-4 w-4" />
                        {t('openProfile')}
                      </Button>
                    </Link>
                  )}
                  {stuck && !mine && canApprove && (
                    <Link href={`/dashboard/teammate/${m.id}`}>
                      <Button variant="ghost" title={t('openProfile')}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                  {/* The undo, and only where it means something: an open window and
                      somebody who is currently exempt. */}
                  {maintenanceOn && !m.blocked && canEditAllowlist && (
                    <Button variant="ghost" onClick={() => blockAgain(m)} disabled={busy} title={t('blockAgain')}>
                      <Lock className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* What the tap did. 'released' is the half that makes an approval
                    felt during a window; while the club is open there is nothing
                    to release and claiming otherwise would be a lie. */}
                {letInResult[m.id] && (
                  <p
                    className={cn(
                      'mt-2.5 text-xs font-semibold flex items-center gap-1.5',
                      letInResult[m.id] === 'released' ? 'text-accent-900'
                        : letInResult[m.id] === 'failed' ? 'text-accent-red' : 'text-ink-400',
                    )}
                  >
                    {letInResult[m.id] === 'failed'
                      ? <Lock className="h-3 w-3" />
                      : letInResult[m.id] === 'released' ? <Unlock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {letInResult[m.id] === 'released'
                      ? t('resultReleased')
                      : letInResult[m.id] === 'approved'
                        ? t('resultApproved')
                        : t('resultFailed')}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One person's six steps, right to left.
 *
 * Three states, and each differs in SHAPE as well as colour, because a track read
 * on colour alone is a track half the readers can't read: passed is a filled dot on
 * a filled rail, the blocking step is a ringed dot with the label in red, and a step
 * not reached yet is a hollow dot on a grey rail. `unknown` is the fourth and rarest
 * — a question mark, only when the auth listing couldn't be read.
 *
 * `passedLater` is what keeps the track honest about a non-monotone flow: the club
 * backfill connected Garmin for members who have never logged in, so a later step
 * can be done while an earlier one isn't. Those show as passed but the rail before
 * them stays grey, which is exactly the truth — done, but out of order.
 */
function FlowTrack({
  reached,
  stuckIndex,
  passedLater,
  unknown,
  unknownAfter,
  label,
}: {
  reached: number;
  stuckIndex: number;
  passedLater?: boolean[];
  unknown?: boolean[];
  /** Everything from this index on is unknowable (an applicant with no account). */
  unknownAfter?: number;
  label: (step: FlowStep) => string;
}) {
  return (
    <div className="mt-3.5 flex items-start" dir="rtl">
      {FLOW_STEPS.map((step, i) => {
        const passed = i < reached || !!passedLater?.[i];
        const isStuck = i === stuckIndex;
        const isUnknown = !!unknown?.[i] || (unknownAfter !== undefined && i >= unknownAfter && !passed);
        return (
          <div key={step} className="flex-1 flex flex-col items-center min-w-0">
            <div className="flex items-center w-full">
              {/* Rails, drawn as the halves either side of the dot so the ends of
                  the track don't hang off it. */}
              <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : passed ? 'bg-accent-600' : 'bg-page')} />
              <span
                className={cn(
                  'shrink-0 rounded-full flex items-center justify-center transition-colors',
                  isStuck
                    ? 'h-4 w-4 border-2 border-accent-red bg-card'
                    : passed
                      ? 'h-3 w-3 bg-accent-600'
                      : isUnknown
                        ? 'h-3.5 w-3.5 border border-dashed border-ink-300 bg-card'
                        : 'h-3 w-3 border border-page bg-card',
                )}
              >
                {isStuck && <span className="h-1.5 w-1.5 rounded-full bg-accent-red" />}
                {!isStuck && isUnknown && <HelpCircle className="h-2.5 w-2.5 text-ink-300" />}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  i === FLOW_STEPS.length - 1 ? 'bg-transparent' : passed && (i + 1 < reached || !!passedLater?.[i + 1]) ? 'bg-accent-600' : 'bg-page',
                )}
              />
            </div>
            <span
              className={cn(
                'mt-1.5 text-[9px] leading-tight text-center w-full px-0.5',
                isStuck ? 'font-bold text-accent-red' : passed ? 'font-semibold text-ink-500' : 'text-ink-300',
              )}
            >
              {label(step)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** One state chip. Four tones, because a chip that is all one colour says nothing. */
function Chip({
  tone,
  icon: Icon,
  label,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const tones: Record<string, string> = {
    ok: 'bg-accent-600/15 text-accent-900 border-accent-600/30',
    warn: 'bg-band-3/20 text-band-3-ink border-band-3/30',
    bad: 'bg-accent-red/15 text-accent-red border-accent-red/30',
    muted: 'bg-page text-ink-400 border-page',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-2xs font-semibold border', tones[tone])}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
