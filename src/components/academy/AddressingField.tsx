'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ADDRESSING_OPTIONS, addressingOf, type Addressing } from '@/lib/academy/addressing';
import { useViewAsReadOnly } from '@/lib/view-as-person';
import { sendJson } from './completion/shared';

/**
 * "פנייה" on a trainee's card (MemberSheet) and on a funnel candidate's (CandidateSheet).
 *
 * The registration form does not ask (launch T5, Ofer: the manager and the coach know it from
 * the intro call), so this is where it is set. Three tiles, not two: "לא ידוע" is a real answer
 * — the default wording — and has to be reachable again after a mis-tap.
 *
 * Saves on tap, the way the profile's own gender row does; a failed save puts the old answer
 * back and says so.
 */
export function AddressingField({ athleteId, value, onSaved, className }: {
  athleteId: string;
  value: string | null | undefined;
  onSaved?: (gender: Addressing | null) => void;
  className?: string;
}) {
  const readOnly = useViewAsReadOnly();
  const [current, setCurrent] = useState<Addressing | null>(addressingOf(value));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setCurrent(addressingOf(value)); setFailed(false); }, [athleteId, value]);

  const pick = async (next: Addressing | null) => {
    if (readOnly || saving || next === current) return;
    const before = current;
    setCurrent(next); setSaving(true); setFailed(false);
    try {
      await sendJson('PUT', '/api/academy/addressing', { athleteId, gender: next });
      onSaved?.(next);
    } catch {
      setCurrent(before); setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    // dir="rtl" of its own: MemberSheet is dir="auto", and a Latin roster name first makes
    // that LTR, which reversed the tiles and broke the caption around its quote.
    <div dir="rtl" className={cn('mb-5', className)}>
      <p id={`addr-${athleteId}`} className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">פנייה</p>
      <div className="rounded-card bg-card px-3 py-3">
        <div role="radiogroup" aria-labelledby={`addr-${athleteId}`} className="grid grid-cols-3 gap-2">
          {ADDRESSING_OPTIONS.map(o => {
            const on = current === o.value;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={readOnly || saving}
                onClick={() => pick(o.value)}
                className={cn(
                  'min-h-[44px] rounded-[12px] text-[14px] font-extrabold transition-colors disabled:cursor-default',
                  on ? 'bg-[#EEF0FF] text-brand-600 outline outline-2 outline-brand-600' : 'bg-[#F2F2F6] text-ink-500',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className={cn('mt-2 px-1 text-[12.5px] leading-snug', failed ? 'font-bold text-accent-red-ink' : 'text-ink-400')}>
          {failed
            ? 'לא נשמר. אפשר לנסות שוב.'
            : current === 'female'
              ? <>כך האפליקציה והמאמנים פונים אליה, למשל: &quot;<b className="text-ink-700">שלחה טסט</b>&quot;.</>
              : current === 'male'
                ? <>כך האפליקציה והמאמנים פונים אליו, למשל: &quot;<b className="text-ink-700">שלח טסט</b>&quot;.</>
                : 'לא ידוע: הטקסטים נשארים בניסוח הרגיל.'}
        </p>
      </div>
    </div>
  );
}
