'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Wrench, Search, Lock, Unlock, Clock, BellOff, Bell, Watch,
  CheckCircle2, DoorOpen, UserCheck, ChevronLeft, Users as UsersIcon,
  UserPlus, Mail,
} from 'lucide-react';
import { cn, getGroupChip, groupDisplayName } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Button, Card, EmptyState, SegmentedControl, Skeleton } from '@/components/ui';
import {
  ENTRY_FILTERS,
  isWaitingOnUs,
  matchesFilters,
  stageCounts,
  STAGE_ORDER,
  type EntryFilter,
  type EntryQueueMember,
  type EntryStage,
  type PendingSignupRequest,
} from '@/lib/admin/entry-queue';

// ═════════════════════════════════════════════════════════════════════════════
// "מחכים להיכנס" — the entry queue.
//
// One card per person who isn't all the way in, with everything that decides it
// (דבוקה, approval, last entry, watch, notifications) and ONE action. The state
// was spread over three screens before this: approval in Settings → users, the
// maintenance allowlist in Settings → maintenance, and the roster on
// /dashboard/athletes — so "what is Dana's situation" was three lookups and
// approving her during a window silently did nothing she could feel.
//
// The button here does both doors at once: POST /api/admin/approve approves AND
// takes them off the maintenance block (see lib/maintenance-release.ts). What the
// card claims about someone being blocked is the same predicate the API gate
// enforces, resolved server-side — never a guess made in the browser.
// ═════════════════════════════════════════════════════════════════════════════

type Bucket = 'waiting' | 'stuck' | 'ready' | 'all';

interface QueueResponse {
  maintenance: boolean;
  canApprove: boolean;
  members: EntryQueueMember[];
  /** /register applicants with no athlete row yet — see PendingSignupRequest. */
  orphanRequests?: PendingSignupRequest[];
  groups?: Array<{ id: string; name: string }>;
}

/** Which bucket holds a stage — so a tap on the bar's legend lands on those people. */
const BUCKET_OF_STAGE: Record<EntryStage, Bucket> = {
  pending: 'waiting',
  blocked: 'waiting',
  never: 'stuck',
  setup: 'stuck',
  ready: 'ready',
};

