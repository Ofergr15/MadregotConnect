'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PACE_KINDS, PACE_MEANINGFUL_SEC, type KindEvidence, type PaceKind } from '@/lib/academy/coach-tools';
import type { PaceSuggestionPayload, PaceUpdateResponse } from '@/lib/academy/coach-tools-payload';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, RICH, clockText } from '../book/ui';
import { Segmented, dayMonth, signed } from './shared';

// ── הצעת קצב (mockup academy-coach-tools.html, phone 2) ────────────────────────────────
//
// Why (the last sessions of the kind that moved, against the dashed plan line, with their
// dates), what would change (today against proposed, only the kinds that moved, easy kept
// as the reference row), and the three decisions. Nothing changes for the trainee until a
// button is pressed; the route recomputes the suggestion and takes the numbers from there.

const GREEN = '#118A43';
const AMBER = '#C2610C';

export function PaceSuggestionScreen({ suggestion, onClose, onDone }: {
  suggestion: PaceSuggestionPayload;
  onClose: () => void;
  /** After a decision: refresh the lists. `snoozed` for "לא עכשיו". */
  onDone: (action: 'apply' | 'half' | 'snooze') => void;
}) {
  const t = useTranslations('academyTools');
  const [kind, setKind] = useState<PaceKind>(suggestion.kinds[0].kind);
  const [busy, setBusy] = useState<'apply' | 'half' | 'snooze' | null>(null);
  const [result, setResult] = useState<PaceUpdateResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const ev = suggestion.kinds.find(k => k.kind === kind) ?? suggestion.kinds[0];
  const first = suggestion.name.split(' ')[0] || suggestion.name;
  const faster = ev.direction === 'faster';
  const moved = new Set(suggestion.kinds.map(k => k.kind));

  const rows = useMemo(() => PACE_KINDS
    .filter(k => moved.has(k) || (k === 'easy' && suggestion.current.easy))
    .map(k => {
      const today = suggestion.current[k] ?? null;
      const change = suggestion.kinds.find(e => e.kind === k)?.proposedSec ?? 0;
      return { kind: k, today, proposed: today !== null ? today + change : null, changed: change !== 0 };
    }), [suggestion]); // eslint-disable-line react-hooks/exhaustive-deps

  const halves = [...new Set(suggestion.kinds.map(k => k.halfSec))];
  const decide = async (action: 'apply' | 'half' | 'snooze') => {
    setBusy(action); setFailed(false);
    try {
      const res = await fetch('/api/academy/pace-update', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: suggestion.athleteId, action }),
      });
      const body = await res.json().catch(() => ({})) as PaceUpdateResponse;
      if (!res.ok && body.error !== 'no-suggestion') throw new Error(body.error || String(res.status));
      setResult({ ...body, action });
      onDone(action);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const changedList = rows.filter(r => r.changed).map(r => t(`kindThe.${r.kind}`)).join(t('waiting.and'));

  return (
    <FlowOverlay label={t('pace.title', { name: first })}>
      <FlowScreen
        className="gap-3"
        title={t.rich('pace.title', { ...RICH, name: first })}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
        footer={result ? (
          <PrimaryButton onClick={onClose}>{t('close')}</PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={() => void decide('apply')} busy={busy === 'apply'} disabled={!!busy}>{t('pace.apply')}</PrimaryButton>
            <div className="flex gap-2.5">
              <PrimaryButton secondary className="flex-1 text-[16px]" onClick={() => void decide('half')} busy={busy === 'half'} disabled={!!busy}>
                {halves.length === 1 && halves[0] !== 0 ? t.rich('pace.half', { ...RICH, sec: signed(halves[0]) }) : t('pace.halfPlain')}
              </PrimaryButton>
              <PrimaryButton secondary className="flex-1 text-[16px]" onClick={() => void decide('snooze')} busy={busy === 'snooze'} disabled={!!busy}>
                {t('pace.later')}
              </PrimaryButton>
            </div>
          </>
        )}
      >
        <div>
          <small className="block text-[14px] font-bold text-ink-400">{t.rich('pace.window', { ...RICH, kind: t(`kind.${ev.kind}`), count: ev.sessions.length })}</small>
          <h2 className="mt-0.5 text-[25px] font-black leading-tight text-ink-900">
            {t.rich(faster ? 'pace.headFaster' : 'pace.headSlower', { ...RICH, sec: Math.abs(ev.deltaSec) })}
          </h2>
        </div>

        {suggestion.kinds.length > 1 && (
          <Segmented
            label={t('pace.chartLabel', { count: ev.sessions.length })}
            value={kind}
            onChange={setKind}
            options={suggestion.kinds.map(k => ({ value: k.kind, label: t(`kind.${k.kind}`) }))}
          />
        )}

        <div className={cn(CARD, 'px-4 pb-3 pt-4')}>
          <EvidenceChart ev={ev} label={t('pace.chartLabel', { count: ev.sessions.length })} planLabel={t('pace.planLine', { pace: '' })} />
          <p className="mt-3 text-[15px] leading-snug text-ink-700">
            {t('pace.higherFaster')}{' '}
            {ev.hr === 'missing' ? t('pace.hrMissing') : faster ? t('pace.hrFlatFaster') : t('pace.hrFlatSlower')}
          </p>
        </div>

        <div className={cn(CARD, 'overflow-hidden')}>
          <div className="grid grid-cols-[1fr_84px_84px] items-center bg-[#F7F7FA] px-4 py-2 text-[13px] font-bold text-ink-400">
            <span />
            <span className="text-center">{t('pace.today')}</span>
            <span className="text-center">{t('pace.proposed')}</span>
          </div>
          {rows.map(r => (
            <div key={r.kind} className="grid min-h-[48px] grid-cols-[1fr_84px_84px] items-center border-t border-[#EFEFF4] px-4">
              <b className="text-[16px] font-extrabold text-ink-900">{t(`kind.${r.kind}`)}</b>
              <bdi dir="ltr" className="text-center text-[16px] font-black text-ink-900">{r.today !== null ? clockText(r.today) : '—'}</bdi>
              <bdi dir="ltr" className="text-center text-[16px] font-black" style={{ color: r.changed ? (faster ? GREEN : AMBER) : '#1F2030' }}>
                {r.proposed !== null ? clockText(r.proposed) : '—'}
              </bdi>
            </div>
          ))}
        </div>

        <p className="px-1 text-[14.5px] leading-snug text-ink-500">
          {changedList && t('pace.changes', { list: changedList })}{' '}
          {!moved.has('easy') && t('pace.easyStays')}{' '}
          {t('pace.when')}
        </p>

        {result && <ResultCard result={result} />}
        {failed && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{t('error')}</p>}
      </FlowScreen>
    </FlowOverlay>
  );
}

