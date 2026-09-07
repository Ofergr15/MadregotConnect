'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  Wrench, Search, Lock, Unlock, Clock, BellOff, Bell, Watch,
  CheckCircle2, DoorOpen, UserCheck, ChevronLeft, Users as UsersIcon,
} from 'lucide-react';
import { cn, getGroupChip } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Button, Card, EmptyState, SegmentedControl, Skeleton } from '@/components/ui';
import {
  isWaitingOnUs,
  type EntryQueueMember,
  type EntryStage,
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
}

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

  const [bucket, setBucket] = useState<Bucket>('waiting');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  // Memoised so the counts below don't recompute on every render over a fresh []
  const members = useMemo(() => data?.members || [], [data]);
  const maintenanceOn = !!data?.maintenance;
  const canApprove = !!data?.canApprove;

  const counts = useMemo(() => ({
    all: members.length,
    waiting: members.filter((m) => isWaitingOnUs(m.stage)).length,
    stuck: members.filter((m) => m.stage === 'never' || m.stage === 'setup').length,
    ready: members.filter((m) => m.stage === 'ready').length,
  }), [members]);

  const visible = members.filter((m) => {
    const needle = query.trim().toLowerCase();
    if (needle && !`${m.name} ${m.email || ''}`.toLowerCase().includes(needle)) return false;
    if (bucket === 'all') return true;
    if (bucket === 'waiting') return isWaitingOnUs(m.stage);
    if (bucket === 'stuck') return m.stage === 'never' || m.stage === 'setup';
    return m.stage === 'ready';
  });

  /** Approve + release, in one request. Both doors, one tap. */
  const letIn = async (member: EntryQueueMember) => {
    setBusyId(member.id);
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: member.id }),
      });
      if (res.ok) {
        mutate();
        mutateMaintenance();
      }
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

      {visible.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={query.trim() ? t('noMatches') : t('emptyTitle')}
          description={query.trim() ? undefined : t('emptyDescription')}
        />
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
                  ) : (
                    <Link href={`/dashboard/teammate/${m.id}`} className="flex-1">
                      <Button variant="secondary" className="w-full">
                        <ChevronLeft className="h-4 w-4" />
                        {t('openProfile')}
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
