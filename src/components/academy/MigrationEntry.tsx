'use client';

import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';

/**
 * The door into "מעבר האקדמיה" from People → trainees, for the manager. Drawn only while the
 * move is under way: once everybody moved in has a first week, the row goes away.
 */
export function MigrationEntry({ onOpen }: { onOpen: () => void }) {
  const { data } = useApi<{ rows: unknown[]; summary: { done: number; onTheWay: number; stuck: number } }>('/api/academy/migration');
  const s = data?.summary;
  if (!s || !data?.rows.length || s.onTheWay + s.stuck === 0) return null;
  return (
    <button type="button" onClick={onOpen}
      className="mb-2.5 flex min-h-[56px] w-full items-center gap-3 rounded-card bg-card px-3.5 py-2 text-start active:bg-page/40">
      <span aria-hidden className={s.stuck ? 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-band-3/10 text-[18px]' : 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-band-2/15 text-[18px]'}>🎓</span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-extrabold text-ink-700">מעבר האקדמיה</b>
        <small className="block text-2xs text-ink-400">
          <bdi dir="ltr">{s.done}</bdi> עם שבוע ראשון · <bdi dir="ltr">{s.onTheWay}</bdi> בדרך{s.stuck ? <> · <bdi dir="ltr">{s.stuck}</bdi> תקועים</> : null}
        </small>
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
    </button>
  );
}