/** The bar's colours, one per stage. Ordered worst-first, like STAGE_ORDER. */
const STAGE_FILL: Record<EntryStage, string> = {
  pending: 'bg-accent-red',
  blocked: 'bg-band-3',
  never: 'bg-band-2',
  setup: 'bg-brand-600',
  ready: 'bg-accent-600',
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

  // Coach Tools links straight to a bucket ("3 waiting" → the three of them), so
  // the count you tapped and the list you land on are the same set.
  const searchParams = useSearchParams();
  const [bucket, setBucket] = useState<Bucket>(() => {
    const asked = searchParams.get('bucket');
    return (['waiting', 'stuck', 'ready', 'all'] as string[]).includes(asked || '')
      ? (asked as Bucket)
      : 'waiting';
  });
  const [query, setQuery] = useState('');
  // Stack on top of the bucket rather than replacing it: "who in this bucket also
  // has no notifications" is the question, and it has to survive switching bucket.
  const [filters, setFilters] = useState<EntryFilter[]>([]);
  const toggleFilter = (f: EntryFilter) =>
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
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

  // Memoised so the counts below don't recompute on every render over a fresh []
  const members = useMemo(() => data?.members || [], [data]);
  const maintenanceOn = !!data?.maintenance;
  const canApprove = !!data?.canApprove;

  const orphans = useMemo(() => data?.orphanRequests || [], [data]);
  const groups = useMemo(() => data?.groups || [], [data]);

  // An orphan request is a person waiting on a decision, so it counts as one — in
  // the bar, in the buckets and in the headline. Anything less and the screen says
  // "nobody is waiting" while somebody is.
  const counts = useMemo(() => ({
    all: members.length + orphans.length,
    waiting: members.filter((m) => isWaitingOnUs(m.stage)).length + orphans.length,
    stuck: members.filter((m) => m.stage === 'never' || m.stage === 'setup').length,
    ready: members.filter((m) => m.stage === 'ready').length,
  }), [members, orphans]);

  const dist = useMemo(() => {
    const byStage = stageCounts(members);
    return { ...byStage, pending: byStage.pending + orphans.length };
  }, [members, orphans]);

  /** How many people each filter would leave, so nobody taps into an empty list. */
  const filterCounts = useMemo(() => {
    const out = {} as Record<EntryFilter, number>;
    for (const f of ENTRY_FILTERS) out[f] = members.filter((m) => matchesFilters(m, [f])).length;
    return out;
  }, [members]);

  const inBucket = (m: EntryQueueMember) => {
    if (bucket === 'all') return true;
    if (bucket === 'waiting') return isWaitingOnUs(m.stage);
    if (bucket === 'stuck') return m.stage === 'never' || m.stage === 'setup';
    return m.stage === 'ready';
  };

  const needle = query.trim().toLowerCase();
  const visible = members.filter((m) => {
    if (needle && !`${m.name} ${m.email || ''}`.toLowerCase().includes(needle)) return false;
    if (!matchesFilters(m, filters)) return false;
    return inBucket(m);
  });

  // Every filter here is trivially true of somebody who has no account yet, so an
  // orphan is only ever hidden by the bucket or the search box.
  const visibleOrphans = orphans.filter(
    (r) => (bucket === 'waiting' || bucket === 'all') && (!needle || r.email.toLowerCase().includes(needle)),
  );

  /** The bulk target: everybody in view the app can still be nudged about. */
  const nudgeable = visible.filter((m) => m.stage === 'never' || m.stage === 'setup');

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
   * The nudge for somebody nothing is holding out who never came in. Push only —
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
   * The point of the club-members card: 23 of the 24 "requests" in production are
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

  const stageLabel: Record<EntryStage, string> = {
    pending: t('stagePending'),
    blocked: t('stageBlocked'),
    never: t('stageNever'),
    setup: t('stageSetup'),
    ready: t('stageReady'),
  };

  const dateOnly = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) : null;

  /** The one line under the name: why this person is in this bucket. */
  const summaryLine = (m: EntryQueueMember) => {
    const signed = dateOnly(m.createdAt);
    switch (m.stage) {
      case 'pending':
        return signed ? t('lineSignedUp', { date: signed }) : t('stagePending');
      case 'blocked':
        return m.approvedAt ? t('lineApprovedBlocked', { date: dateOnly(m.approvedAt)! }) : t('stageBlocked');
      case 'never':
        return m.approvedAt ? t('lineApprovedNever', { date: dateOnly(m.approvedAt)! }) : t('stageNever');
      default:
        return t('lineLastSeen', {
          date: dateOnly(m.lastSeenAt) || '—',
          done: m.setupDone,
          total: m.setupTotal,
        });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-card" />)}
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
          {t('subtitle', { waiting: counts.waiting, total: counts.all })}
        </p>
      </div>

      {/* Where the club actually stands, in one bar. Five stages left to right in
          the order somebody moves through them, so the shape of the bar IS the
          answer to "are we in trouble" — and each legend entry is the way into the
          bucket it counts. */}
      {counts.all > 0 && (
        <Card variant="solid">
          <p className="text-xs font-semibold text-ink-500" dir="rtl">{t('distTitle', { total: counts.all })}</p>
          <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-page">
            {STAGE_ORDER.map((stage) =>
              // Zero segments are dropped rather than drawn: a 0-wide sliver is
              // invisible anyway, and a 1px one reads as a real group.
              dist[stage] > 0 ? (
                <span
                  key={stage}
                  className={cn('h-full', STAGE_FILL[stage])}
                  style={{ width: `${(dist[stage] / counts.all) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" dir="rtl">
            {STAGE_ORDER.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setBucket(BUCKET_OF_STAGE[stage])}
                className={cn(
                  'flex items-center gap-1.5 text-2xs font-semibold',
                  dist[stage] > 0 ? 'text-ink-700' : 'text-ink-300',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', dist[stage] > 0 ? STAGE_FILL[stage] : 'bg-page')} />
                {stageLabel[stage]}
                <span className="tabular-nums">{dist[stage]}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={bucket}
          onChange={setBucket}
          options={(['waiting', 'stuck', 'ready', 'all'] as const).map((b) => ({
            value: b,
            label: `${t(b)} (${counts[b]})`,
          }))}
          className="w-fit"
        />
        <label className="relative flex-1 min-w-[200px]">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full bg-card border border-page rounded-full ps-9 pe-4 py-2.5 min-h-[44px] text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </label>
      </div>

      {/* What's missing, as filters that stack — the follow-up questions after
          "did they get in": no notifications, no watch, never opened it, no דבוקה. */}
      <div className="flex flex-wrap items-center gap-2" dir="rtl">
        {ENTRY_FILTERS.map((f) => {
          const on = filters.includes(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => toggleFilter(f)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                on
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-card border-page text-ink-500',
              )}
            >
              {t(`filter_${f}`)}
              <span className={cn('tabular-nums', on ? 'text-white/70' : 'text-ink-300')}>{filterCounts[f]}</span>
            </button>
          );
        })}
        {filters.length > 0 && (
          <button type="button" onClick={() => setFilters([])} className="text-xs font-semibold text-brand-600 px-1">
            {t('clearFilters')}
          </button>
        )}
      </div>

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
          {/* Progress bar of the same set: how many of them are all the way in. */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-page">
            <span
              className="block h-full bg-accent-600"
              style={{ width: `${counts.all ? (counts.ready / counts.all) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-2xs text-ink-400" dir="rtl">
            {t('bulkProgress', { ready: counts.ready, total: counts.all })}
          </p>
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
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Chip tone="bad" icon={Clock} label={t('stagePending')} />
                  <Chip tone="muted" icon={Mail} label={t('orphanNoAccount')} />
                </div>
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
            title={query.trim() || filters.length ? t('noMatches') : t('emptyTitle')}
            description={query.trim() || filters.length ? undefined : t('emptyDescription')}
          />
        )
      ) : (
        <div className="space-y-3">
          {visible.map((m) => {
            const initials = m.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
            const groupStyle = getGroupChip(m.groupName);
            const busy = busyId === m.id;
            const waiting = isWaitingOnUs(m.stage);
            return (
              <Card key={m.id} variant="solid">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="shrink-0 w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                      <span className="text-brand-600 font-semibold text-xs">{initials}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-700 truncate" dir="auto">{m.name}</p>
                      <p className="text-xs text-ink-400 mt-0.5">{summaryLine(m)}</p>
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

                {/* Every gate and connection, as chips: what is true about this
                    person in one line rather than three screens. */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Chip
                    tone={m.stage === 'ready' ? 'ok' : waiting ? 'bad' : 'warn'}
                    icon={m.stage === 'pending' ? Clock : m.stage === 'blocked' ? Lock : m.stage === 'ready' ? CheckCircle2 : Unlock}
                    label={stageLabel[m.stage]}
                  />
                  <Chip
                    tone={m.lastSeenAt ? 'ok' : 'warn'}
                    icon={DoorOpen}
                    label={m.lastSeenAt ? t('entered', { date: dateOnly(m.lastSeenAt)! }) : t('neverEntered')}
                  />
                  {/* Credentials, not `data_source`: all 28 members have a declared
                      source and only 17 have anything behind it. */}
                  <Chip
                    tone={m.hasGarmin || m.hasStrava ? 'ok' : 'muted'}
                    icon={Watch}
                    label={m.hasGarmin ? 'Garmin' : m.hasStrava ? 'Strava' : t('noWatch')}
                  />
                  <Chip
                    tone={m.hasPush ? 'ok' : 'muted'}
                    icon={m.hasPush ? Bell : BellOff}
                    label={m.hasPush ? t('pushOn') : t('pushOff')}
                  />
                  <Chip tone="muted" icon={UserCheck} label={t('setupProgress', { done: m.setupDone, total: m.setupTotal })} />
                </div>

                {/* One action per card. For anybody the club is holding out, it is
                    the same button whichever door is shut: approve and release. */}
                <div className="flex items-center gap-2 mt-4">
                  {waiting && canApprove ? (
                    <Button variant="primary" className="flex-1" onClick={() => letIn(m)} disabled={busy}>
                      <Unlock className="h-4 w-4" />
                      {busy ? t('saving') : m.stage === 'pending' ? t('approveEntry') : t('releaseEntry')}
                    </Button>
                  ) : (m.stage === 'never' || m.stage === 'setup') && canApprove ? (
                    // Nothing is holding them out — they just never arrived. This is
                    // the only way the app had to reach them at all.
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
                  {(m.stage === 'never' || m.stage === 'setup') && canApprove && (
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
                      {t('blockAgain')}
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
