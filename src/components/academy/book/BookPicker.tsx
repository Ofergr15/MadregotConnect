'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Search } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { bookTotals, fromLibrarySteps, profileBar, structureName } from '@/lib/academy/book-steps';
import { filterLibrary, type LibraryEntry, type LibraryKind } from '@/lib/academy/library';
import { BarButton, CARD, FlowScreen, ProfileBar, RICH, SectionLabel, kmText } from './ui';

// ── 📖 מהספר (mockup phone 1ב) ────────────────────────────────────────────────────────────
//
// One search box, the kinds, ❤, and a plain list most-used first — each row with the
// session drawn small, because a coach recognises `6 × 800` by its shape faster than by
// its name. The old book screen (WorkoutBook.tsx) stays the place to manage the shelves;
// this one exists to pick from them in one tap.
//
// Search covers the name AND the structure as words (`6 × 800 מ׳`), which is what the
// mockup's placeholder promises (`"800", "גבעות", "ארוכה"`). Not the raw step values: those
// would make "2000" match the warmup of nearly every entry.

interface LibraryResponse {
  entries: LibraryEntry[];
  favourites?: string[];
  favouritesStored?: boolean;
  tableMissing?: boolean;
}

const LOCAL_FAVS = 'mc-book-favourites';

/** ❤ — stored on the server when migration 137 is in, on the device until then. */
export function useFavourites() {
  const { data, mutate } = useApi<LibraryResponse>('/api/academy/library');
  const [local, setLocal] = useState<string[]>([]);
  useEffect(() => {
    try { setLocal(JSON.parse(localStorage.getItem(LOCAL_FAVS) || '[]')); } catch { /* ignore */ }
  }, []);
  const stored = data?.favouritesStored === true;
  const favourites = useMemo(() => new Set(stored ? data?.favourites ?? [] : local), [stored, data, local]);

  const toggle = useCallback(async (id: string) => {
    const on = !favourites.has(id);
    if (!stored) {
      const next = on ? [...local, id] : local.filter(x => x !== id);
      setLocal(next);
      try { localStorage.setItem(LOCAL_FAVS, JSON.stringify(next)); } catch { /* ignore */ }
    }
    try {
      const res = await fetch('/api/academy/library', {
        method: 'PATCH',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id, action: 'favourite', on }),
      });
      if (res.ok) void mutate();
    } catch { /* the heart is a convenience */ }
  }, [favourites, stored, local, mutate]);

  return { favourites, toggle, data };
}

type Chip = LibraryKind | 'all' | 'fav';
const CHIPS: Chip[] = ['all', 'intervals', 'tempo', 'long', 'easy', 'hills', 'fav'];

export function BookPicker({ thresholdSec, onBack, onPick }: {
  thresholdSec: number | null;
  onBack: () => void;
  onPick: (entry: LibraryEntry) => void;
}) {
  const t = useTranslations('workoutBook');
  const { favourites, data } = useFavourites();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<Chip>('all');

  const rows = useMemo(() => {
    const entries = data?.entries ?? [];
    const sorted = filterLibrary(entries, { kind: chip !== 'all' && chip !== 'fav' ? chip : null });
    const needle = query.trim().toLowerCase();
    return sorted
      .filter(e => chip !== 'fav' || favourites.has(e.id))
      .map(e => {
        const model = fromLibrarySteps(e.steps);
        return { entry: e, model, shape: model ? structureName(model) : '' };
      })
      .filter(({ entry, shape }) => !needle
        || entry.name.toLowerCase().includes(needle)
        || shape.toLowerCase().includes(needle)
        || t(`kind.${entry.kind}`).includes(needle)
        || (entry.notes ?? '').toLowerCase().includes(needle));
  }, [data, chip, query, favourites, t]);

  return (
    <FlowScreen
      title={t('bookTitle')}
      leading={<BarButton onClick={onBack}><ChevronRight className="h-5 w-5" />{t('back.back')}</BarButton>}
    >
      <label className={cn(CARD, 'flex h-[53px] items-center gap-2.5 rounded-2xl px-4')}>
        <Search className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          // 16px+: iOS zooms the page into a smaller field on focus.
          className="min-w-0 flex-1 self-stretch bg-transparent text-[17px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </label>

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label={t('kindsLabel')}>
        {CHIPS.map(c => (
          <button
            key={c}
            type="button"
            aria-pressed={chip === c}
            onClick={() => setChip(chip === c && c !== 'all' ? 'all' : c)}
            className={cn(
              'h-11 rounded-full px-[15px] text-[15px] font-bold shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]',
              chip === c ? 'bg-ink-900 text-white' : 'bg-white text-ink-500',
            )}
          >
            {c === 'fav' ? <span aria-label={t('favourites')}>❤</span> : c === 'all' ? t('kind.all') : t(`chip.${c}`)}
          </button>
        ))}
      </div>

      {data?.tableMissing ? (
        <p className="py-6 text-center text-sm text-ink-400">{t('bookNotSetUp')}</p>
      ) : !data ? (
        <p className="py-6 text-center text-sm text-ink-400">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">{(data.entries ?? []).length ? t('noMatch') : t('bookEmpty')}</p>
      ) : (
        <>
          <SectionLabel>{t('mostUsed')}</SectionLabel>
          <div className={CARD}>
            {rows.map(({ entry, model }) => {
              const totals = model ? bookTotals(model, thresholdSec) : null;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onPick(entry)}
                  className="flex min-h-[64px] w-full items-center gap-3 border-b border-[#EFEFF4] px-[18px] py-[13px] text-start last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[17px] font-extrabold text-ink-900">
                      {favourites.has(entry.id) && <span aria-hidden className="me-1 text-[13px]">❤</span>}
                      <bdi>{entry.name}</bdi>
                    </b>
                    <small className="mt-0.5 block truncate text-[13.5px] text-ink-400">
                      {totals && <>{t.rich('kmOnly', { ...RICH, km: kmText(totals.distanceM) })} · {t.rich('minShort', { ...RICH, min: Math.round(totals.durationSec / 60) })}</>}
                      {entry.useCount > 0 && <> · {t.rich('uses', { ...RICH, count: entry.useCount })}</>}
                    </small>
                  </span>
                  {model && <ProfileBar segments={profileBar(model, thresholdSec)} size="sm" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </FlowScreen>
  );
}
