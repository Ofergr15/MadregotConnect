'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import {
  GOAL_KIND_LABELS, NO_RACE_KINDS, distanceForKind, distanceLabel, estimateFinish, finishPace, goalProgress,
  goalTimeText, kindForDistance, type FinishEstimate, type Goal, type GoalKind,
} from '@/lib/academy/goal';
import { parseClockSec } from '@/lib/academy/test-entry';
import { Sheet } from '@/components/ui';
import { CARD, PrimaryButton } from '../book/ui';
import { typeClock } from '@/lib/time-entry';

// The goal module (mockup academy-existing-add/goal-module.html, Ofer 2026-10-17: "another
// marathon or another race, with a date too — so it needs a better module").
//
// Three steps in one sheet: WHICH RACE (one of the club's from the calendar, any other race,
// or no race), then — for another race — its details, then the TARGET TIME, offered from the
// trainee's own test. Same props as the old one-form sheet, so the coach's details form and the
// trainee's home card both get it unchanged; `athleteId` lets it read the club's races and the
// test the estimate is made from (GET /api/academy/goal).

interface ClubRace { eventId: string; name: string; date: string; location: string | null; distancesKm: number[] }
interface GoalContext { today: string; clubRaces: ClubRace[]; thresholdSecPerKm: number | null }

type Step = 'race' | 'other' | 'focus' | 'time';
type Pick =
  | { kind: 'club'; eventId: string; distanceKm: number }
  | { kind: 'other' }
  | { kind: 'none'; focus: GoalKind }
  | null;

