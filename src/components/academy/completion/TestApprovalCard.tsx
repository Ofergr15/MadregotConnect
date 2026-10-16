'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AcademyHomeResponse, ApprovalDetail } from '@/lib/academy/home';
import { useViewAsReadOnly } from '@/lib/view-as-person';
import { clock } from '@/components/trainee/ui';
import { initials } from '../book/ui';
import { Avatar, shortDay, sendJson } from './shared';

// ── המאמן מאשר (mockup academy-existing-trainees, phone 5) ──────────────────────────────
//
// In "מחכה לך": what the trainee sent, where it came from (the watch or typed), and a check
// against their band. "לאשר" makes it count (PATCH /api/academy/tests, which reprices their
// loads); "לתקן" opens the one-trainee form on the submission, and the coach's save replaces it.

export type Approval = AcademyHomeResponse['approvals'][number] & ApprovalDetail;

export const hasDetail = (a: AcademyHomeResponse['approvals'][number]): a is Approval =>
  !!a.testId && a.durationSec != null && a.distanceM != null && !!a.bandCheck;

export function TestApprovalCard({ approval, onDecided, onCorrect }: {
  approval: Approval;
  onDecided: () => void;
  onCorrect: (approval: Approval) => void;
}) {
  const t = useTranslations('completion.approve');
  const readOnly = useViewAsReadOnly();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const first = approval.name.split(' ')[0] || approval.name;
  // Their "פנייה" from the card (AddressingField); unknown keeps "שלח".
  const gender = approval.gender === 'female' || approval.gender === 'male' ? approval.gender : 'other';
  const m = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  const check = approval.bandCheck;

  const approve = async () => {
    setBusy(true); setFailed(false);
    try {
      await sendJson('PATCH', '/api/academy/tests', { testId: approval.testId, action: 'approve' });
      onDecided();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const protocol = approval.protocol === '2000m' ? t('p2000') : t('p30');
  return (
    <section data-athlete={approval.athleteId} className="rounded-[22px] bg-white p-4 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]" aria-label={t('sent', { name: first, gender })}>
      <div className="flex items-center gap-3">
        <Avatar text={initials(approval.name)} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[17px] font-black text-ink-900">{t.rich('sentRich', { name: first, gender, bdi: (c) => <bdi>{c}</bdi> })}</b>
          <small className="mt-0.5 block truncate text-[13.5px] font-bold text-ink-400">
            {protocol} · <bdi dir="ltr">{shortDay(approval.date)}</bdi> · {approval.source === 'watch' ? t('fromWatch') : t('typed')}
          </small>
        </span>
        <b className={cn('shrink-0 text-[30px] font-black leading-none tabular-nums', approval.implausible ? 'text-[#A8510A]' : 'text-ink-900')}>
          <bdi dir="ltr">{approval.paceSec ? clock(approval.paceSec) : '—'}</bdi>
        </b>
      </div>

      <dl className="mt-3 overflow-hidden rounded-2xl bg-[#F6F6F9]">
        <Row label={approval.protocol === '2000m' ? t('time') : t('distance')}>
          {approval.protocol === '2000m'
            ? m(clock(approval.durationSec))
            // LTR as a whole, like the form and the watch sheet: "7.12 ק״מ", number then unit.
            : <bdi dir="ltr">{t.rich('km', { km: (approval.distanceM / 1000).toFixed(2), m })}</bdi>}
        </Row>
        <Row label={t('hr')}>{approval.avgHr ? m(approval.avgHr) : <span className="text-ink-300">{t('noHr')}</span>}</Row>
        <Row label={t('vsBand')}>
          {check.kind === 'noBand' ? <span className="text-[#A8510A]">{t('check.noBand')}</span>
            : t.rich(`check.${check.kind}`, {
              band: 'bandNumber' in check ? check.bandNumber : 0,
              other: check.kind === 'nearer' ? check.nearerNumber : 0,
              m,
            })}
        </Row>
      </dl>
      {approval.implausible && <p className="mt-2 text-[13px] font-bold leading-snug text-[#A8510A]">{t('implausible')}</p>}

      <div className="mt-3 flex gap-2.5">
        <button type="button" onClick={() => void approve()} disabled={busy || readOnly}
          className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-brand-600 text-[17px] font-extrabold text-white disabled:opacity-50">
          {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : t('approve')}
        </button>
        <button type="button" onClick={() => onCorrect(approval)} disabled={busy || readOnly}
          className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-white text-[17px] font-extrabold text-brand-600 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)] disabled:opacity-50">
          {t('correct')}
        </button>
      </div>
      {failed && <p className="mt-2 text-[13px] font-bold text-accent-red-ink" role="alert">{t('error')}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-3 border-b border-[#EBEBF0] px-3.5 last:border-0">
      <dt className="text-[15.5px] font-bold text-ink-700">{label}</dt>
      <dd className="text-[16px] font-black text-ink-900">{children}</dd>
    </div>
  );
}

/** "אחרי האישור": what approving does, under the cards (phone 5's green note). */
export function AfterApprovalNote({ name }: { name: string | null }) {
  const t = useTranslations('completion.approve');
  return (
    <div className="rounded-[22px] bg-[#E5F6EC] px-4 py-3.5 text-[#0E7A3C]">
      <b className="block text-[17px] font-black">{t('afterTitle')}</b>
      <p className="mt-1 text-[14.5px] font-bold leading-snug">
        {name ? t.rich('after', { name, bdi: (c) => <bdi>{c}</bdi> }) : t('afterMany')}
      </p>
    </div>
  );
}
