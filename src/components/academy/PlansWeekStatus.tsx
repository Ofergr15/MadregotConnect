'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { DispatchReport } from '@/lib/academy/dispatch';
import {
  buildPlanWeekStatus,
  resendErrorText,
  type DispatchRosterEntry,
  type WeekStatusExtras,
  type WeekStatusRow,
} from '@/lib/academy/week-status';
import { initialsOf, type AcademyMember, type AcademyMembersResponse } from './types';

// ── תוכניות → השבוע: did this week reach the watches? ─────────────────────────
//
// Mockup v5, phone 4. Three tiles — reached the watch, sent and did not, no plan yet —
// and under them ONLY the people who need something, each with the one button that
// fixes it: "לשלוח שוב" (POST /api/academy/dispatch/resend, the trainee's own saved
// plan) or "לבנות" (the shell opens the composer on them). Everything else stays off
// the screen: a list of fourteen names where twelve need nothing is how the two who do
// get missed. The folding is `buildPlanWeekStatus` (lib/academy/week-status.ts, tested).

type DispatchResponse = DispatchReport & { roster?: DispatchRosterEntry[] };

/**
 * "לשלוח שוב" for one trainee and week. Shared with the watches screen so both
 * buttons are one behaviour. `onSent` refetches whatever the caller is showing.
 */
export function ResendButton({
  athleteId,
  weekStart,
  onSent,
  className,
}: {
  athleteId: string;
  weekStart: string;
  onSent?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | { error: string }>('idle');
  const send = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/academy/dispatch/resend', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, weekStart }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ error: body?.blame === 'reconnect' ? 'Garmin עדיין לא מחובר' : resendErrorText(body?.error) });
        return;
      }
      setState('sent');
      onSent?.();
    } catch {
      setState({ error: resendErrorText(null) });
    }
  };

  if (state === 'sent') {
    return (
      <span className={cn('inline-flex min-h-[44px] shrink-0 items-center gap-1 px-2 text-xs font-extrabold text-accent-900', className)}>
        <Check className="h-4 w-4" />נשלח
      </span>
    );
  }
  const error = typeof state === 'object' ? state.error : null;
  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={state === 'busy'}
      className={cn(
        'min-h-[44px] shrink-0 rounded-xl px-3 text-xs font-extrabold disabled:opacity-60',
        error ? 'bg-accent-red/10 text-accent-red-ink' : 'bg-brand-600/10 text-brand-600',
        className,
      )}
    >
      {state === 'busy' ? 'שולח…' : error ? <>{error} · שוב</> : 'לשלוח שוב'}
    </button>
  );
}

export function BuildButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('min-h-[44px] shrink-0 rounded-xl bg-brand-600 px-3.5 text-xs font-extrabold text-white', className)}
    >
      לבנות
    </button>
  );
}

const TILES = [
  { key: 'delivered', label: 'תוכנית נשלחה והגיעה לשעון', tone: 'bg-accent-600/10 text-accent-900' },
  { key: 'undelivered', label: 'נשלחה, לא הגיעה לשעון', tone: 'bg-accent-red/10 text-accent-red-ink' },
  { key: 'noPlan', label: 'עוד אין תוכנית', tone: 'bg-page text-ink-500' },
] as const;

