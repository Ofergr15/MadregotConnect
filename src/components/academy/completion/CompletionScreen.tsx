'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Chip } from '@/lib/academy/completion';
import type { CompletionPayload, CompletionPerson } from '@/lib/academy/completion-server';
import { useViewAsReadOnly } from '@/lib/view-as-person';
import { Chevron } from '@/components/trainee/ui';
import { BarButton, CARD, FlowOverlay, FlowScreen, initials } from '../book/ui';
import { Avatar, ChipPill, sendJson } from './shared';
import { TraineeDetailsForm, type PickBand, type PickCoach } from './TraineeDetailsForm';
import { AfterApprovalNote, TestApprovalCard, type Approval } from './TestApprovalCard';
import { Sheet } from '@/components/ui';

// ── השלמת פרטים (mockup academy-existing-trainees, phone 1) ─────────────────────────────
//
// Who is missing what (test, band, coach, goal, an old test), how many are ready, and one
// button that asks everyone without a test to send it themselves. A row opens the
// one-trainee form (phone 2); a row whose only gap is a test waiting for approval opens
// that same form on the submission, where saving is the approval.

export type CompletionResponse = CompletionPayload & { scope: 'academy' | 'coach'; canAssign: boolean };

export function useCompletion(scopeQ: string, enabled = true) {
  return useApi<CompletionResponse>(enabled ? `/api/academy/completion${scopeQ ? `?${scopeQ}` : ''}` : null);
}

