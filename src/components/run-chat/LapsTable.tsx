'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui';
import { effortColorForHr, effortScale, type EffortScale } from '@/lib/run-chat/effort-color';
import { groupLaps, type LapBlock } from '@/lib/run-chat/lap-groups';
import { formatDuration, formatPace, type StravaLap } from '@/lib/strava/client';
import { cn } from '@/lib/utils';
import { useRunChatSession } from './RunChatSession';

/** Singles shown before the "show all" toggle kicks in. */
const COLLAPSED_ROW_LIMIT = 12;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; laps: StravaLap[] }
  | { status: 'error' };

// Stream re-mounts message components while scrolling; one fetch per activity
// per page is plenty.
const lapsCache = new Map<string, Promise<StravaLap[]>>();

function fetchLaps(activityId: string, token: string): Promise<StravaLap[]> {
  const cached = lapsCache.get(activityId);
  if (cached) return cached;
  const request = fetch(`/api/run-chat/laps?activityId=${encodeURIComponent(activityId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`laps ${response.status}`);
      const body = (await response.json()) as { laps?: StravaLap[] };
      return Array.isArray(body.laps) ? body.laps : [];
    })
    .catch((error) => {
      lapsCache.delete(activityId);
      throw error;
    });
  lapsCache.set(activityId, request);
  return request;
}

export function formatLapDistance(distance: number, approximate = false): string {
  const text = distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${Math.round(distance)} m`;
  return approximate ? `~${text}` : text;
}

const CELL = 'px-1 py-2 text-center text-xs tabular-nums';

function HeartRateCell({ hr, scale }: { hr: number | null | undefined; scale: EffortScale | null }) {
  const color = effortColorForHr(hr, scale);
  if (!hr) return <TableCell className={cn(CELL, 'text-blue-100/40')}>—</TableCell>;
  return (
    <TableCell className={cn(CELL, 'font-semibold')} style={color ? { color } : undefined}>
      <span className="inline-flex items-center justify-center gap-2">
        {color && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color, boxShadow: `0 0 9px ${color}` }}
            aria-hidden="true"
          />
        )}
        {Math.round(hr)}
      </span>
    </TableCell>
  );
}

function SingleLapRow({ lapNumber, lap, scale }: { lapNumber: number; lap: StravaLap; scale: EffortScale | null }) {
  return (
    <TableRow className="border-[#294057]/80 bg-transparent hover:bg-white/[0.02]">
      <TableCell className={cn(CELL, 'font-bold text-slate-100')}>{lapNumber}</TableCell>
      <TableCell className={cn(CELL, 'font-medium text-slate-100')}>{formatLapDistance(lap.distance)}</TableCell>
      <TableCell className={cn(CELL, 'text-slate-100')}>{formatDuration(lap.moving_time)}</TableCell>
      <TableCell className={cn(CELL, 'text-slate-100')}>{formatPace(lap.average_speed)}</TableCell>
      <HeartRateCell hr={lap.average_heartrate} scale={scale} />
    </TableRow>
  );
}

/** Every row of an expanded repeat shares this accent bar. */
const GROUP_ROW = 'border-s-4 border-s-orange-400';

/** Steps are lettered A, B, C… so "1A" is rep 1, first step. */
function stepLetter(position: number): string {
  return String.fromCharCode(65 + position);
}

