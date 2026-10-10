'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MissedOption } from '@/lib/academy/coach-tools';
import type { MissedPayload } from '@/lib/academy/coach-tools-payload';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, RICH, SectionLabel } from '../book/ui';
import { WEEKDAY_KEYS } from '../book/WeekBoard';
import { WeekSquares, weekRange } from './shared';

// ── אימונים שפוספסו (mockup academy-coach-tools.html, phone 3) ──────────────────────────
//
// The week as colour squares, what the trainee wrote (if they wrote), and four decisions
// that each say exactly what they do. The preselected one follows the reason: sick or in
// pain → the lighter week; otherwise talk to them first. "לדבר איתו קודם" changes nothing
// and opens the conversation.

export function MissedWeekScreen({ missed, thisWeek, onClose, onDone, onTalk }: {
  missed: MissedPayload;
  thisWeek: string;
  onClose: () => void;
  onDone: () => void;
  onTalk: (athleteId: string) => void;
}) {
  const t = useTranslations('academyTools');
  const tb = useTranslations('workoutBook');
  const [option, setOption] = useState<MissedOption>(missed.preselect);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const first = missed.name.split(' ')[0] || missed.name;
  const when = missed.weekStart === thisWeek ? t('missed.thisWeek') : t('missed.lastWeek');
  const noteDay = missed.note ? WEEKDAY_KEYS[new Date(missed.note.at).getDay()] : null;

  const km = (v: number | null) => (v === null ? '—' : String(v));
  const options: Array<{ value: MissedOption; title: string; sub: React.ReactNode; disabled?: boolean }> = [
    { value: 'light', title: t('missed.lightTitle'), sub: t.rich('missed.lightSub', { ...RICH, km: km(missed.lightKm) }), disabled: missed.lightKm === null },
    { value: 'planned', title: t('missed.plannedTitle'), sub: missed.targetKm === null ? t('missed.plannedEmpty') : t.rich('missed.plannedSub', { ...RICH, km: km(missed.targetKm) }) },
    { value: 'repeat', title: t('missed.repeatTitle'), sub: t.rich('missed.repeatSub', { ...RICH, km: km(missed.missedKm) }), disabled: missed.missedKm === null },
    { value: 'talk', title: t('missed.talkTitle'), sub: t('missed.talkSub') },
  ];

  const apply = async () => {
    setBusy(true); setFailed(false);
    try {
      const res = await fetch('/api/academy/missed-week', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: missed.athleteId, weekStart: missed.weekStart, option }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || String(res.status));
      onDone();
      if (option === 'talk') { onTalk(missed.athleteId); return; }
      setDone(option === 'planned' ? t('missed.doneSame') : body.status === 'sent' ? t('missed.doneSent') : t('missed.done'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowOverlay label={t('missed.title', { name: first, when })}>
      <FlowScreen
        className="gap-3"
        title={t.rich('missed.title', { ...RICH, name: first, when })}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
        footer={done
          ? <PrimaryButton onClick={onClose}>{t('close')}</PrimaryButton>
          : <PrimaryButton onClick={() => void apply()} busy={busy}>{option === 'talk' ? t('missed.openThread') : t('missed.apply')}</PrimaryButton>}
      >
        <div>
          <small className="block text-[14px] font-bold text-ink-400"><bdi dir="ltr">{weekRange(missed.weekStart)}</bdi></small>
          <h2 className="mt-0.5 text-[25px] font-black leading-tight text-ink-900">
            {missed.rule === 'long' ? t('missed.headLong') : t.rich('missed.head', { ...RICH, missed: missed.missed, planned: missed.planned })}
          </h2>
        </div>

        <WeekSquares
          label={tb('weekTitle')}
          squares={missed.sessions.map(s => ({ dayOfWeek: s.dayOfWeek, label: s.label, color: s.color }))}
        />

        <p className={cn(CARD, 'px-4 py-3 text-[15.5px] leading-snug text-ink-700')}>
          {missed.note && noteDay
            ? t.rich('missed.wrote', { ...RICH, name: first, day: t(`dayOn.${noteDay}`), text: missed.note.text })
            : t.rich('missed.noNote', { ...RICH, name: first })}
        </p>

        <SectionLabel>{t('missed.question')}</SectionLabel>
        <div className={cn(CARD, 'overflow-hidden')} role="radiogroup" aria-label={t('missed.question')}>
          {options.map(o => {
            const on = option === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={o.disabled || !!done}
                onClick={() => setOption(o.value)}
                className="flex min-h-[64px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 py-2.5 text-start last:border-0 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <b className="block text-[16.5px] font-extrabold text-ink-900">{o.title}</b>
                  <small className="mt-0.5 block text-[13.5px] leading-snug text-ink-400">{o.sub}</small>
                </span>
                <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', on ? 'border-brand-600' : 'border-ink-300')}>
                  {on && <i className="block h-3 w-3 rounded-full bg-brand-600" />}
                </span>
              </button>
            );
          })}
        </div>

        {done && <p className={cn(CARD, 'px-4 py-3 text-[16px] font-extrabold text-[#0E7A3C]')} role="status">✓ {done}</p>}
        {failed && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{t('error')}</p>}
      </FlowScreen>
    </FlowOverlay>
  );
}
