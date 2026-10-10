'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { academyTestUrl } from '@/lib/academy/deep-links';
import { mainStepIndex } from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowScreen, PrimaryButton, RICH, SectionLabel, clockText, initials } from './ui';
import { draftSteps, mainPace } from './DayPlanner';
import type { DayPlanData, Draft, SendResult } from './types';

// ── לשלוח (mockup phone 3) ───────────────────────────────────────────────────────────────
//
// By the time this screen opens the session is already on the primary trainee's watch —
// the big ✓ is a fact, not a promise. What is left is the two follow-ups the mockup puts
// here: the same session to other trainees, each at their own pace, and keeping this
// version in the book.
//
// The list says, per person, why they can or cannot be sent it: their pace (resolved from
// their own test, the same number their watch will get), "already has a workout that day"
// (not offered — sending would overwrite their coach's plan), or no test, which gets a link
// to set one and never a guessed pace.
//
// Pre-ticked: the trainees in the primary's lane, who would be running this same session
// with the club. Everyone else is one tap away; nobody is sent anything without the count
// on the button saying so.

export function SendScreen({ data, draft, day, primary, onBack, onClose }: {
  data: DayPlanData;
  draft: Draft;
  day: string;
  primary: SendResult;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('workoutBook');
  const T = data.trainee.thresholdSec;
  const pace = mainPace(draft.model, T);
  const isReps = draft.model ? draft.model[mainStepIndex(draft.model)]?.kind === 'reps' : false;

  const eligible = (o: DayPlanData['others'][number]) => !o.busy && !!o.thresholdSec;
  const rank = (o: DayPlanData['others'][number]) => (eligible(o) ? 0 : o.busy ? 1 : 2);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(data.others.filter(o => eligible(o) && o.lane === data.trainee.lane).map(o => o.id)),
  );
  // On unless this is a book entry sent exactly as it is in the book.
  const changed = !!draft.model && JSON.stringify(draft.model) !== JSON.stringify(draft.original);
  const [save, setSave] = useState(draft.source !== 'book' || changed);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'taken' | 'failed'>('idle');
  const [finished, setFinished] = useState(false);

  const saveName = useMemo(() => {
    const main = draft.model?.[mainStepIndex(draft.model)];
    if (main?.kind === 'reps' && main.rest?.length.measure === 'time') {
      return `${draft.name} · ${t('role.rest')} ${clockText(main.rest.length.value)}`;
    }
    return draft.name;
  }, [draft, t]);

  const finish = async () => {
    setBusy(true);
    try {
      const ids = [...picked];
      if (ids.length) {
        const res = await fetch('/api/academy/day-plan', {
          method: 'POST',
          headers: await apiHeaders(true),
          body: JSON.stringify({
            date: data.date,
            recipients: ids,
            workout: { name: draft.name, notes: draft.notes, steps: draftSteps(draft) },
            entryId: draft.entryId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        const next: Record<string, SendResult> = {};
        for (const r of (body?.results ?? []) as SendResult[]) next[r.athleteId] = r;
        if (!res.ok) for (const id of ids) next[id] = { athleteId: id, name: '', status: 'failed' };
        setResults(next);
      }
      if (save && saveState !== 'saved') {
        const res = await fetch('/api/academy/library', {
          method: 'POST',
          headers: await apiHeaders(true),
          body: JSON.stringify({ name: saveName, kind: draft.kind, scope: 'mine', notes: draft.notes, steps: draftSteps(draft) }),
        });
        setSaveState(res.ok ? 'saved' : res.status === 409 ? 'taken' : 'failed');
      }
      setFinished(true);
    } finally {
      setBusy(false);
    }
  };

  const first = data.trainee.name.split(' ')[0] || data.trainee.name;
  const primaryLine = primary.status === 'sent'
    ? (pace ? t.rich(isReps ? 'onWatchOfReps' : 'onWatchOfRun', { ...RICH, name: first, pace: clockText(pace.sec) }) : t('onWatchOf', { name: first }))
    : primary.status === 'saved'
      ? t('savedNoWatch', { name: first })
      : t('savedPushFailed', { name: first });

  return (
    <FlowScreen
      className="gap-3"
      title={t('sendTitle')}
      leading={<BarButton onClick={onBack}><ChevronRight className="h-5 w-5" />{t('back.back')}</BarButton>}
      footer={finished
        ? <PrimaryButton onClick={onClose}>{t('close')}</PrimaryButton>
        : <PrimaryButton onClick={() => void finish()} busy={busy}>{picked.size ? t('sendAlso', { n: picked.size }) : t('finish')}</PrimaryButton>}
    >
      <div className={cn(CARD, 'p-4 text-center')}>
        <div className={cn(
          'mx-auto grid h-[76px] w-[76px] place-items-center rounded-full text-[40px] font-black',
          primary.status === 'failed' ? 'bg-[#FDF0E2] text-[#8A4308]' : 'bg-[#E5F6EC] text-[#0E7A3C]',
        )}>
          {primary.status === 'failed' ? '!' : '✓'}
        </div>
        <p className="mt-2.5 text-[24px] font-black leading-tight text-ink-900"><bdi>{draft.name}</bdi> · {day}</p>
        <p className="mt-1 text-[16px] text-ink-500">{primaryLine}</p>
      </div>

      {data.others.length > 0 && (
        <>
          <SectionLabel>{t('sendOthersTitle')}</SectionLabel>
          <div className={cn(CARD, 'max-h-[300px] overflow-y-auto')}>
            {/* Who can be sent it first, then who already has a session, then who needs a test. */}
            {[...data.others].sort((a, b) => rank(a) - rank(b)).map(o => {
              const can = eligible(o);
              const on = picked.has(o.id);
              const result = results[o.id];
              const theirPace = can ? mainPace(draft.model, o.thresholdSec) : null;
              const toggle = () => {
                if (!can || finished) return;
                setPicked(prev => {
                  const next = new Set(prev);
                  if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                  return next;
                });
              };
              return (
                <div
                  key={o.id}
                  role={can && !finished ? 'checkbox' : undefined}
                  aria-checked={can ? on : undefined}
                  tabIndex={can && !finished ? 0 : -1}
                  onClick={toggle}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
                  className={cn(
                    'flex min-h-[64px] items-center gap-3 border-b border-[#EFEFF4] px-[18px] py-3 last:border-0',
                    can ? 'cursor-pointer' : 'opacity-80',
                  )}
                >
                  <span className={cn(
                    'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2 text-white',
                    on ? 'border-brand-600 bg-brand-600' : 'border-ink-300',
                  )}>
                    {on && <Check className="h-4 w-4" strokeWidth={3.5} />}
                  </span>
                  <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[#DFE2FF] text-13 font-black text-brand-600">{initials(o.name)}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[17px] font-extrabold text-ink-900"><bdi>{o.name}</bdi></b>
                    <small className="mt-0.5 block text-[13.5px] text-ink-400">
                      {result ? <ResultLine result={result} />
                        : o.busy ? t('busyThatDay', { day })
                          : !o.thresholdSec ? (
                            <Link href={academyTestUrl({ recipientIsStaff: true })} onClick={e => e.stopPropagation()} className="font-bold text-[#8A4308]">
                              {t('noTestOther')} ›
                            </Link>
                          )
                            : theirPace ? t.rich(theirPace.reps ? 'theirReps' : 'theirRun', { ...RICH, pace: clockText(theirPace.sec) })
                              : t('ownPace')}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className={cn(CARD, 'flex min-h-[64px] items-center gap-3 px-[18px] py-3')}>
        <span className="min-w-0 flex-1">
          <b className="block text-[17px] font-extrabold text-ink-900">{t('saveToBook')}</b>
          <small className="mt-0.5 block truncate text-[13.5px] text-ink-400">
            {saveState === 'saved' ? t('savedToBook') : saveState === 'taken' ? t('saveTaken') : saveState === 'failed' ? t('saveFailed') : <>&quot;<bdi>{saveName}</bdi>&quot;</>}
          </small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={save}
          aria-label={t('saveToBook')}
          disabled={finished}
          onClick={() => setSave(v => !v)}
          className={cn('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors after:absolute after:-inset-2 after:content-[""]', save ? 'bg-[#1FA55B]' : 'bg-ink-300')}
        >
          <i className={cn('absolute top-1 h-[22px] w-[22px] rounded-full bg-white transition-all', save ? 'left-1' : 'left-[24px]')} />
        </button>
      </div>
    </FlowScreen>
  );
}

function ResultLine({ result }: { result: SendResult }) {
  const t = useTranslations('workoutBook');
  if (result.status === 'sent') return <span className="font-bold text-[#0E7A3C]">✓ {t('result.sent')}</span>;
  if (result.status === 'saved') return <span className="font-bold text-ink-500">{t('result.saved')}</span>;
  if (result.status === 'skipped') return <span>{t(`result.skip.${result.reason === 'has-workout' || result.reason === 'no-test' ? result.reason : 'other'}`)}</span>;
  return <span className="font-bold text-accent-red-ink">{t('result.failed')}</span>;
}
