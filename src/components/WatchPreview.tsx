'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Pencil, AlertTriangle, Watch } from 'lucide-react';
import type { ParsedWorkout } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { previewSessions, previewItems, previewHints, isRepeatItem, type PreviewLine } from '@/lib/plans/watch-preview';

// The send sheet's "מה יגיע לשעון": every session about to go out, drawn as the watch
// will show it (lib/plans/watch-preview.ts builds it from the send path's own pieces).

const BAR: Record<string, string> = {
  warmup: '#2BA8B5', active: '#1525FF', interval: '#E5484D', rest: '#B5B5BD', recovery: '#7FB89A', cooldown: '#6E7BFF',
};
const TYPE_KEY: Record<string, string> = {
  warmup: 'stepWarmup', active: 'stepActive', interval: 'stepInterval', rest: 'stepRest', recovery: 'stepRecovery', cooldown: 'stepCooldown',
};

function Line({ l, t }: { l: PreviewLine; t: (k: string) => string }) {
  const hasPace = !!l.text && /\d:\d{2}/.test(l.text);
  return (
    <div className="flex gap-2 items-start py-1.5 px-1 border-b border-white/10 last:border-0">
      <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: BAR[l.type] || BAR.active }} />
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 items-baseline">
          <span className="text-[11px] font-bold text-white/75">{t(TYPE_KEY[l.type] || 'stepActive')}</span>
          <span className="text-base font-extrabold tabular-nums text-white">{l.duration ?? t('lap')}</span>
        </div>
        {l.text && (
          // <bdi>, not dir="auto" on the block: a pace line is LTR text, and an LTR block
          // in this RTL sheet sat flush left, away from its own step.
          <div className={cn('text-[13px]', hasPace ? 'text-[#cfd3ff] tabular-nums' : 'text-white/85')}><bdi>{l.text}</bdi></div>
        )}
      </div>
    </div>
  );
}

export function WatchPreview({ sessions, grouped, dayLabel, onEdit }: {
  sessions: ParsedWorkout[];
  /** The plan's three pack copies, as the send will read them. */
  grouped: unknown;
  dayLabel: (w: ParsedWorkout) => string;
  onEdit?: (w: ParsedWorkout) => void;
}) {
  const t = useTranslations('workoutEditor');
  const shown = useMemo(() => previewSessions(sessions, grouped), [sessions, grouped]);
  // Open by default for a day or two — the "check it a second before sending" case;
  // a whole week starts closed so the sheet stays usable.
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const isOpen = (i: number) => open[i] ?? shown.length <= 2;
  if (shown.length === 0) return null;

  return (
    <div className="mt-4 pb-4 border-b border-page">
      <p className="flex items-center gap-1.5 text-13 font-extrabold text-ink-900"><Watch className="h-4 w-4" /> {t('watchPreviewTitle')}</p>
      <p className="text-2xs text-ink-400 mb-2">{t('watchPreviewSub')}</p>
      {shown.map((w, i) => {
        const hints = previewHints(w);
        return (
          <div key={`${w.dayOfWeek}-${w.partIndex ?? 1}-${i}`} className="rounded-[18px] bg-page/60 mb-2 overflow-hidden">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen(i) }))}
              className="w-full flex items-center gap-2 px-3 min-h-[44px] text-start">
              <span className="text-sm font-extrabold text-ink-900">{dayLabel(w)}</span>
              {hints.length > 0 && <AlertTriangle className="h-4 w-4 text-band-3-ink" aria-label={t('watchPreviewHasHint')} />}
              <ChevronLeft className={cn('h-4 w-4 text-ink-400 ms-auto transition-transform', isOpen(i) && '-rotate-90')} />
            </button>
            {isOpen(i) && (
              <>
                {hints.map((h, j) => (
                  <div key={j} className="mx-2.5 mb-2 flex gap-1.5 items-start rounded-xl bg-band-3/15 px-2.5 py-2 text-xs text-band-3-ink">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{t('watchPreviewRestHint', { duration: `${Math.floor(h.seconds / 60)}:${(h.seconds % 60).toString().padStart(2, '0')}`, n: h.repeat })}</span>
                  </div>
                ))}
                <div className="mx-2.5 mb-2 rounded-2xl bg-[#0d0e12] px-2.5 py-1.5">
                  {previewItems(w).map((it, k) =>
                    isRepeatItem(it) ? (
                      <div key={k} className="my-1.5 rounded-xl border-[1.5px] border-white/20 px-1.5 pb-0.5">
                        <div className="flex items-center gap-1.5 pt-1.5 px-0.5 text-xs font-extrabold text-white">
                          <span className="rounded-md bg-white text-[#0d0e12] px-1.5 tabular-nums">×{it.repeat}</span>{t('repeat')}
                        </div>
                        {it.lines.map((l, m) => <Line key={m} l={l} t={t} />)}
                      </div>
                    ) : (
                      <Line key={k} l={it} t={t} />
                    ),
                  )}
                </div>
                {onEdit && (
                  <button type="button" onClick={() => onEdit(sessions[i])}
                    className="inline-flex items-center gap-1 px-3 pb-2.5 min-h-[36px] text-xs font-bold text-brand-600">
                    <Pencil className="h-3.5 w-3.5" /> {t('watchPreviewEdit')}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