const PRESETS = [5, 10, 21.0975, 42.195];
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const paceText = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function goalSummary(goal: Goal, typeLabel?: (t: GoalKind) => string): string | null {
  const label = (k: GoalKind) => (typeLabel ? typeLabel(k) : GOAL_KIND_LABELS[k]);
  const what = goal.targetRace || (goal.goalType ? label(goal.goalType) : null);
  const dist = goal.distanceKm && goal.targetRace ? distanceLabel(goal.distanceKm) : null;
  const parts = [what, dist, goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : null].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

export function GoalSheet({ open, onOpenChange, goal, onDone, busy, error, athleteId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal;
  onDone: (goal: Goal) => void;
  busy?: boolean;
  error?: string | null;
  /** Whose goal: the club's races and the test the estimate comes from are read for them. */
  athleteId?: string;
}) {
  const t = useTranslations('completion.goal');
  const { data: ctx } = useApi<GoalContext>(open && athleteId ? `/api/academy/goal?athleteId=${encodeURIComponent(athleteId)}` : null);
  const races = ctx?.clubRaces ?? [];
  const today = ctx?.today ?? new Date().toISOString().slice(0, 10);

  const [step, setStep] = useState<Step>('race');
  const [pick, setPick] = useState<Pick>(null);
  // "Another race"
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<number | 'other' | null>(null);
  const [customKm, setCustomKm] = useState('');
  const [date, setDate] = useState('');
  const [estimate, setEstimate] = useState(false);
  const [month, setMonth] = useState('');
  const [place, setPlace] = useState('');
  // Target time
  const [choice, setChoice] = useState<keyof FinishEstimate | 'own' | 'none' | null>(null);
  const [own, setOwn] = useState('');

  // Open on what is saved: the club race it is, the other race it was, or the no-race focus.
  useEffect(() => {
    if (!open) return;
    setStep('race');
    const dist = goal.distanceKm ?? distanceForKind(goal.goalType);
    if (goal.eventId) setPick({ kind: 'club', eventId: goal.eventId, distanceKm: dist ?? 42.195 });
    else if (goal.targetRace || (goal.goalType && !NO_RACE_KINDS.includes(goal.goalType) && goal.goalType !== 'fitness')) setPick({ kind: 'other' });
    else if (goal.goalType && (NO_RACE_KINDS.includes(goal.goalType) || goal.goalType === 'fitness')) setPick({ kind: 'none', focus: goal.goalType });
    else setPick(null);
    setName(goal.targetRace ?? '');
    setPreset(dist ? (PRESETS.find((p) => Math.abs(p - dist) < 0.01) ?? 'other') : null);
    setCustomKm(dist && !PRESETS.some((p) => Math.abs(p - dist) < 0.01) ? String(dist) : '');
    setEstimate(!!goal.dateIsEstimate);
    setDate(goal.dateIsEstimate ? '' : goal.targetRaceDate ?? '');
    setMonth(goal.dateIsEstimate && goal.targetRaceDate ? goal.targetRaceDate.slice(0, 7) : '');
    setPlace(goal.location ?? '');
    setChoice(goal.goalTimeSec ? 'own' : null);
    setOwn(goal.goalTimeSec ? goalTimeText(goal.goalTimeSec) : '');
  }, [open, goal]);

  const club = pick?.kind === 'club' ? races.find((r) => r.eventId === pick.eventId) ?? null : null;
  const otherKm = preset === 'other' ? Number(customKm.replace(',', '.')) : preset;
  const otherKmOk = !!otherKm && Number.isFinite(otherKm) && otherKm > 0 && otherKm <= 400;
  const otherDate = estimate ? (/^\d{4}-\d{2}$/.test(month) ? `${month}-15` : '') : date;
  const otherOk = !!name.trim() && otherKmOk && !!otherDate && otherDate >= today;

  // The race being aimed at, whichever way it was chosen.
  const race = useMemo(() => {
    if (pick?.kind === 'club' && club) return { name: club.name, date: club.date, km: pick.distanceKm, place: club.location };
    if (pick?.kind === 'club') return { name: goal.targetRace ?? '', date: goal.targetRaceDate ?? '', km: pick.distanceKm, place: goal.location ?? null };
    if (pick?.kind === 'other' && otherOk) return { name: name.trim(), date: otherDate, km: otherKm as number, place: place.trim() || null };
    return null;
  }, [pick, club, otherOk, name, otherDate, otherKm, place, goal]);

  const est = race ? estimateFinish(ctx?.thresholdSecPerKm, race.km) : null;
  const ownSec = own.trim() ? parseClockSec(own) : null;
  const ownBad = choice === 'own' && !!own.trim() && !(ownSec && ownSec >= 600 && ownSec <= 172_800);
  const finish = choice && choice !== 'own' && choice !== 'none' && est ? est[choice] : choice === 'own' && ownSec && !ownBad ? ownSec : null;

  // The time step opens on the realistic estimate when there is one — a number to react to
  // beats a dash. Only when nothing was picked yet: a saved own time stays the own time.
  useEffect(() => {
    if (step === 'time' && choice === null && est) setChoice('realistic');
  }, [step, choice, est]);

  const save = () => {
    if (pick?.kind === 'none') {
      onDone({ goalType: pick.focus, targetRace: null, targetRaceDate: null, goalTimeSec: null, eventId: null, distanceKm: null, location: null, dateIsEstimate: false });
      return;
    }
    if (!race) return;
    onDone({
      goalType: kindForDistance(race.km),
      targetRace: race.name || null,
      targetRaceDate: race.date || null,
      goalTimeSec: finish ? Math.round(finish) : null,
      eventId: pick?.kind === 'club' ? pick.eventId : null,
      distanceKm: race.km,
      location: race.place,
      dateIsEstimate: pick?.kind === 'other' && estimate,
    });
  };

  const title = step === 'other' ? t('otherTitle') : step === 'time' ? t('timeTitle') : step === 'focus' ? t('focusTitle') : t('title');
  const back = step === 'race' ? null : () => setStep(step === 'time' && pick?.kind === 'other' ? 'other' : 'race');
  const primary =
    step === 'race' ? { label: t('next'), disabled: !pick || pick.kind === 'none' || (pick.kind === 'other'), onClick: () => setStep('time') }
      : step === 'other' ? { label: t('next'), disabled: !otherOk, onClick: () => setStep('time') }
        : step === 'focus' ? { label: t('save'), disabled: pick?.kind !== 'none', onClick: save }
          : { label: t('save'), disabled: ownBad, onClick: save };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      leadingAction={back ? (
        <button type="button" onClick={back} className="flex min-h-[44px] items-center gap-0.5 text-[15px] font-bold text-brand-600">
          <ChevronLeft className="h-4 w-4 rotate-180" />{t('back')}
        </button>
      ) : undefined}
      footer={(
        <div className="px-4 pb-3 pt-1">
          <PrimaryButton className="w-full" busy={busy} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</PrimaryButton>
          {step === 'time' && (
            <button type="button" onClick={() => { setChoice('none'); setOwn(''); }} className="mt-1 w-full min-h-[44px] text-[15px] font-bold text-ink-400">
              {t('dontKnow')}
            </button>
          )}
          {error && <p className="px-1 pt-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}
        </div>
      )}
    >
      <div className="space-y-3" dir="rtl">
        {step === 'race' && (
          <>
            <p className="px-1 text-[13px] leading-relaxed text-ink-400">{t('intro')}</p>
            {races.length > 0 && <p className="px-1 text-xs font-bold text-ink-400">{t('clubRaces')}</p>}
            <div className="space-y-2" role="radiogroup" aria-label={t('clubRaces')}>
              {races.map((r) => {
                const on = pick?.kind === 'club' && pick.eventId === r.eventId;
                const p = goalProgress(r.date, today, r.distancesKm[0]);
                const weeks = p.days == null ? 0 : Math.floor(p.days / 7);
                return (
                  <div key={r.eventId} className={cn(CARD, 'p-3.5', on && 'ring-2 ring-brand-600')}>
                    <button type="button" role="radio" aria-checked={on}
                      onClick={() => { setPick({ kind: 'club', eventId: r.eventId, distanceKm: r.distancesKm[0] ?? 42.195 }); setChoice(null); }}
                      className="flex w-full items-start gap-3 text-start">
                      <span className={cn('mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-2', on ? 'border-[7px] border-brand-600' : 'border-ink-300')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold text-ink-900" dir="auto">{r.name}</span>
                        <span className="block text-xs text-ink-400"><bdi dir="ltr">{dm(r.date)}</bdi>{r.location && <> · <span dir="auto">{r.location}</span></>}</span>
                      </span>
                      <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', weeks <= 4 ? 'bg-band-3/10 text-band-3-ink' : 'bg-page text-ink-500')}>
                        {weeks === 0 ? t('thisWeek') : t('weeksLeft', { n: weeks })}
                      </span>
                    </button>
                    {on && r.distancesKm.length > 1 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 ps-[34px]" role="radiogroup" aria-label={t('distance')}>
                        {r.distancesKm.map((d) => (
                          <button key={d} type="button" role="radio" aria-checked={pick?.kind === 'club' && Math.abs(pick.distanceKm - d) < 0.01}
                            onClick={() => { setPick({ kind: 'club', eventId: r.eventId, distanceKm: d }); setChoice(null); }}
                            className={cn('min-h-[34px] rounded-pill px-3 text-[13px] font-extrabold tabular-nums',
                              pick?.kind === 'club' && Math.abs(pick.distanceKm - d) < 0.01 ? 'bg-brand-600 text-white' : 'bg-page text-ink-500')}>
                            <bdi dir="ltr">{distanceLabel(d)}</bdi> {t('km')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {races.length > 0 && <p className="px-1 text-xs font-bold text-ink-400">{t('or')}</p>}
            <div className={cn(CARD, 'overflow-hidden divide-y divide-[#EFEFF4]')}>
              <button type="button" onClick={() => { setPick({ kind: 'other' }); setStep('other'); }} className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600/10 text-brand-600"><Plus className="h-4 w-4" strokeWidth={3} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-900">{t('other')}</span><span className="block text-xs text-ink-400">{pick?.kind === 'other' && name ? name : t('otherSub')}</span></span>
                <ChevronLeft className="h-4 w-4 text-ink-300" />
              </button>
              <button type="button" onClick={() => setStep('focus')} className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-page text-ink-500"><Sparkles className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-900">{t('noRace')}</span><span className="block text-xs text-ink-400">{pick?.kind === 'none' ? GOAL_KIND_LABELS[pick.focus] : t('noRaceSub')}</span></span>
                <ChevronLeft className="h-4 w-4 text-ink-300" />
              </button>
            </div>
          </>
        )}

        {step === 'other' && (
          <>
            <Labeled label={t('raceName')}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('raceNamePh')} dir="auto" maxLength={120}
                className="w-full min-h-[48px] rounded-xl bg-[#F0F0F4] px-3 text-[16px] font-semibold text-ink-900 placeholder:font-normal placeholder:text-ink-300 focus:outline-none" />
            </Labeled>
            <Labeled label={t('distance')} hint={t('distanceHint')}>
              <div className="flex gap-1.5" role="radiogroup" aria-label={t('distance')}>
                {[...PRESETS, 'other' as const].map((p) => (
                  <button key={String(p)} type="button" role="radio" aria-checked={preset === p} onClick={() => setPreset(p)}
                    className={cn('flex h-11 flex-1 items-center justify-center rounded-xl text-[14px] font-extrabold', preset === p ? 'bg-brand-600 text-white' : 'bg-[#F0F0F4] text-ink-500')}>
                    {p === 'other' ? t('distanceOther') : <bdi dir="ltr">{distanceLabel(p)}</bdi>}
                  </button>
                ))}
              </div>
              {preset === 'other' && (
                <input value={customKm} onChange={(e) => setCustomKm(e.target.value)} inputMode="decimal" placeholder={t('kmPh')} dir="ltr"
                  className="mt-2 w-full min-h-[48px] rounded-xl bg-[#F0F0F4] px-3 text-end text-[16px] font-bold text-ink-900 placeholder:font-normal placeholder:text-ink-300 focus:outline-none" />
              )}
            </Labeled>
            <Labeled label={estimate ? t('month') : t('date')}>
              <div className="flex gap-2">
                {estimate ? (
                  <input type="month" value={month} min={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} dir="ltr"
                    className="min-w-0 flex-1 min-h-[48px] rounded-xl bg-[#F0F0F4] px-3 text-[16px] font-semibold text-ink-900 focus:outline-none" />
                ) : (
                  <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} dir="ltr"
                    className="min-w-0 flex-1 min-h-[48px] rounded-xl bg-[#F0F0F4] px-3 text-[16px] font-semibold text-ink-900 focus:outline-none" />
                )}
                <button type="button" aria-pressed={estimate} onClick={() => setEstimate((v) => !v)}
                  className={cn('shrink-0 min-h-[48px] rounded-xl px-3 text-[13px] font-bold', estimate ? 'bg-brand-600 text-white' : 'bg-[#F0F0F4] text-ink-500')}>
                  {t('notFixed')}
                </button>
              </div>
            </Labeled>
            <Labeled label={t('place')}>
              <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('placePh')} dir="auto" maxLength={120}
                className="w-full min-h-[48px] rounded-xl bg-[#F0F0F4] px-3 text-[16px] font-semibold text-ink-900 placeholder:font-normal placeholder:text-ink-300 focus:outline-none" />
            </Labeled>
            {otherOk && <Horizon date={otherDate} today={today} km={otherKm as number} />}
            {estimate && <p className="rounded-xl bg-band-2/10 px-3 py-2 text-[12.5px] leading-relaxed text-band-2-ink">{t('notFixedHint')}</p>}
          </>
        )}

        {step === 'focus' && (
          <div className={cn(CARD, 'overflow-hidden divide-y divide-[#EFEFF4]')} role="radiogroup" aria-label={t('focusTitle')}>
            {NO_RACE_KINDS.map((k) => {
              const on = pick?.kind === 'none' && pick.focus === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setPick({ kind: 'none', focus: k })}
                  className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start">
                  <span className={cn('h-[22px] w-[22px] shrink-0 rounded-full border-2', on ? 'border-[7px] border-brand-600' : 'border-ink-300')} />
                  <span className="flex-1 text-[15px] font-semibold text-ink-900">{GOAL_KIND_LABELS[k]}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 'time' && race && (
          <>
            <div className={cn(CARD, 'p-4 text-center')}>
              <p className="text-xs font-bold text-ink-400"><span dir="auto">{race.name}</span> · <bdi dir="ltr">{distanceLabel(race.km)}</bdi> {t('km')} · <bdi dir="ltr">{dm(race.date)}</bdi></p>
              <p className="mt-2 text-[44px] font-black leading-none tabular-nums text-ink-900" dir="ltr">{finish ? goalTimeText(finish) : '—'}</p>
              {finish && <p className="mt-1.5 text-sm text-ink-500">{t.rich('perKm', { pace: () => <bdi dir="ltr">{paceText(finishPace(finish, race.km))}</bdi> })}</p>}
            </div>
            {est ? (
              <>
                <p className="px-1 text-xs font-bold text-ink-400">{t.rich('estimateFrom', { pace: () => <bdi dir="ltr">{paceText(ctx!.thresholdSecPerKm!)}</bdi> })}</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('timeTitle')}>
                  {(['conservative', 'realistic', 'ambitious'] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={choice === k} onClick={() => setChoice(k)}
                      className={cn('rounded-[18px] p-3 text-center', choice === k ? 'bg-brand-600 text-white' : 'bg-[#F0F0F4]')}>
                      <p className="text-[18px] font-black tabular-nums" dir="ltr">{goalTimeText(est[k])}</p>
                      <p className={cn('text-[11px] font-bold', choice === k ? 'text-white/80' : 'text-ink-400')}>{t(k)}</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="rounded-xl bg-page px-3 py-2 text-[12.5px] leading-relaxed text-ink-500">{race.km > 43 ? t('ultraNoEstimate') : t('noEstimate')}</p>
            )}
            <div className={cn(CARD, 'flex min-h-[52px] items-center gap-3 px-4')}>
              <label htmlFor="goal-own" className="flex-1 text-[15px] font-bold text-ink-900">{t('ownTime')}</label>
              <input id="goal-own" value={own} onFocus={() => setChoice('own')} onChange={(e) => { setOwn(typeClock(e.target.value)); setChoice('own'); }}
                placeholder="3:15:00" dir="ltr" inputMode="numeric"
                className="h-11 w-[120px] bg-transparent text-left text-[16px] font-extrabold text-brand-600 placeholder:font-semibold placeholder:text-ink-300 focus:outline-none" />
              {choice === 'own' && finish && <Check className="h-4 w-4 text-brand-600" />}
            </div>
            {ownBad && <p className="px-1 text-[13px] font-bold text-[#A8510A]">{t('timeBad')}</p>}
            {est && <p className="px-1 text-[12.5px] leading-relaxed text-ink-400">{t('estimateNote')}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block px-1 text-xs font-bold text-ink-400">{label}</span>
      {children}
      {hint && <p className="mt-1 px-1 text-[11.5px] text-ink-400">{hint}</p>}
    </div>
  );
}

/** "עוד 49 שבועות" and what that means for the block: mid-block, a full block, or base first. */
function Horizon({ date, today, km }: { date: string; today: string; km: number }) {
  const t = useTranslations('completion.goal');
  const p = goalProgress(date, today, km);
  if (p.days == null) return null;
  const weeks = Math.floor(p.days / 7);
  const line = p.week > 1 ? t('horizonMid', { total: p.totalWeeks })
    : p.weeksToBlock > 0 ? t('horizonLong', { total: p.totalWeeks, wait: p.weeksToBlock })
      : t('horizonBlock', { total: p.totalWeeks });
  return (
    <div className={cn(CARD, 'p-4')}>
      <p className="text-[15px] font-extrabold text-ink-900">{weeks === 0 ? t('thisWeek') : t('weeksLeft', { n: weeks })}</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-400">{line}</p>
    </div>
  );
}