function ResultCard({ result }: { result: PaceUpdateResponse }) {
  const t = useTranslations('academyTools.pace');
  if (!result.ok) return <p className={cn(CARD, 'px-4 py-3 text-[15px] text-ink-700')} role="status">{t('gone')}</p>;
  if (result.action === 'snooze') return <p className={cn(CARD, 'px-4 py-3 text-[15px] text-ink-700')} role="status">{t('snoozed')}</p>;
  return (
    <div className={cn(CARD, 'px-4 py-3')} role="status">
      <b className="block text-[16px] font-extrabold text-[#0E7A3C]">✓ {t('done')}</b>
      <small className="mt-0.5 block text-[14px] text-ink-500">
        {t('doneWeeks', { count: result.weeks?.length ?? 0 })}{t('doneSent', { count: result.sent ?? 0 })}
      </small>
      {!result.stored && <small className="mt-1 block text-[13px] text-[#8A4308]">{t.rich('noRecord', RICH)}</small>}
    </div>
  );
}

/**
 * The sessions as bars, oldest on the left like every chart in the app (time runs left to
 * right even on an RTL page), height = speed, so the bars above the dashed plan line are the
 * faster runs. A bar is coloured when it moved beyond the 5 s/km floor in the suggestion's
 * direction, grey when it did not.
 */
function EvidenceChart({ ev, label, planLabel }: { ev: KindEvidence; label: string; planLabel: string }) {
  const plan = ev.currentSec;
  const paces = [...ev.sessions.map(s => s.actualSec), ...ev.sessions.map(s => s.plannedSec), plan];
  const lo = Math.min(...paces) - 4;
  const hi = Math.max(...paces) + 4;
  // Faster (fewer seconds) = taller. 40%..100% of the plot, so every bar has room for its label.
  const frac = (pace: number) => 0.4 + 0.6 * ((hi - pace) / Math.max(1, hi - lo));
  const H = 118;
  const faster = ev.direction === 'faster';
  const lineBottom = frac(plan) * H;
  return (
    <div role="img" aria-label={label} dir="ltr" className="relative">
      <div className="relative flex items-end gap-2.5" style={{ height: H + 22 }}>
        {ev.sessions.map(s => {
          const off = s.actualSec - s.plannedSec;
          const movedThis = faster ? off < -PACE_MEANINGFUL_SEC : off > PACE_MEANINGFUL_SEC;
          return (
            <div key={s.date} className="flex flex-1 flex-col items-center justify-end" style={{ height: H + 22 }}>
              <b className="mb-1 text-[14px] font-black leading-none text-ink-900">{clockText(s.actualSec)}</b>
              <i
                className="block w-full rounded-t-[10px] rounded-b-[4px]"
                style={{ height: frac(s.actualSec) * H, background: movedThis ? (faster ? GREEN : AMBER) : '#C9CAD3' }}
              />
            </div>
          );
        })}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-ink-400/70" style={{ bottom: lineBottom }} />
        <span
          aria-hidden
          dir="rtl"
          className="pointer-events-none absolute left-0 rounded-md bg-white/95 px-1.5 text-[12px] font-bold leading-5 text-ink-500"
          style={{ bottom: lineBottom + 2 }}
        >
          {planLabel.trim()} <bdi dir="ltr">{clockText(plan)}</bdi>
        </span>
      </div>
      <div className="mt-1.5 flex gap-2.5">
        {ev.sessions.map(s => (
          <small key={s.date} className="flex-1 text-center text-[12.5px] font-bold text-ink-400">{dayMonth(s.date)}</small>
        ))}
      </div>
    </div>
  );
}
