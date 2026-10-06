'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { coachCapacityOf } from '@/lib/academy/coach-board';
import { loadAfter, ONE_COACH_UNTIL_UPDATE, toggleCoach, type AssignMode } from '@/lib/academy/coach-picker';
import { initialsOf } from './types';

// "שיבוץ מאמנים" — THE coach picker. Every door that chooses a trainee's coaches
// draws this list: the member card, the quick action, a suggestion's ⋯, adding a
// club member straight in, the funnel's accept, and the many-trainees sheet. Tick
// one or more (all equal); each row carries the coach's load after the save, so a
// shared trainee visibly takes a place on each. A coach can be made right here
// ("+ מאמן נוסף מהמועדון"), which is what makes "several" possible in an academy
// that has one coach so far. Before migration 135 it is a single choice, and says
// so (lib/academy/coach-picker.ts).

export interface PickerCoach {
  coachId: string | null;
  coachName: string | null;
  /** Their trainees today; leave out when not known (the funnel's list). */
  trainees?: number;
}

function Checkbox({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center border-2 transition-colors',
        round ? 'rounded-full' : 'rounded-[7px]',
        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
      )}
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Face({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
      {initialsOf(name)}
    </span>
  );
}

export function CoachesPicker({
  coaches, value, onChange, sets = [], mode = 'replace', multi = true, exclude = [], showLoad = true,
  recommendedId = null, allowNewCoach = true, onCoachMade, none,
}: {
  coaches: PickerCoach[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** The current coaches of every trainee being assigned, for the load and "היום". */
  sets?: string[][];
  mode?: AssignMode;
  /** False before migration 135: one coach per trainee, and the notice says so. */
  multi?: boolean;
  /** People who cannot coach here — the trainees themselves. */
  exclude?: string[];
  showLoad?: boolean;
  recommendedId?: string | null;
  allowNewCoach?: boolean;
  /** A club member was just made an academy coach: refresh whatever lists coaches. */
  onCoachMade?: () => void | Promise<void>;
  /** Many trainees, "להעביר": the explicit "בלי מאמן" choice. */
  none?: { on: boolean; onPick: () => void };
}) {
  const { data: settingsData } = useApi<{ settings?: unknown }>('/api/academy/settings');
  const capacity = coachCapacityOf(settingsData?.settings);

  // Coaches made right here show at once, before the parent's payload catches up —
  // otherwise the one just added could not be ticked.
  const [madeHere, setMadeHere] = useState<PickerCoach[]>([]);
  const list = useMemo(() => {
    const listed = coaches.filter((c) => c.coachId && !exclude.includes(c.coachId));
    return [...listed, ...madeHere.filter((m) => !listed.some((c) => c.coachId === m.coachId))];
  }, [coaches, madeHere, exclude]);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [making, setMaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: pool } = useApi<{ candidates: Array<{ id: string; name: string }> }>(adding ? '/api/academy/coaches' : null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(list.map((c) => c.coachId));
    return (pool?.candidates ?? [])
      .filter((c) => !taken.has(c.id) && !exclude.includes(c.id) && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [pool, query, list, exclude]);

  const makeCoach = async (person: { id: string; name: string }) => {
    setMaking(person.id);
    setError(null);
    try {
      const res = await fetch('/api/academy/coaches', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: person.id, coach: true }),
      });
      if (!res.ok) throw new Error();
      setMadeHere((m) => [...m, { coachId: person.id, coachName: person.name, trainees: 0 }]);
      onChange(toggleCoach(value.filter((c) => c !== person.id), person.id, multi));
      setAdding(false);
      setQuery('');
      void onCoachMade?.();
    } catch {
      setError('לא הצלחתי להוסיף את המאמן');
    } finally {
      setMaking(null);
    }
  };

  const loads = list.map((c) => (showLoad && typeof c.trainees === 'number'
    ? loadAfter(c.coachId!, c.trainees, sets, value, mode)
    : null));
  const maxLoad = Math.max(capacity, ...loads.map((l) => l ?? 0));
  const isCurrent = (id: string) => sets.length > 0 && sets.every((s) => s.includes(id));

  return (
    <div>
      {!multi && (
        <p className="mb-2 rounded-xl bg-band-3/15 px-3 py-2 text-xs font-semibold leading-relaxed text-band-3-ink" role="note">
          {ONE_COACH_UNTIL_UPDATE}
        </p>
      )}
      <div className="overflow-hidden rounded-card bg-card divide-y divide-page" role="group" aria-label="מאמנים">
        {list.length === 0 && (
          <p className="px-4 py-4 text-sm text-ink-500">אין עדיין מאמנים באקדמיה. מוסיפים כאן למטה.</p>
        )}
        {list.map((c, i) => {
          const on = value.includes(c.coachId!);
          const load = loads[i];
          const free = load === null ? null : Math.max(0, capacity - load);
          return (
            <button
              key={c.coachId}
              type="button"
              onClick={() => onChange(toggleCoach(value, c.coachId!, multi))}
              aria-pressed={on}
              className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60"
            >
              <Checkbox on={on} round={!multi} />
              <Face name={c.coachName || ''} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{c.coachName}</span>
                <span className="block text-xs text-ink-400">
                  {load !== null && <><bdi dir="ltr">{load}</bdi> מתוך <bdi dir="ltr">{capacity}</bdi>{load === 0 ? ' · פנוי' : free === 0 ? ' · מלא' : ''}</>}
                  {isCurrent(c.coachId!) && <>{load !== null ? ' · ' : ''}המאמן היום</>}
                </span>
              </span>
              {c.coachId === recommendedId && !on ? (
                <span className="shrink-0 rounded-[7px] bg-accent-600/15 px-1.5 py-0.5 text-2xs font-black text-accent-900">פנוי · מומלץ</span>
              ) : load !== null ? (
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-page" aria-hidden>
                  <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (load / maxLoad) * 100)}%` }} />
                </span>
              ) : null}
            </button>
          );
        })}
        {none && (
          <button
            type="button"
            onClick={none.onPick}
            aria-pressed={none.on}
            className="flex w-full min-h-[56px] items-center gap-3 px-4 text-start active:bg-page/60"
          >
            <Checkbox on={none.on} round />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink-700">בלי מאמן</span>
              <span className="block text-xs text-ink-400">יופיע ב״בלי מאמן״</span>
            </span>
          </button>
        )}
      </div>

      {allowNewCoach && multi && list.length === 1 && !adding && (
        <p className="mt-2 px-1 text-xs text-ink-400">יש באקדמיה מאמן אחד. כדי לבחור כמה, מוסיפים מאמן:</p>
      )}
      {allowNewCoach && (!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 flex w-full min-h-[48px] items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink-300 text-sm font-extrabold text-brand-600"
        >
          + מאמן נוסף מהמועדון
        </button>
      ) : (
        <div className="mt-2 rounded-card bg-card p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש חבר מועדון"
            aria-label="חיפוש חבר מועדון"
            className="w-full min-h-[44px] rounded-xl bg-page px-3 text-base text-ink-700 outline-none placeholder:text-ink-400"
            dir="auto"
          />
          <div className="mt-1 divide-y divide-page">
            {!pool && <p className="px-2 py-3 text-sm text-ink-400">טוען…</p>}
            {pool && matches.length === 0 && <p className="px-2 py-3 text-sm text-ink-400">לא נמצא</p>}
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void makeCoach(c)}
                disabled={!!making}
                className="flex w-full min-h-[48px] items-center gap-3 px-2 text-start disabled:opacity-50"
              >
                <Face name={c.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-700" dir="auto">{c.name}</span>
                <span className="shrink-0 text-xs font-extrabold text-brand-600">{making === c.id ? '…' : 'להוסיף כמאמן'}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setAdding(false); setQuery(''); }} className="mt-1 min-h-[44px] w-full text-sm font-bold text-ink-500">ביטול</button>
        </div>
      ))}
      {error && <p className="mt-2 px-1 text-sm text-accent-red-ink">{error}</p>}
    </div>
  );
}
