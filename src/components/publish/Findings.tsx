'use client';

import { AlertTriangle, Check, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AuditFinding } from '@/lib/plans/workout-audit';

/**
 * What the screen found in this session, in words the coach can act on — and
 * nothing that stops them publishing anyway. The audit is a second pair of eyes,
 * not a gate: the coach knows things about the week that the PDF never said.
 *
 * The five structural detectors (`startsWithRest`, `sameIntervalPace`,
 * `collapsedTimeRange`, `pacedTest`, `sessionInNotes`) all land here, and each
 * one carries the `step.order`s it is about — which is what lets the table above
 * stripe the rows the sentence is talking about.
 *
 * `timeRangeFixed` is the one finding that reports something the import CHANGED
 * rather than something it noticed, so it gets the opposite button: undo, not fix.
 * A silent correction and a correction with a way back are different things to do
 * to somebody's plan.
 */
export function Findings({
  findings, onFix, onUndoAutoFix, title,
}: {
  findings: AuditFinding[];
  onFix: () => void;
  /** Absent where the screen has no way to write the session back. */
  onUndoAutoFix?: () => void;
  /** Overridden by the day flow, which says which DAY was checked. */
  title?: string;
}) {
  const t = useTranslations('publishReview');

  return (
    <div className="mt-3 rounded-card bg-card px-4 py-3">
      <h4 className="mb-2 text-3xs font-bold uppercase tracking-[0.1em] text-ink-400">
        {title || t('auditTitle')}
      </h4>
      {findings.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-xs text-ink-500">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-500">
            <Check className="h-3.5 w-3.5 text-white" />
          </span>
          {t('auditOk')}
        </p>
      ) : (
        findings.map((finding) => (
          <div
            key={finding.code}
            className="flex items-start gap-2.5 py-1.5 text-xs [&+&]:border-t [&+&]:border-page/70"
          >
            <span
              className={cn(
                'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                finding.level === 'warn' ? 'bg-accent-red' : 'bg-ink-300',
              )}
            >
              {finding.level === 'warn'
                ? <AlertTriangle className="h-3 w-3 text-white" />
                : <Info className="h-3.5 w-3.5 text-white" />}
            </span>
            <span className="min-w-0 flex-1 text-ink-700">
              <b className="font-bold text-ink-900">
                {t(`audit_${finding.code}_title` as 'audit_noDistance_title', { count: finding.count })}
              </b>
              <i className="mt-0.5 block text-2xs not-italic text-ink-400">
                {t(`audit_${finding.code}_detail` as 'audit_noDistance_detail', { count: finding.count })}
              </i>
            </span>
            {finding.code === 'timeRangeFixed' ? (
              onUndoAutoFix && (
                <button
                  type="button"
                  onClick={onUndoAutoFix}
                  className="shrink-0 text-2xs font-bold text-brand-600"
                >
                  {t('undoAutoFix')}
                </button>
              )
            ) : finding.level === 'warn' && (
              <button
                type="button"
                onClick={onFix}
                className="shrink-0 text-2xs font-bold text-brand-600"
              >
                {t('fix')}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