/** The pure view, for the preview and for any caller that already holds the data. */
export function PlansWeekStatusView({
  roster,
  report,
  members,
  weekStart,
  onBuild,
  onChanged,
}: {
  roster: DispatchRosterEntry[];
  report: Pick<DispatchReport, 'rows'> | null;
  members?: AcademyMember[];
  weekStart: string;
  onBuild: (athleteId: string) => void;
  onChanged?: () => void;
}) {
  const byId = useMemo(() => new Map((members ?? []).map((m) => [m.athleteId, m])), [members]);
  const status = useMemo(() => {
    const extras = new Map<string, WeekStatusExtras>();
    for (const m of members ?? []) extras.set(m.athleteId, { academyJoinedOn: m.academyJoinedOn, hasBand: !!m.band });
    return buildPlanWeekStatus(roster, report, { weekStart, extras });
  }, [roster, report, members, weekStart]);

  const values = { delivered: status.delivered, undelivered: status.undelivered, noPlan: status.noPlan };

  return (
    <div className="space-y-2.5" dir="rtl">
      <div className="rounded-card bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-extrabold text-ink-900">השבוע של האקדמיה</h3>
          <span className="text-xs font-bold text-ink-400">
            {status.total === 1 ? 'מתאמן אחד' : <><bdi dir="ltr">{status.total}</bdi> מתאמנים</>}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {TILES.map((t) => (
            <div key={t.key} className={cn('rounded-2xl px-1.5 py-2.5 text-center', t.tone)}>
              <b className="block text-[22px] font-black leading-none tabular-nums"><bdi dir="ltr">{values[t.key]}</bdi></b>
              <span className="mt-1 block text-2xs font-bold leading-tight">{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {status.needs.length > 0 ? (
        <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
          {status.needs.map((row) => (
            <NeedRow
              key={row.athleteId}
              row={row}
              member={byId.get(row.athleteId)}
              weekStart={weekStart}
              onBuild={onBuild}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : status.total > 0 ? (
        <div className="rounded-card bg-card px-3.5 py-3">
          <p className="text-sm font-semibold text-accent-900">לכולם יש תוכנית, והיא הגיעה לשעון.</p>
        </div>
      ) : null}
    </div>
  );
}

function NeedRow({
  row,
  member,
  weekStart,
  onBuild,
  onChanged,
}: {
  row: WeekStatusRow;
  member?: AcademyMember;
  weekStart: string;
  onBuild: (athleteId: string) => void;
  onChanged?: () => void;
}) {
  const failed = row.kind === 'undelivered';
  return (
    <div className="flex min-h-[56px] items-center gap-2.5 px-3 py-1.5">
      <span className="relative shrink-0">
        {member?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600/15 text-xs font-extrabold text-brand-600">
            {initialsOf(row.name)}
          </span>
        )}
        {failed && <span className="absolute -bottom-px -left-px h-3 w-3 rounded-full bg-accent-red ring-2 ring-card" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-ink-900" dir="auto">{row.name}</span>
        <span className="block truncate text-xs text-ink-400">{row.reason}</span>
      </span>
      {row.kind === 'no_plan'
        ? <BuildButton onClick={() => onBuild(row.athleteId)} />
        : row.canResend
          ? <ResendButton athleteId={row.athleteId} weekStart={weekStart} onSent={onChanged} />
          : null}
    </div>
  );
}

/** The fetching wrapper. Staff-only (the dispatch route scopes a coach to their own trainees). */
export function PlansWeekStatus({
  weekStart,
  onBuild,
  members: membersProp,
}: {
  weekStart: string;
  onBuild: (athleteId: string) => void;
  /** The shell's members payload, when it already holds it; fetched otherwise. */
  members?: AcademyMember[];
}) {
  const { data, error, mutate } = useApi<DispatchResponse>(`/api/academy/dispatch?weekStart=${encodeURIComponent(weekStart)}`);
  const { data: membersData } = useApi<AcademyMembersResponse>(
    membersProp ? null : `/api/academy/members?weekStart=${encodeURIComponent(weekStart)}`,
  );
  const members = membersProp ?? membersData?.members;

  if (error) return <p className="py-6 text-center text-xs text-accent-red-ink">לא הצלחנו לטעון את מצב השבוע</p>;
  if (!data) return <div className="h-[132px] animate-pulse rounded-card bg-card/60" aria-busy />;
  return (
    <PlansWeekStatusView
      roster={data.roster ?? []}
      report={data}
      members={members}
      weekStart={weekStart}
      onBuild={onBuild}
      onChanged={() => { void mutate(); }}
    />
  );
}
