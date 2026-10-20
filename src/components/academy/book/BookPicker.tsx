'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NumberRuns } from '@/components/trainee/ui';
import { useTranslations } from 'next-intl';
import { ChevronRight, Search } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { bookTotals, fromLibrarySteps, profileBar, structureName } from '@/lib/academy/book-steps';
import { filterLibrary, isUnclassified, type LibraryEntry, type LibraryKind } from '@/lib/academy/library';
import { BarButton, CARD, FlowScreen, ProfileBar, RICH, SectionLabel, kmText } from './ui';
import { textMatches } from '@/lib/search/match';

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
const RECENT_COUNT = 3;
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
        // "10x400" finds "10 × 400" and back (lib/search/match textMatches).
        || textMatches(needle, entry.name, shape, entry.notes)
        // A guessed type is not searchable as a type — the name and the shape still are.
        || (!isUnclassified(entry) && t(`kind.${entry.kind}`).includes(needle)));
  }, [data, chip, query, favourites, t]);

  // "אחרונים" (Ofer, 2026-10-20): the last few pushed, newest first — only on the open list,
  // since a search or a kind already says what the coach is after.
  const recent = useMemo(() => (chip === 'all' && !query.trim()
    ? rows.filter(r => r.entry.lastUsedAt).sort((a, b) => String(b.entry.lastUsedAt).localeCompare(String(a.entry.lastUsedAt))).slice(0, RECENT_COUNT)
    : []), [rows, chip, query]);
  // Each workout once: what is in "אחרונים" is not listed again under it.
  const recentIds = useMemo(() => new Set(recent.map(r => r.entry.id)), [recent]);

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

      {/* One row, scrolled sideways: a wrapped second row read as a different set of filters. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="toolbar" aria-label={t('kindsLabel')}>
        {CHIPS.map(c => (
          <button
            key={c}
            type="button"
            aria-pressed={chip === c}
            onClick={() => setChip(chip === c && c !== 'all' ? 'all' : c)}
            className={cn(
              'h-11 shrink-0 whitespace-nowrap rounded-full px-[15px] text-[15px] font-bold shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]',
              chip === c ? 'bg-ink-900 text-white' : 'bg-white text-ink-500',
            )}
          >
            {c === 'fav' ? t('chip.fav') : c === 'all' ? t('kind.all') : t(`chip.${c}`)}
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
          {recent.length > 0 && (
            <>
              <SectionLabel>{t('recent')}</SectionLabel>
              <div className={CARD}>
                {recent.map(({ entry, model }) => <BookRow key={`r-${entry.id}`} entry={entry} model={model} thresholdSec={thresholdSec} fav={favourites.has(entry.id)} onPick={onPick} />)}
              </div>
            </>
          )}
          <SectionLabel>{recent.length ? t('allWorkouts') : t('mostUsed')}</SectionLabel>
          <div className={CARD}>
            {rows.filter(r => !recentIds.has(r.entry.id)).map(({ entry, model }) => (
              <BookRow key={entry.id} entry={entry} model={model} thresholdSec={thresholdSec} fav={favourites.has(entry.id)} onPick={onPick} />
            ))}
          </div>
        </>
      )}
    </FlowScreen>
  );
}

/**
 * One row of the book: the name with each number isolated LTR (the count left of the size on a
 * Hebrew line), the size at this trainee's paces, then usage only when it says something
 * ("שימשו 4 פעמים") — else the kind or when it was last used. ❤ at the row's end; the session
 * drawn small, inside the row's padding.
 */
function BookRow({ entry, model, thresholdSec, fav, onPick }: {
  entry: LibraryEntry; model: ReturnType<typeof fromLibrarySteps>; thresholdSec: number | null; fav: boolean; onPick: (e: LibraryEntry) => void;
}) {
  const t = useTranslations('workoutBook');
  const totals = model ? bookTotals(model, thresholdSec) : null;
  const last = entry.lastUsedAt ? `${entry.lastUsedAt.slice(8, 10)}.${entry.lastUsedAt.slice(5, 7)}` : null;
  // The history fill's entries say they are still a guess (Ofer: a type is chosen, never guessed).
  const extra = isUnclassified(entry)
    ? <span className="font-bold text-[#8A4308]">{t('unclassifiedHint')}</span>
    : entry.useCount >= 2
    ? t.rich('usedTimes', { ...RICH, count: entry.useCount })
    : last ? <>{t('lastUsed')} <bdi dir="ltr">{last}</bdi></> : t(`kind.${entry.kind}`);
  return (
    <button type="button" onClick={() => onPick(entry)}
      className="flex min-h-[64px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 py-3 text-start last:border-0">
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[17px] font-extrabold text-ink-900"><NumberRuns text={entry.name} /></b>
        <small className="mt-0.5 block truncate text-[13.5px] text-ink-400">
          {totals && <>{t.rich('kmOnly', { ...RICH, km: kmText(totals.distanceM) })} · {t.rich('minShort', { ...RICH, min: Math.round(totals.durationSec / 60) })} · </>}
          {extra}
        </small>
      </span>
      {model && <ProfileBar segments={profileBar(model, thresholdSec)} size="sm" />}
      {fav && <span aria-label={t('favourite')} className="shrink-0 text-[14px] text-[#E0245E]">❤</span>}
    </button>
  );
}
