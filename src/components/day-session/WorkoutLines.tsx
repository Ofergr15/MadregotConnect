'use client';

import { useTranslations } from 'next-intl';
import type { WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { PaceTokens } from '@/components/PaceTokens';
import { stepPaceTokens } from '@/lib/garmin/pace';
import { isRestStep, stepMetric, stepQualifier, type StepUnits } from '@/lib/plans/step-display';
import { profileSegments, type SegmentKind } from '@/lib/plans/session-profile';

// The day session's steps the way the planner writes them: a row per step, the metric, what
// the note adds ("הליכה"), and the pace in the club's notation ❶ (❷) ((❸)) — a repeat as its
// count with its steps under it. Read-only; editing is the planner's own WorkoutEditorPanel.

const TYPE_KEY: Record<WorkoutStep['type'], string> = {
  warmup: 'stepWarmup', active: 'stepActive', interval: 'stepInterval', rest: 'stepRest', recovery: 'stepRecovery', cooldown: 'stepCooldown',
};
const ZONE_KEY: Record<string, string> = {
  easy: 'zoneEasy', threshold: 'zoneThreshold', interval: 'zoneInterval', tempo: 'zoneTempo', sprint: 'zoneSprint', marathon_pace: 'zoneMarathonPace',
};

/** The same strip as the next-session card: width is time, height is effort. */
const SEG_HEIGHT: Record<SegmentKind, string> = { warm: '38%', cool: '38%', rest: '22%', easy: '58%', hard: '100%' };
const SEG_COLOR: Record<SegmentKind, string> = {
  warm: 'linear-gradient(#C9CDD9,#AEB3C2)', cool: 'linear-gradient(#C9CDD9,#AEB3C2)', rest: '#D5D8E1',
  easy: 'linear-gradient(#4ADE7B,#22B45A)', hard: 'linear-gradient(#FFB547,#FF8A00)',
};

export function ProfileStrip({ steps, className }: { steps: WorkoutStep[]; className?: string }) {
  const profile = profileSegments(steps);
  if (!profile.length) return null;
  return (
    <span className={cn('flex h-6 items-end gap-[2px]', className)} aria-hidden>
      {profile.map((seg, i) => (
        <span key={i} className="block rounded-t-[5px] rounded-b-[2px]" style={{ flexGrow: seg.share, flexBasis: 0, minWidth: 2, height: SEG_HEIGHT[seg.kind], background: SEG_COLOR[seg.kind] }} />
      ))}
    </span>
  );
}

export function WorkoutLines({ steps, highlight, className }: { steps: WorkoutStep[]; highlight?: number; className?: string }) {
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };

  const row = (s: WorkoutStep, key: string, inner = false) => {
    const tokens = stepPaceTokens(s);
    const zone = !tokens[0] && s.targetZone ? ZONE_KEY[s.targetZone] : null;
    const metric = stepMetric(s, units) || (s.durationType === 'open' ? t('lap') : '');
    const note = stepQualifier(s);
    return (
      <li key={key} className={cn('flex items-baseline justify-between gap-3 py-1', inner && 'ps-3')}>
        <span className={cn('min-w-0 text-[15px] leading-snug', isRestStep(s) ? 'text-ink-400' : 'font-bold text-ink-900')}>
          <span className="text-13 font-bold text-ink-400">{t(TYPE_KEY[s.type])}</span>
          {metric && <> <bdi dir="ltr">{metric}</bdi></>}
          {note && <span className="font-normal text-ink-500"> · {note}</span>}
        </span>
        {tokens[0]
          ? <PaceTokens tokens={tokens} highlight={highlight} size="sm" className="shrink-0" />
          : zone && <span className="shrink-0 text-13 font-bold text-brand-600">{t(zone)}</span>}
      </li>
    );
  };

  return (
    <ul className={cn('divide-y divide-[#EFEFF4]', className)}>
      {steps.map((s, i) => (s.repeatSteps?.length ? (
        <li key={i} className="py-1">
          <span className="inline-flex items-center rounded-[10px] bg-ink-900 px-2.5 py-0.5 text-sm font-extrabold tabular-nums text-white">
            <bdi dir="ltr">{s.repeatCount}×</bdi>
          </span>
          <ul>{s.repeatSteps.map((c, j) => row(c, `${i}.${j}`, true))}</ul>
        </li>
      ) : row(s, String(i))))}
    </ul>
  );
}
