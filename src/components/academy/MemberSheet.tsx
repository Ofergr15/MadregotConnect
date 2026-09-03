'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity, CheckCircle2, ClipboardList, Route, Timer, Trophy, UserMinus, Watch, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { apiHeaders } from '@/lib/api';
import { Sheet, InsetSection, InsetRow, ConfirmSheet, Spinner } from '@/components/ui';
import { CoachPairing } from './CoachPairing';
import {
  ATTENTION_ORDER, ATTENTION_STYLE, fmtRate, initialsOf, rateColor,
  type AcademyBand, type AcademyCoachSummary, type AcademyMember,
} from './types';

// One member, everything the coach needs about them, reachable from any list
// that shows them. The roster used to be a dead end: a name, a group chip, and a
// one-tap unconfirmed "remove" — so the answer to "how is Dana actually doing?"
// lived in a different tab, keyed by nothing but her name appearing in both.
//
// The week breakdown is fetched lazily on open rather than folded into
// /api/academy/members: it's per-workout detail for one athlete, and loading it
// for every member up front would multiply the directory's payload by the number
// of sessions in a training week to show something only one member's sheet ever
// displays.

interface WorkoutRow {
  date: string;
  name: string;
  completed: boolean;
  distance: { status: string; plannedMin: number; plannedMax: number; actual: number | null };
  // `estimated` — the plan set no time, so `planned` is the engine's own guess
  // and must not be shown as a target. See lib/academy/adherence.ts.
  duration: { status: string; planned: number; actual: number | null; estimated?: boolean };
  pace: { status: string; plannedMin: number | null; plannedMax: number | null; actual: number | null };
  score: number;
}

