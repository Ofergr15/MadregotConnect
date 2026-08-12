'use client';

import { cn } from '@/lib/utils';

interface Segment {
  kind: 'warmup' | 'interval' | 'recovery' | 'cooldown' | 'easy' | 'rest' | 'repeat';
  label?: string;
  detail?: string;
  reps?: number;
  distanceM?: number;
  durationSec?: number;
  targetPaceSec?: number;
  targetHrPct?: number;
  note?: string;
  steps?: Segment[];
}

interface PlannedWorkout {
  title?: string;
  prompt?: string;
  segments: Segment[];
}

interface ActualLap {
  index: number;
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  name?: string;
}

interface Props {
  plannedText: string | null;
  plannedWorkout: PlannedWorkout | null;
  laps?: ActualLap[] | null;
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}ק"מ` : `${m}מ`;
}

function segmentLabel(seg: Segment): string {
  if (seg.detail) return seg.detail;
  const parts: string[] = [];
  if (seg.reps && seg.reps > 1) parts.push(`${seg.reps}×`);
  if (seg.distanceM) parts.push(formatDist(seg.distanceM));
  if (seg.durationSec) {
    const m = Math.floor(seg.durationSec / 60);
    parts.push(`${m} דק'`);
  }
  if (seg.targetPaceSec) parts.push(`@ ${formatPace(seg.targetPaceSec)}`);
  if (seg.targetHrPct) parts.push(`@ ${seg.targetHrPct}% דופק`);
  return parts.join(' ') || seg.note || seg.label || seg.kind;
}

const KIND_HE: Record<string, string> = {
  warmup: 'חימום',
  interval: 'חזרה',
  recovery: 'התאוששות',
  rest: 'מנוחה',
  cooldown: 'שחרור',
  easy: 'קל',
  repeat: 'חזרה',
};

const KIND_COLOR: Record<string, string> = {
  warmup:   'bg-red-500/20 text-red-300',
  interval: 'bg-blue-500/25 text-blue-300',
  recovery: 'bg-slate-500/30 text-slate-300',
  rest:     'bg-slate-600/40 text-slate-300',
  cooldown: 'bg-red-500/15 text-red-300',
  easy:     'bg-green-500/20 text-green-400',
  repeat:   'bg-slate-500/20 text-slate-400',
};

const KIND_BAR: Record<string, string> = {
  warmup:   'bg-red-500/60',
  interval: 'bg-blue-500/70',
  recovery: 'bg-slate-500/40',
  rest:     'bg-slate-600/50',
  cooldown: 'bg-red-500/40',
  easy:     'bg-green-500/40',
  repeat:   'bg-slate-500/30',
};

function paceColor(actualSecPerKm: number, targetSecPerKm: number): string {
  const diff = actualSecPerKm - targetSecPerKm;
  if (diff < -5) return 'text-yellow-400';
  if (diff < 10) return 'text-green-400';
  if (diff < 25) return 'text-amber-400';
  return 'text-red-400';
}

export function WorkoutCard({ plannedText, plannedWorkout, laps }: Props) {
  if (!plannedWorkout && !plannedText) return null;

  const prompt = plannedWorkout?.prompt || plannedText;
  const segments = plannedWorkout?.segments ?? [];

  const totalDist = segments.reduce((s, seg) => {
    if (seg.kind === 'repeat' && seg.steps) {
      const inner = seg.steps.reduce((a, st) => a + (st.distanceM ?? 0), 0);
      return s + inner * (seg.reps ?? 1);
    }
    return s + (seg.distanceM ?? 0) * (seg.reps ?? 1);
  }, 0);

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/40 overflow-hidden mb-2">
      <div className="px-4 py-2.5 border-b border-slate-700/40 flex items-center gap-2">
        <span className="text-xs font-semibold text-primary-400 uppercase tracking-wide">תוכנית אימון</span>
        {plannedWorkout?.title && (
          <span className="text-xs text-slate-400">{plannedWorkout.title}</span>
        )}
      </div>

      {prompt && (
        <p className="px-4 py-2.5 text-sm text-white font-medium border-b border-slate-700/30 bg-slate-900/40">
          {prompt}
        </p>
      )}

      {segments.length > 0 ? (
        <div className="divide-y divide-slate-700/30">
          {segments.map((seg, i) => {
            const reps = seg.reps ?? 1;
            const segDist =
              seg.kind === 'repeat' && seg.steps
                ? seg.steps.reduce((a, st) => a + (st.distanceM ?? 0), 0) * reps
                : (seg.distanceM ?? 0) * reps;
            const barWidth = totalDist > 0
              ? Math.max(4, (segDist / totalDist) * 100)
              : 100 / segments.length;

            const matchedLap = laps?.[i];
            const actualPaceSec = matchedLap && matchedLap.distance > 0
              ? matchedLap.moving_time / (matchedLap.distance / 1000)
              : null;

            return (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <span className={cn(
                  'shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                  KIND_COLOR[seg.kind] ?? 'bg-slate-600 text-slate-300',
                )}>
                  {KIND_HE[seg.kind] ?? seg.kind}
                </span>

                <div className="flex-1 h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', KIND_BAR[seg.kind] ?? 'bg-slate-500/40')}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                <span className="text-xs text-slate-300 shrink-0 max-w-[55%] text-end">
                  {seg.label ? `${seg.label}: ` : ''}{segmentLabel(seg)}
                </span>

                {actualPaceSec && seg.targetPaceSec && (
                  <span className={cn('text-xs font-mono shrink-0', paceColor(actualPaceSec, seg.targetPaceSec))}>
                    {formatPace(actualPaceSec)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : plannedText && !prompt ? (
        <p className="px-4 py-3 text-sm text-slate-300 whitespace-pre-line">{plannedText}</p>
      ) : null}
    </div>
  );
}
