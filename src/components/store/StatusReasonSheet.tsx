'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { REASON_MAX, REASON_OTHER, REASON_PRESETS, composeReason } from '@/lib/store/order-history';

// The reason for an exceptional order move (decision 28.11), in an in-app bottom sheet
// instead of window.prompt — which in the installed iPhone app looks like the browser
// breaking through, and sometimes doesn't open at all. Same shape as the app's other
// confirm sheets: the question, preset chips, one primary button, a plain cancel.
// The button stays disabled until there is a reason ('אחר' needs its text).
export function StatusReasonSheet({ open, title, onCancel, onSubmit }: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [chip, setChip] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { if (open) { setChip(null); setText(''); } }, [open]);
  const reason = composeReason(chip, text);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onCancel(); }} title={title}>
      <div dir="rtl" className="space-y-3 pb-2">
        <p className="text-sm text-center px-2 text-ink-400">שינוי שלא לפי הסדר — מה הסיבה?</p>
        <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="סיבה">
          {REASON_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={chip === p}
              onClick={() => setChip(p)}
              className={cn(
                'min-h-[40px] rounded-pill px-4 text-[14px] font-bold transition-colors',
                chip === p ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
              )}
            >
              {p}
            </button>
          ))}
        </div>
        {chip === REASON_OTHER && (
          <input
            autoFocus
            dir="auto"
            value={text}
            maxLength={REASON_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="כתבו את הסיבה"
            className="w-full rounded-xl border border-page bg-page/60 px-3 py-2.5 text-sm text-ink-700 focus:outline-none focus:border-brand-600"
          />
        )}
        <button
          type="button"
          disabled={!reason}
          onClick={() => { if (reason) onSubmit(reason); }}
          className="w-full min-h-[48px] rounded-pill bg-brand-600 font-bold text-base text-white transition-colors hover:bg-brand-700 active:scale-[0.98] disabled:opacity-40"
        >
          לשנות סטטוס
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full min-h-[48px] rounded-pill bg-page text-ink-700 font-semibold text-base transition-colors hover:bg-page/70 active:scale-[0.98]"
        >
          ביטול
        </button>
      </div>
    </Sheet>
  );
}