/** One lap inside an expanded repeat: labelled by rep and step, drawn inset. */
function RepeatLapRow({
  rep,
  step,
  stepCount,
  lapNumber,
  lap,
  scale,
}: {
  rep: number;
  step: number;
  stepCount: number;
  lapNumber: number;
  lap: StravaLap;
  scale: EffortScale | null;
}) {
  // Alternate shading per rep so "1A 1B | 2A 2B" reads as pairs.
  return (
    <TableRow
      className={cn(
        GROUP_ROW,
        'border-b-[#294057]/70',
        rep % 2 === 0 ? 'bg-[#09192d]' : 'bg-[#0d2038]',
      )}
      data-testid="laps-repeat-lap"
    >
      <TableCell className={cn(CELL, 'ps-3')}>
        <span className="font-bold text-slate-100">
          {rep + 1}
          {stepCount > 1 && <span className="text-orange-300">{stepLetter(step)}</span>}
        </span>
        <span className="ms-1 hidden text-[9px] text-blue-100/50 sm:inline">#{lapNumber}</span>
      </TableCell>
      <TableCell className={cn(CELL, 'font-semibold text-slate-100')}>{formatLapDistance(lap.distance)}</TableCell>
      <TableCell className={cn(CELL, 'text-slate-100')}>{formatDuration(lap.moving_time)}</TableCell>
      <TableCell className={cn(CELL, 'text-slate-100')}>{formatPace(lap.average_speed)}</TableCell>
      <HeartRateCell hr={lap.average_heartrate} scale={scale} />
    </TableRow>
  );
}

function RepeatRows({
  block,
  scale,
}: {
  block: Extract<LapBlock, { kind: 'repeat' }>;
  scale: EffortScale | null;
}) {
  const t = useTranslations('runChat');
  const [open, setOpen] = useState(false);
  const stepCount = block.steps.length;
  const lapsByRep = useMemo(
    () =>
      Array.from({ length: block.reps }, (_, rep) =>
        block.steps.map((step, position) => ({
          rep,
          position,
          lap: step.laps[rep],
          lapNumber: step.lapNumbers[rep],
        })),
      ).flat(),
    [block],
  );
  const structure = block.steps
    .map((step) => `${stepLetter(step.position)} ~${formatLapDistance(step.distanceM)}`)
    .join(' + ');
  const groupHeartRates = block.steps.flatMap((step) =>
    step.laps
      .map((lap) => lap.average_heartrate)
      .filter((hr): hr is number => typeof hr === 'number' && hr > 0),
  );
  const groupHr = groupHeartRates.length
    ? groupHeartRates.reduce((sum, hr) => sum + hr, 0) / groupHeartRates.length
    : null;
  const subtitle = stepCount === 1 ? formatLapDistance(block.steps[0].distanceM, true) : structure;
  const groupColor = effortColorForHr(groupHr, scale);

  return (
    <>
      <TableRow
        className={cn(
          'cursor-pointer border-b-[#294057]/80 bg-[#0b2037] hover:bg-[#102943]',
        )}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="laps-repeat-row"
      >
        <TableCell
          colSpan={5}
          className="relative p-0 before:absolute before:inset-y-0 before:start-0 before:w-1 before:rounded-full before:bg-orange-400"
        >
          <div
            className={cn(
              'grid min-h-[43px] grid-cols-[3rem_1fr_auto] items-center sm:grid-cols-[3.75rem_1fr_5.5rem]',
              stepCount > 1 && 'min-h-[46px]',
            )}
          >
            <span className="text-center text-base font-bold text-orange-400">
              {block.reps}×
            </span>
            <span className="min-w-0">
              <span dir="rtl" className="block text-left text-[10px] font-medium text-slate-400 sm:text-[11px]">
                {t('repeatLaps', { from: block.fromLap, to: block.toLap })}
              </span>
              <span className="block truncate text-[10px] font-medium tabular-nums text-slate-400 sm:text-[11px]">
                {subtitle}
              </span>
            </span>
            <span className="inline-flex items-center justify-end gap-1.5 pe-2 text-xs font-medium tabular-nums">
              {groupHr && (
                <span
                  className="inline-flex items-center gap-2"
                  style={groupColor ? { color: groupColor } : undefined}
                >
                  {groupColor && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: groupColor, boxShadow: `0 0 9px ${groupColor}` }}
                      aria-hidden="true"
                    />
                  )}
                  {Math.round(groupHr)}
                </span>
              )}
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
                aria-hidden="true"
              />
            </span>
          </div>
        </TableCell>
      </TableRow>
      {open &&
        lapsByRep.map(({ rep, position, lap, lapNumber }) => (
          <RepeatLapRow
            key={lapNumber}
            rep={rep}
            step={position}
            stepCount={stepCount}
            lapNumber={lapNumber}
            lap={lap}
            scale={scale}
          />
        ))}
    </>
  );
}