export function CompletionScreen({ scopeQ, bands, coaches, approvals, onClose, onChanged }: {
  scopeQ: string;
  bands: PickBand[];
  coaches: PickCoach[];
  onClose: () => void;
  /** Something was saved: the shell refreshes its own payloads. */
  onChanged: () => void;
  /** The home's approval queue (phone 5's cards): "לאשר ›" on a waiting row opens its card. */
  approvals?: Approval[];
}) {
  const t = useTranslations('completion.list');
  const readOnly = useViewAsReadOnly();
  const { data, error, mutate } = useCompletion(scopeQ);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<{ person: CompletionPerson; correcting?: boolean } | null>(null);
  const [approving, setApproving] = useState<Approval | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ asked: number; already: number } | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  const rows = data?.rows ?? [];
  const shown = all ? rows : rows.filter(r => !r.ready);
  const s = data?.summary;
  const m = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;

  const askAll = async () => {
    setSending(true); setSendFailed(false);
    try {
      const r = await sendJson<{ asked: number; already: number }>('POST', `/api/academy/completion/request${scopeQ ? `?${scopeQ}` : ''}`, {});
      setSent(r);
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <FlowOverlay label={t('title')}>
      <FlowScreen
        title={t('title')}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
      >
        {!data && !error && <div className="h-[120px] animate-pulse rounded-[22px] bg-white/70" aria-busy="true" />}
        {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{t('error')}</p>}

        {s && (
          <section className={cn(CARD, 'px-4 py-3.5')}>
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-[19px] font-black text-ink-900">{t.rich('ready', { ready: s.ready, total: s.total, m })}</b>
              {s.missing > 0 && <span className="text-[14px] font-extrabold text-ink-400">{t.rich('missingCount', { n: s.missing, m })}</span>}
            </div>
            {/* RTL like the page: the fill starts at the right (start) edge, as the mockup draws it. */}
            <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-[#EFEFF4]" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.ready}>
              <i className="block h-full rounded-full bg-[#1FA55B]" style={{ width: `${s.total ? (s.ready / s.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-[14px] font-semibold leading-snug text-ink-500">{t('readyMeans')}</p>
          </section>
        )}

        {/* Right under the summary, on the first screen however long the list runs (the mockup's
            five rows put it there; a real academy's 28 pushed it several screens down). */}
        {s && s.needTest > 0 && (
          <section className={cn(CARD, 'flex min-h-[64px] items-center gap-2.5 px-3.5 py-2.5')}>
            <span aria-hidden className="text-[20px]">📨</span>
            <span className="min-w-0 flex-1">
              <b className="block text-[16px] font-extrabold text-ink-900">{t('askTitle')}</b>
              <small className="mt-0.5 block text-[12.5px] leading-snug text-ink-400">
                {sent
                  ? t.rich(sent.asked ? 'askSent' : 'askNone', { n: sent.asked, already: sent.already, m })
                  : t('askSub')}
              </small>
            </span>
            {!sent && (
              <button type="button" onClick={() => void askAll()} disabled={sending || readOnly}
                className="min-h-[44px] min-w-[52px] shrink-0 px-1 text-[16px] font-extrabold text-brand-600 disabled:opacity-50">
                {sending ? '…' : t('askSend')}
              </button>
            )}
          </section>
        )}
        {sendFailed && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{t('askFailed')}</p>}
        {data && rows.length > 0 && (
          <>
            <div className="-mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-extrabold text-ink-400">
                {all ? t.rich('allHead', { n: rows.length, m }) : t.rich('missingHead', { n: shown.length, m })}
              </h2>
              <button type="button" onClick={() => setAll(v => !v)} className="-my-3 min-h-[44px] min-w-[44px] px-1 text-[14px] font-extrabold text-brand-600">
                {all ? t('onlyMissing') : t('all')}
              </button>
            </div>
            {shown.length > 0 ? (
              <div className={cn(CARD, 'overflow-hidden')}>
                {shown.map(r => (
                  <button key={r.athleteId} type="button"
                    onClick={() => {
                      const card = r.action === 'approve' ? approvals?.find(a => a.athleteId === r.athleteId) : null;
                      if (card) setApproving(card);
                      // A submission waiting (any protocol): the form opens on it, and the save replaces it.
                      else setOpen({ person: r, correcting: !!r.pendingTest });
                    }}
                    className="flex min-h-[64px] w-full items-center gap-2.5 border-b border-[#EFEFF4] px-3.5 py-2.5 text-start last:border-0 active:bg-page/40">
                    <Avatar text={initials(r.name)} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-extrabold text-ink-900"><bdi>{r.name}</bdi></b>
                      {/* One chip line, the mockup's even rhythm: the line is one chip high, so a chip
                          that would wrap drops out whole (completionRow already leaves room). */}
                      <span className="mt-0.5 flex h-5 flex-wrap gap-x-1 gap-y-2 overflow-hidden [&>*]:leading-4">
                        {r.chips.length ? r.chips.map((c, i) => <RowChip key={i} chip={c} />) : <ChipPill tone="have">{t('readyChip')}</ChipPill>}
                      </span>
                    </span>
                    <span className="shrink-0 text-[14px] font-extrabold text-brand-600">
                      {r.action === 'approve' ? t('approve') : r.ready ? t('edit') : t('complete')} <Chevron className="h-[11px] w-[7px]" />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={cn(CARD, 'px-4 py-4 text-[15px] font-bold text-[#0E7A3C]')}>✓ {t('allReady')}</p>
            )}
          </>
        )}
        {data && rows.length === 0 && <p className={cn(CARD, 'px-4 py-4 text-[15px] text-ink-500')}>{t('empty')}</p>}
      </FlowScreen>

      <Sheet open={!!approving} onOpenChange={(o) => { if (!o) setApproving(null); }} title={t('approveTitle')}>
        {approving && (
          <div className="space-y-3 pb-2" dir="rtl">
            <TestApprovalCard
              approval={approving}
              onDecided={() => { setApproving(null); void mutate(); onChanged(); }}
              onCorrect={(a) => {
                const person = rows.find(r => r.athleteId === a.athleteId);
                setApproving(null);
                if (person) setOpen({ person, correcting: true });
              }}
            />
            <AfterApprovalNote name={approving.name.split(' ')[0] || null} />
          </div>
        )}
      </Sheet>

      {open && data && (
        <TraineeDetailsForm
          person={open.person}
          correcting={open.correcting}
          bands={bands}
          coaches={coaches}
          canAssign={data.canAssign}
          goalsStored={data.goalsStored}
          onClose={() => setOpen(null)}
          onSaved={() => { void mutate(); onChanged(); }}
        />
      )}
    </FlowOverlay>
  );
}

function RowChip({ chip }: { chip: Chip }) {
  const t = useTranslations('completion.chip');
  const tm = useTranslations('completion');
  if (chip.key === 'test') {
    if (chip.gap === 'pending') return <ChipPill tone="pending">{t('pending')}</ChipPill>;
    if (chip.gap === 'old' && chip.date) {
      return <ChipPill tone="missing">{t('old', { month: tm(`months.${Number(chip.date.slice(5, 7))}`) })}</ChipPill>;
    }
    if (chip.gap === 'otherProtocol') return <ChipPill tone="missing">{t('only2000')}</ChipPill>;
    return <ChipPill tone="missing">{t('test')}</ChipPill>;
  }
  if (chip.key === 'band') {
    return chip.tone === 'have'
      ? <ChipPill tone="have">{t.rich('bandN', { n: chip.bandNumber ?? 0, m: (c) => <bdi dir="ltr">{c}</bdi> })}</ChipPill>
      : <ChipPill tone="missing">{t('band')}</ChipPill>;
  }
  if (chip.key === 'coach') return <ChipPill tone={chip.tone === 'have' ? 'have' : 'missing'}>{t('coach')}</ChipPill>;
  return <ChipPill tone="missing">{t('goal')}</ChipPill>;
}