export function MemberSheet({
  member,
  weekStart,
  onOpenChange,
  onRemove,
  removing,
  coaches,
  bands,
  canAssign,
  onChanged,
}: {
  member: AcademyMember | null;
  weekStart: string;
  onOpenChange: (open: boolean) => void;
  /** Omitted for a viewer who may not edit the roster (a coach previewing, say). */
  onRemove?: (athleteId: string) => void;
  removing?: boolean;
  /** The academy's coach roster. Empty for a coach, who can't reassign anyone. */
  coaches?: AcademyCoachSummary[];
  /** The academy's goal bands. Sent to coaches too — they read them, managers set them. */
  bands?: AcademyBand[];
  /** Manager-only: may change who coaches this trainee, and which band they're in. */
  canAssign?: boolean;
  /** Revalidate the academy payload after a pairing or pace edit. */
  onChanged?: () => void | Promise<void>;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const athleteId = member?.athleteId ?? null;

  useEffect(() => {
    if (!athleteId) { setWorkouts(null); return; }
    let cancelled = false;
    setWorkouts(null);
    setLoadingWeek(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/academy/adherence?athleteId=${encodeURIComponent(athleteId)}&weekStart=${weekStart}`,
          { headers: await apiHeaders() },
        );
        const data = await res.json();
        if (!cancelled) setWorkouts(data.athletes?.[0]?.week?.workouts ?? []);
      } catch {
        if (!cancelled) setWorkouts([]);
      } finally {
        if (!cancelled) setLoadingWeek(false);
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId, weekStart]);

  if (!member) {
    return <Sheet open={false} onOpenChange={onOpenChange}><span /></Sheet>;
  }

  const km = (meters: number | null) => (meters == null ? '—' : `${(meters / 1000).toFixed(1)}`);
  const mins = (sec: number | null) => (sec == null ? '—' : String(Math.round(sec / 60)));
  const dayName = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });

  const lastSeen = member.daysSinceActivity === null
    ? t('never')
    : member.daysSinceActivity === 0
      ? t('today')
      : t('daysAgo', { days: member.daysSinceActivity });

  return (
    <>
      <Sheet open={!!member} onOpenChange={onOpenChange} title={member.name}>
        <div dir="auto">
          {/* Identity block */}
          <div className="flex items-center gap-3 pb-4">
            {member.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={member.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-brand-600/20 flex items-center justify-center text-base font-bold text-brand-600 shrink-0">
                {initialsOf(member.name)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-ink-700 truncate">{member.name}</div>
              <div className="text-xs text-ink-400 truncate" dir="ltr">{member.email}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {member.groupName && (
                  <span className="text-2xs font-bold px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 border border-purple-500/20">
                    {member.groupName}
                  </span>
                )}
                <span className={cn(
                  'text-2xs font-bold px-2 py-0.5 rounded-md border flex items-center gap-1',
                  member.hasWatch
                    ? 'bg-accent-600/15 text-accent-600 border-accent-600/20'
                    : 'bg-accent-red/15 text-accent-red border-accent-red/20',
                )}>
                  <Watch className="h-3 w-3" />
                  {member.hasWatch ? (member.hasGarmin ? 'Garmin' : 'Strava') : t('noGarmin')}
                </span>
              </div>
            </div>
          </div>

          {/* Attention badges — the same codes the lists show, repeated here so the
              sheet explains why the member was surfaced in the first place. */}
          {member.attention.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-4">
              {ATTENTION_ORDER.filter((r) => member.attention.includes(r)).map((r) => (
                <span key={r} className={cn('text-2xs font-semibold px-2 py-1 rounded-md border', ATTENTION_STYLE[r])}>
                  {t(`reason_${r}`)}
                </span>
              ))}
            </div>
          )}

          {/* Who is responsible for this trainee, what they're training for, and
              the paces they run. First, above the week's numbers: in a 1:1 academy
              an unpaired or unpaced trainee makes every figure below it
              meaningless — nobody wrote the plan those percentages are measured
              against. */}
          {onChanged && (
            <CoachPairing
              member={member}
              coaches={coaches ?? []}
              bands={bands ?? []}
              canAssign={!!canAssign}
              onChanged={onChanged}
            />
          )}

          {/* This week's numbers */}
          <div className="grid grid-cols-3 gap-2 pb-4">
            <StatTile
              icon={ClipboardList}
              value={member.plannedCount > 0 ? `${member.completedCount}/${member.plannedCount}` : '—'}
              label={t('plannedVsDone')}
            />
            <StatTile
              icon={Trophy}
              value={fmtRate(member.completionRate)}
              label={t('adherence')}
              valueClass={rateColor(member.completionRate)}
            />
            <StatTile icon={Route} value={member.weekKm.toFixed(1)} label={t('weekKmShort')} />
          </div>

          <InsetSection header={t('memberFacts')}>
            <InsetRow icon={Activity} iconBg="bg-brand-600" label={t('weekRuns')} value={String(member.weekRuns)} />
            <InsetRow icon={Timer} iconBg="bg-band-2" label={t('weekTime')} value={t('minutesValue', { min: member.weekDurationMin })} />
            <InsetRow icon={Route} iconBg="bg-accent-600" label={t('allTimeKm')} value={member.totalKm.toFixed(1)} />
            <InsetRow icon={Activity} iconBg="bg-violet-600" label={t('allTimeRuns')} value={String(member.totalRuns)} />
            <InsetRow icon={Watch} iconBg="bg-band-3" label={t('lastActivity')} value={lastSeen} />
          </InsetSection>

          {/* Per-workout planned-vs-actual for the selected week */}
          <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">
            {t('weekBreakdown')}
          </p>
          <div className="rounded-card bg-card/80 border border-page/50 overflow-hidden divide-y divide-page/50 mb-5">
            {loadingWeek ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-ink-400">
                <Spinner size={16} /> {t('loading')}
              </div>
            ) : !workouts || workouts.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-ink-400">{t('noPlannedWorkouts')}</p>
            ) : (
              workouts.map((w, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-9 shrink-0 text-center">
                    <div className="text-2xs text-ink-400 font-semibold">{dayName(w.date)}</div>
                    {w.completed
                      ? <CheckCircle2 className="h-4 w-4 text-accent-600 mx-auto mt-1" />
                      : <XCircle className="h-4 w-4 text-ink-400 mx-auto mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-700 truncate">{w.name}</div>
                    {w.completed ? (
                      <div className="mt-0.5 text-xs text-ink-400 tabular-nums">
                        {km(w.distance.actual)} / {km(w.distance.plannedMin)} {t('kmUnit')}
                        {' · '}
                        {mins(w.duration.actual)}
                        {!w.duration.estimated && ` / ${mins(w.duration.planned)}`} {t('minUnit')}
                        {w.pace.actual != null && ` · ${formatPace(w.pace.actual)}`}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-ink-400">{t('notCompleted')}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <InsetSection>
            <InsetRow
              icon={Activity}
              iconBg="bg-ink-300"
              label={t('openProfile')}
              href={`/dashboard/teammate/${member.athleteId}`}
            />
            {onRemove && (
              <InsetRow
                icon={UserMinus}
                iconBg="bg-accent-red"
                label={removing ? t('removing') : t('removeFromAcademy')}
                danger
                onClick={removing ? undefined : () => setConfirmRemove(true)}
              />
            )}
          </InsetSection>
        </div>
      </Sheet>

      {/* Removing a member from the academy drops their individual plans and pace
          targets, so it gets a confirmation — the old roster fired it straight
          from a bare icon button. */}
      <ConfirmSheet
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('removeConfirmTitle', { name: member.name })}
        description={t('removeConfirmDesc')}
        confirmLabel={t('removeFromAcademy')}
        cancelLabel={t('cancel')}
        onConfirm={() => onRemove?.(member.athleteId)}
      />
    </>
  );
}

function StatTile({
  icon: Icon, value, label, valueClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-card/60 border border-page/60 px-3 py-2.5 text-center">
      <Icon className="h-3.5 w-3.5 text-ink-400 mx-auto" />
      <div className={cn('mt-1 text-lg font-bold tabular-nums leading-none', valueClass || 'text-ink-700')}>{value}</div>
      <div className="mt-1 text-2xs text-ink-400 leading-tight">{label}</div>
    </div>
  );
}