function LapsSkeleton() {
  return (
    <div className="space-y-1.5 p-2" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full bg-white/10" />
      ))}
    </div>
  );
}

export function LapsTableView({ laps }: { laps: StravaLap[] }) {
  const t = useTranslations('runChat');
  const [showAll, setShowAll] = useState(false);
  const blocks = useMemo(() => groupLaps(laps), [laps]);
  const scale = useMemo(() => effortScale(laps.map((lap) => lap.average_heartrate)), [laps]);

  const singlesCount = blocks.filter((block) => block.kind === 'lap').length;
  const needsTruncation = singlesCount > COLLAPSED_ROW_LIMIT;
  const visibleBlocks = useMemo(() => {
    if (!needsTruncation || showAll) return blocks;
    let singles = 0;
    return blocks.filter((block) => {
      if (block.kind !== 'lap') return true;
      singles += 1;
      return singles <= COLLAPSED_ROW_LIMIT;
    });
  }, [blocks, needsTruncation, showAll]);

  return (
    <div dir="ltr" className="overflow-hidden rounded-xl border border-[#294057] bg-[#091a2e]">
      <Table className="text-start">
        <colgroup>
          <col className="w-[8%]" />
          <col className="w-[28%]" />
          <col className="w-[23%]" />
          <col className="w-[19%]" />
          <col className="w-[22%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="border-[#294057] bg-[#071628] hover:bg-[#071628]">
            <TableHead className="h-8 w-9 px-1 text-center text-[9px] font-bold text-slate-400">#</TableHead>
            <TableHead className="h-8 px-1 text-center text-[9px] font-bold text-slate-400">{t('distance')}</TableHead>
            <TableHead className="h-8 px-1 text-center text-[9px] font-bold text-slate-400">{t('time')}</TableHead>
            <TableHead className="h-8 px-1 text-center text-[9px] font-bold text-slate-400">{t('pacePerKm')}</TableHead>
            <TableHead className="h-8 px-1 text-center text-[9px] font-bold text-slate-400">{t('averageHr')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleBlocks.map((block) =>
            block.kind === 'lap' ? (
              <SingleLapRow
                key={`lap-${block.lapNumber}`}
                lapNumber={block.lapNumber}
                lap={block.lap}
                scale={scale}
              />
            ) : (
              <Fragment key={`repeat-${block.fromLap}`}>
                <RepeatRows block={block} scale={scale} />
              </Fragment>
            ),
          )}
        </TableBody>
      </Table>
      {needsTruncation && (
        <button
          type="button"
          className="w-full border-t border-blue-300/15 py-1.5 text-center text-xs font-medium text-blue-200 hover:bg-white/5"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t('hideLaps') : t('showAllLaps', { count: laps.length })}
        </button>
      )}
    </div>
  );
}

/**
 * Interactive laps table for a run card. Fetches laps on demand as the
 * signed-in user; renders `fallback` (the static PNG) when there is no
 * session or the request fails.
 */
export function LapsTable({ activityId, fallback }: { activityId: string; fallback?: React.ReactNode }) {
  const session = useRunChatSession();
  const token = session?.supabaseToken;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchLaps(activityId, token)
      .then((laps) => {
        if (!cancelled) setState({ status: 'ready', laps });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, token]);

  if (!token || state.status === 'error') return <>{fallback ?? null}</>;
  if (state.status === 'loading') return <LapsSkeleton />;
  if (state.laps.length < 2) return null;
  return <LapsTableView laps={state.laps} />;
}
