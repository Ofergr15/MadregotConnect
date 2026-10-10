'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  PROGRESSIONS, copyDefaults, copyWeek, mainPaceOf, squareLabel, targetWeeks, type CopiedWorkout, type Progression,
} from '@/lib/academy/coach-tools';
import { ESTIMATE_THRESHOLD_SEC } from '@/lib/academy/book-steps';
import type { CopyWeekCandidate, CopyWeekResponse } from '@/lib/academy/coach-tools-payload';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, RICH, SectionLabel, clockText, initials, kmText } from '../book/ui';
import { WEEKDAY_KEYS } from '../book/WeekBoard';
import { ChangeWords, Segmented, WeekSquares, signed, weekRange } from './shared';

// ── להעתיק שבוע (mockup academy-coach-tools.html, phones 4 and 5) ───────────────────────
//
// Where (next week, or the next few), to whom (whoever already has workouts there starts
// unticked and says what would be replaced), and whether to progress (as-is, +5% / +10% —
// a rep added or a length stretched, never a pace — or a light week). Then the review: each
// session's change in words and each trainee's own pace in their own column, and whether it
// goes to the watch now or only into the plan.
//
// The preview is computed here with the same pure `copyWeek` the route writes with, from
// the same inputs the GET returned, so the review is what gets saved.

type Step = 'where' | 'review';

