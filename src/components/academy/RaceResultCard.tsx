'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendJson } from '@/components/academy/completion/shared';
import { EMPTY_GOAL, distanceLabel, goalTimeText, type Goal } from '@/lib/academy/goal';
import { parseClockSec } from '@/lib/academy/test-entry';
import type { HomeRaceResult } from '@/lib/academy/trainee-home';
import { GoalSheet } from '@/components/academy/completion/GoalSheet';
import { typeClock } from '@/lib/time-entry';

// "איך היה?" — the race has been run (goal module G5, mockup goal-module.html phone 5).
//
// The watch run on race day that looks like the race is offered first, so the usual answer is
// one tap. The official time can differ (a watch stopped late, a course a little long), so it
// can be typed instead. Then "מה הבא": a new race opens the goal module; "recovery first" just
// closes this. A result is saved on the goal row (POST /api/academy/goal/result); the next goal
// starts clean.

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

export function RaceResultCard({ athleteId, race, onDone }: { athleteId: string; race: HomeRaceResult; onDone: () => void }) {
  const t = useTranslations('raceResult');
  const [typing, setTyping] = useState(!race.run);
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);

  const ownSec = own.trim() ? parseClockSec(own) : null;
  const ownBad = !!own.trim() && !(ownSec && ownSec >= 600 && ownSec <= 172_800);
  const shown = saved ?? (typing ? (ownSec && !ownBad ? ownSec : null) : race.run?.sec ?? null);
  const vsGoal = shown && race.goalTimeSec ? shown - race.goalTimeSec : null;

  const save = async (resultSec: number, activityId: string | null) => {
    setBusy(true); setError(null);
    try {
      await sendJson('POST', '/api/academy/goal/result', { athleteId, resultSec, activityId });
      setSaved(resultSec);
    } catch (e) {
      setError((e as Error).message || t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveGoal = async (g: Goal) => {
    setBusy(true);
    try {
      await sendJson('PUT', '/api/academy/goal', { athleteId, ...g });
      setGoalOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[22px] bg-white p-4 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
      <div className="text-center">
        <p className="text-[28px]" aria-hidden>🏁</p>
        <p className="mt-0.5 text-[17px] font-extrabold text-ink-900">{saved ? t('savedTitle') : t('title')}</p>
        <p className="mt-0.5 text-xs text-ink-400">
          <span dir="auto">{race.name}</span>
          {race.distanceKm ? <> · <bdi dir="ltr">{distanceLabel(race.distanceKm)}</bdi> {t('km')}</> : null}
          {' · '}<bdi dir="ltr">{dm(race.raceDate)}</bdi>
        </p>
        {!saved && race.run && !typing && (
          <p className="mt-1 text-xs text-ink-400">{t.rich('found', { km: () => <bdi dir="ltr">{race.run!.km}</bdi> })}</p>
        )}
        <p className="mt-2 text-[34px] font-black leading-none tabular-nums text-ink-900" dir="ltr">{shown ? goalTimeText(shown) : '—'}</p>
        {vsGoal != null && (
          <p className={cn('mt-1 text-sm font-bold', vsGoal <= 0 ? 'text-accent-900' : 'text-ink-500')}>
            {vsGoal <= 0 ? t('under', { diff: goalTimeText(-vsGoal) }) : t('over', { diff: goalTimeText(vsGoal) })}
          </p>
        )}
      </div>

      {!saved ? (
        <>
          {typing ? (
            <div className="mt-3 flex min-h-[52px] items-center gap-3 rounded-xl bg-[#F0F0F4] px-4">
              <label htmlFor="race-own" className="flex-1 text-[15px] font-bold text-ink-900">{t('official')}</label>
              <input id="race-own" value={own} onChange={(e) => setOwn(typeClock(e.target.value))} placeholder="3:15:00" dir="ltr" inputMode="numeric"
                className="h-11 w-[120px] bg-transparent text-left text-[16px] font-extrabold text-brand-600 placeholder:font-semibold placeholder:text-ink-300 focus:outline-none" />
            </div>
          ) : null}
          {ownBad && <p className="mt-1 px-1 text-[13px] font-bold text-[#A8510A]">{t('timeBad')}</p>}
          <div className="mt-3 grid gap-2">
            {!typing && race.run ? (
              <>
                <button type="button" disabled={busy} onClick={() => void save(race.run!.sec, race.run!.activityId)}
                  className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" strokeWidth={3} />{t('thisIsIt')}
                </button>
                <button type="button" onClick={() => setTyping(true)} className="min-h-[44px] text-[14px] font-bold text-ink-500">{t('different')}</button>
              </>
            ) : (
              <button type="button" disabled={busy || !ownSec || ownBad} onClick={() => ownSec && void save(Math.round(ownSec), null)}
                className="flex min-h-[48px] items-center justify-center rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-50">
                {t('saveTime')}
              </button>
            )}
          </div>
          {error && <p className="mt-2 px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <p className="mb-1.5 mt-3 px-1 text-xs font-bold text-ink-400">{t('whatsNext')}</p>
          <div className="overflow-hidden rounded-xl bg-[#F0F0F4] divide-y divide-white">
            <button type="button" onClick={() => setGoalOpen(true)} className="flex w-full min-h-[50px] items-center px-4 text-start text-[15px] font-semibold text-ink-900">{t('newRace')}</button>
            <button type="button" onClick={onDone} className="flex w-full min-h-[50px] items-center px-4 text-start text-[15px] font-semibold text-ink-900">{t('recover')}</button>
          </div>
          <p className="mt-2 px-1 text-xs leading-relaxed text-ink-400">{t('savedNote')}</p>
        </>
      )}

      <GoalSheet open={goalOpen} onOpenChange={setGoalOpen} goal={EMPTY_GOAL} athleteId={athleteId} busy={busy} onDone={(g) => void saveGoal(g)} />
    </div>
  );
}
