'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn, israelToday } from '@/lib/utils';
import { GOAL_TYPES, type GoalType } from '@/lib/academy/characterization';
import { goalTimeText, type Goal } from '@/lib/academy/goal';
import { parseClockSec } from '@/lib/academy/test-entry';
import { Sheet } from '@/components/ui';
import { CARD, PrimaryButton } from '../book/ui';
import { FIELD_INPUT, FieldRow } from './shared';

// ── The goal: the race, its day, the time (phone 2's "מטרה", phone 4's "המטרה שלך") ───────
//
// Every field optional: "מרתון, בלי תאריך עדיין" is a goal. The sheet hands the goal back; the
// staff form saves it with the rest, the trainee's card saves it at once.

export function goalSummary(goal: Goal, typeLabel: (t: GoalType) => string): string | null {
  const parts = [goal.targetRace || (goal.goalType ? typeLabel(goal.goalType) : null), goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : null]
    .filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

export function GoalSheet({ open, onOpenChange, goal, onDone, busy, error }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal;
  onDone: (goal: Goal) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const t = useTranslations('completion.goal');
  const [type, setType] = useState<GoalType | null>(goal.goalType);
  const [race, setRace] = useState(goal.targetRace ?? '');
  const [date, setDate] = useState(goal.targetRaceDate ?? '');
  const [time, setTime] = useState(goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : '');
  useEffect(() => {
    if (!open) return;
    setType(goal.goalType); setRace(goal.targetRace ?? ''); setDate(goal.targetRaceDate ?? '');
    setTime(goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : '');
  }, [open, goal]);
  const timeSec = time.trim() ? parseClockSec(time) : null;
  const timeBad = !!time.trim() && !(timeSec && timeSec >= 600 && timeSec <= 36_000);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      footer={(
        <div className="px-4 pb-3 pt-1">
          <PrimaryButton className="w-full" busy={busy} disabled={timeBad}
            onClick={() => onDone({ goalType: type, targetRace: race.trim() || null, targetRaceDate: date || null, goalTimeSec: timeSec && !timeBad ? Math.round(timeSec) : null })}>
            {t('done')}
          </PrimaryButton>
        </div>
      )}
    >
      <div className="space-y-3" dir="rtl">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('type')}>
          {GOAL_TYPES.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={type === g.value} onClick={() => setType(type === g.value ? null : g.value)}
              className={cn('min-h-[44px] rounded-xl px-3.5 text-[14.5px] font-extrabold', type === g.value ? 'bg-brand-600 text-white' : 'bg-[#F0F0F4] text-ink-700')}>
              {t(`types.${g.value}`)}
            </button>
          ))}
        </div>
        <div className={cn(CARD, 'overflow-hidden')}>
          <FieldRow label={t('race')} htmlFor="goal-race">
            <input id="goal-race" value={race} onChange={(e) => setRace(e.target.value)} placeholder={t('racePh')} dir="auto"
              className={cn(FIELD_INPUT, 'w-[150px] text-right')} maxLength={120} />
          </FieldRow>
          <FieldRow label={t('date')} htmlFor="goal-date">
            <input id="goal-date" type="date" value={date} min={israelToday()} onChange={(e) => setDate(e.target.value)} className={cn(FIELD_INPUT, 'w-[150px]')} />
          </FieldRow>
          <FieldRow label={t('time')} htmlFor="goal-time">
            <input id="goal-time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="3:15:00" inputMode="text" dir="ltr" className={FIELD_INPUT} />
          </FieldRow>
        </div>
        {timeBad && <p className="px-1 text-[13px] font-bold text-[#A8510A]">{t('timeBad')}</p>}
        <p className="px-1 text-[13px] text-ink-400">{t('optional')}</p>
        {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