export function CopyWeekFlow({ athleteId, weekStart, preselect, onClose, onDone }: {
  athleteId: string;
  weekStart: string;
  /** Trainees to tick to begin with (the home's "next week is empty for N"). */
  preselect?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('academyTools');
  const tb = useTranslations('workoutBook');
  const { data, error } = useApi<CopyWeekResponse>(`/api/academy/copy-week?athleteId=${encodeURIComponent(athleteId)}&weekStart=${weekStart}`);
  const [step, setStep] = useState<Step>('where');
  const [many, setMany] = useState<'next' | 'more'>('next');
  const [n, setN] = useState(2);
  const [mode, setMode] = useState<Progression>('same');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; failed: number; sent: boolean } | null>(null);

  const weeks = useMemo(() => (data ? targetWeeks(data.source.weekStart, many === 'next' ? 1 : n) : []), [data, many, n]);
  const defaults = useMemo(() => (data ? copyDefaults(data.candidates, weeks) : []), [data, weeks]);

  // Ticked to begin with: the empty ones (or the ones the home pointed at, when still empty).
  useEffect(() => {
    if (!data || picked) return;
    const empty = defaults.filter(d => d.ticked).map(d => d.id);
    const start = preselect?.length ? empty.filter(id => preselect.includes(id)) : empty;
    setPicked(new Set(start.length ? start : empty));
  }, [data, defaults, preselect, picked]);

  const chosen = useMemo(() => (data && picked ? data.candidates.filter(c => picked.has(c.id)) : []), [data, picked]);

  const preview = useMemo(() => {
    if (!data) return new Map<string, CopiedWorkout[][]>();
    const out = new Map<string, CopiedWorkout[][]>();
    for (const c of chosen) {
      out.set(c.id, weeks.map((_, k) => copyWeek({
        workouts: data.source.workouts,
        sourceThresholdSec: data.source.thresholdSec,
        targetThresholdSec: c.thresholdSec,
        targetAdjust: c.adjust,
        sameTrainee: c.id === data.source.id,
        mode,
        times: mode === 'plus5' || mode === 'plus10' ? k + 1 : 1,
      })));
    }
    return out;
  }, [data, chosen, weeks, mode]);

  if (!data) {
    return (
      <FlowOverlay label={t('copy.title')}>
        <FlowScreen title={t('copy.title')} leading={<BarButton onClick={onClose}>{t('cancel')}</BarButton>}>
          <p className="py-10 text-center text-sm text-ink-400">{error ? t('error') : t('loading')}</p>
        </FlowScreen>
      </FlowOverlay>
    );
  }

  const src = data.source;
  const ref = src.thresholdSec ?? ESTIMATE_THRESHOLD_SEC;
  const sourceKm = copyWeek({ workouts: src.workouts, sourceThresholdSec: src.thresholdSec, targetThresholdSec: src.thresholdSec, sameTrainee: true, mode: 'same' })
    .reduce((s, c) => s + c.distanceM, 0);
  const srcFirst = src.name.split(' ')[0] || src.name;
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/academy/copy-week', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          sourceAthleteId: src.id, sourceWeek: src.weekStart, weeks: weeks.length,
          recipients: chosen.map(c => c.id), mode, send,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || String(res.status));
      const results = (body.results ?? []) as Array<{ athleteId: string; status: string }>;
      const failed = results.filter(r => r.status === 'failed').length;
      setDone({ ok: new Set(results.filter(r => r.status !== 'failed').map(r => r.athleteId)).size, failed, sent: results.some(r => r.status === 'sent') });
      onDone();
    } catch {
      setDone({ ok: 0, failed: chosen.length * weeks.length, sent: false });
    } finally {
      setBusy(false);
    }
  };

  // ── Step 1: where, who, how ──
  if (step === 'where') {
    return (
      <FlowOverlay label={t('copy.title')}>
        <FlowScreen
          className="gap-3"
          title={t('copy.title')}
          leading={<BarButton onClick={onClose}>{t('cancel')}</BarButton>}
          footer={(
            <PrimaryButton onClick={() => setStep('review')} disabled={!chosen.length || !src.workouts.length}>
              {chosen.length ? t('copy.continue', { count: chosen.length }) : t('copy.pickSomeone')}
            </PrimaryButton>
          )}
        >
          <div>
            <small className="block text-[14px] font-bold text-ink-400">{t.rich('copy.from', { ...RICH, name: srcFirst, range: weekRange(src.weekStart) })}</small>
            <h2 className="mt-0.5 text-[25px] font-black leading-tight text-ink-900">
              {t.rich('copy.head', { ...RICH, count: src.workouts.length, km: kmText(sourceKm) })}
            </h2>
          </div>
          {src.workouts.length ? (
            <WeekSquares
              label={tb('weekTitle')}
              squares={src.workouts.map(w => ({ dayOfWeek: w.dayOfWeek, label: squareLabel(w, ref), color: 'planned' as const }))}
            />
          ) : <p className={cn(CARD, 'px-4 py-4 text-[15px] text-ink-500')}>{t('copy.emptySource')}</p>}

          <SectionLabel>{t('copy.where')}</SectionLabel>
          <Segmented
            label={t('copy.where')}
            value={many}
            onChange={setMany}
            options={[{ value: 'next', label: t('copy.next') }, { value: 'more', label: t('copy.more') }]}
          />
          {many === 'more' && (
            <Segmented
              label={t('copy.more')}
              value={String(n) as '2' | '3' | '4'}
              onChange={v => setN(Number(v))}
              options={(['2', '3', '4'] as const).map(v => ({ value: v, label: t.rich('copy.weeksN', { ...RICH, n: v }) }))}
            />
          )}

          <div className={cn(CARD, 'overflow-hidden')}>
            {data.candidates.map(c => (
              <CandidateRow
                key={c.id}
                c={c}
                on={!!picked?.has(c.id)}
                replaces={defaults.find(d => d.id === c.id)?.replaces ?? 0}
                many={weeks.length > 1}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </div>

          <SectionLabel>{t('copy.progress')}</SectionLabel>
          <div className={cn(CARD, 'p-2')}>
            <Segmented
              label={t('copy.progress')}
              value={mode}
              onChange={setMode}
              options={PROGRESSIONS.map(p => ({ value: p, label: t.rich(`copy.mode.${p}`, RICH) }))}
            />
            <small className="mt-1.5 block px-2 pb-0.5 text-[13px] text-ink-400">{t.rich(`copy.modeHint.${mode}`, RICH)}</small>
          </div>
        </FlowScreen>
      </FlowOverlay>
    );
  }

  // ── Step 2: review and copy ──
  const firstWeek = chosen.map(c => preview.get(c.id)?.[0] ?? []);
  const lead = firstWeek[0] ?? [];
  const leadKm = lead.reduce((s, c) => s + c.distanceM, 0);
  const diffKm = Math.round((leadKm - sourceKm) / 100) / 10;
  const cols = chosen.slice(0, 3);
  const noTest = chosen.filter(c => !c.thresholdSec && c.id !== src.id).map(c => c.name.split(' ')[0]);
  const range = weeks.length > 1 ? `${weekRange(weeks[0]).split('–')[0]}–${weekRange(weeks[weeks.length - 1]).split('–')[1]}` : weekRange(weeks[0]);
  const modeWord = t.rich(`copy.mode.${mode}`, RICH);

  return (
    <FlowOverlay label={t('copy.title')}>
      <FlowScreen
        className="gap-3"
        title={weeks.length > 1 ? t.rich('copy.reviewMany', { ...RICH, n: weeks.length, range }) : t.rich('copy.reviewNext', { ...RICH, range })}
        leading={done ? undefined : <BarButton onClick={() => setStep('where')}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
        footer={done
          ? <PrimaryButton onClick={onClose}>{t('close')}</PrimaryButton>
          : <PrimaryButton onClick={() => void submit()} busy={busy}>{t('copy.go', { count: chosen.length })}</PrimaryButton>}
      >
        <small className="-mb-1 block text-[14px] font-bold text-ink-400">{modeWord} · {t('copy.people', { count: chosen.length })}</small>

        <div className={cn(CARD, 'overflow-hidden')}>
          <div className="flex items-center bg-[#F7F7FA] px-4 py-2 text-[13px] font-bold text-ink-400">
            <span className="flex-1" />
            {cols.map(c => <bdi key={c.id} className="w-[64px] shrink-0 truncate text-center">{c.name.split(' ')[0]}</bdi>)}
          </div>
          {lead.map((w, i) => (
            <div key={`${w.workout.dayOfWeek}-${i}`} className="flex min-h-[60px] items-center border-t border-[#EFEFF4] px-4 py-2.5">
              <span className="min-w-0 flex-1 pe-2">
                <b className="block text-[15.5px] font-extrabold leading-tight text-ink-900">
                  {tb(`dayShort.${WEEKDAY_KEYS[w.workout.dayOfWeek]}`)} · <bdi>{w.workout.name}</bdi>
                </b>
                <small className="mt-0.5 block text-[13.5px] leading-snug text-ink-500"><ChangeWords changes={w.changes} /></small>
              </span>
              {cols.map((c, ci) => {
                const own = firstWeek[ci]?.[i];
                const p = own?.paced ? mainPaceOf(own.workout) : null;
                return (
                  <bdi key={c.id} dir="ltr" className={cn('w-[64px] shrink-0 text-center text-[16px] font-black', p ? 'text-ink-900' : 'text-[13px] font-bold text-ink-400')}>
                    {p ? clockText(p) : t('copy.noPace')}
                  </bdi>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between px-1">
          <span className="text-[16px] text-ink-700">{t.rich('copy.totalEach', { ...RICH, km: kmText(leadKm) })}</span>
          {diffKm !== 0 && (
            <bdi dir="ltr" className={cn('text-[15px] font-black', diffKm > 0 ? 'text-[#0E7A3C]' : 'text-[#8A4308]')}>{signed(diffKm)}</bdi>
          )}
        </div>
        {weeks.length > 1 && (
          <small className="-mt-2 block px-1 text-[13px] text-ink-400">
            {weeks.slice(1).map(w => t.rich('copy.weekOf', { ...RICH, range: weekRange(w) })).map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>)}
          </small>
        )}

        {noTest.length > 0 && (
          <p className="rounded-2xl bg-[#FDF0E2] px-4 py-3 text-[14.5px] font-bold leading-snug text-[#8A4308]" role="note">
            {t.rich('copy.noTestWarn', { ...RICH, names: noTest.join(', ') })}
          </p>
        )}

        <div className={cn(CARD, 'flex min-h-[64px] items-center gap-3 px-4 py-3')}>
          <span className="min-w-0 flex-1">
            <b className="block text-[16.5px] font-extrabold text-ink-900">{t('copy.sendNow')}</b>
            <small className="mt-0.5 block text-[13.5px] text-ink-400">{t('copy.sendSub')}</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={send}
            aria-label={t('copy.sendNow')}
            disabled={!!done}
            onClick={() => setSend(v => !v)}
            className={cn('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors after:absolute after:-inset-2 after:content-[""]', send ? 'bg-[#1FA55B]' : 'bg-ink-300')}
          >
            <i className={cn('absolute top-1 h-[22px] w-[22px] rounded-full bg-white transition-all', send ? 'left-1' : 'left-[24px]')} />
          </button>
        </div>

        {done && (
          <p className={cn(CARD, 'px-4 py-3 text-[16px] font-extrabold', done.failed ? 'text-[#8A4308]' : 'text-[#0E7A3C]')} role="status">
            {done.ok > 0 && <>✓ {t('copy.done', { count: done.ok })}{done.sent && t('copy.doneSent')}</>}
            {done.failed > 0 && <> {t('copy.doneFailed', { count: done.failed })}</>}
          </p>
        )}
      </FlowScreen>
    </FlowOverlay>
  );
}

function CandidateRow({ c, on, replaces, many, onToggle }: {
  c: CopyWeekCandidate;
  on: boolean;
  replaces: number;
  many: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('academyTools.copy');
  return (
    <div
      role="checkbox"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}
      className="flex min-h-[64px] cursor-pointer items-center gap-3 border-b border-[#EFEFF4] px-4 py-2.5 last:border-0"
    >
      <span className={cn('grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2 text-white', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300')}>
        {on && <Check className="h-4 w-4" strokeWidth={3.5} />}
      </span>
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[#DFE2FF] text-13 font-black text-brand-600">{initials(c.name)}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[16.5px] font-extrabold text-ink-900"><bdi>{c.name}</bdi></b>
        <small className={cn('mt-0.5 block text-[13.5px]', replaces ? 'font-bold text-[#8A4308]' : 'text-ink-400')}>
          {replaces ? t('replaces', { count: replaces }) : many ? t('emptyAll') : t('emptyNext')}
          {!c.thresholdSec && <> · {t('noTest')}</>}
        </small>
      </span>
    </div>
  );
}
