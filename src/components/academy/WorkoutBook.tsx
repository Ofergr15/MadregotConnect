'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Copy, Heart, Layers, Search } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  LIBRARY_KINDS,
  entryHeadline,
  entryShape,
  entryVolume,
  filterLibrary,
  type LibraryEntry,
  type LibraryKind,
  type LibraryScope,
} from '@/lib/academy/library';

// ── ספר האימונים ─────────────────────────────────────────────────────────────
//
// Section 4's workout book. Every decision about what a row MEANS lives in
// `lib/academy/library.ts` — the order, the shape badge, the volume, which efforts a session
// asks for — so nothing here sorts, sums or classifies. This file is the words and the
// pixels.
//
// The screen's one job is recognition. A coach opens it knowing the session they want and
// has to find it in about a second, which is why the badge on the leading edge is the
// STRUCTURE (`6×800`) and not the kind: the academy names its workouts by their structure,
// and a row whose badge reads "אינטרוולים" next to a name reading "אינטרוולים קלאסי" has
// spent its most valuable pixels repeating itself.
//
// Nothing on this screen shows a pace, and that absence is the feature rather than an
// omission. An entry holds `102% מהסף`, and the number a trainee runs does not exist until
// one is chosen — see the explainer box at the bottom, which is on the screen precisely
// because a coach looking for a pace and not finding one would otherwise assume it broke.

const KIND_LABEL: Record<LibraryKind, string> = {
  intervals: 'אינטרוולים',
  tempo: 'טמפו',
  long: 'ארוך',
  easy: 'קל',
  hills: 'גבעות',
  test: 'טסט',
};

/**
 * The academy's own words for each effort.
 *
 * `threshold` is `קצב סף` — the phrase the mockup writes into the list row itself, and the
 * one Ofer uses out loud. An effort with no zone name falls through to its percentage,
 * which is the mockup's second row (`102% מהסף`) and the general case: the book can hold
 * any intensity, not only the six with names.
 */
const ZONE_LABEL: Record<string, string> = {
  easy: 'קל',
  marathon_pace: 'קצב מרתון',
  tempo: 'טמפו',
  threshold: 'קצב סף',
  interval: 'אינטרוולים',
  sprint: 'ספרינט',
};

function effortLabel(steps: LibraryEntry['steps']): React.ReactNode {
  const headline = entryHeadline(steps);
  if (!headline) return null;
  if (headline.kind === 'hr') {
    // As percentages of max heart rate, for the same reason the paces are percentages of
    // threshold: one entry is read by every trainee, so it cannot hold anyone's bpm.
    const { minPct, maxPct } = headline;
    if (minPct === null && maxPct === null) return 'דופק';
    return <>דופק <bdi dir="ltr">{minPct ?? maxPct}{maxPct !== null && minPct !== null ? `–${maxPct}` : ''}%</bdi></>;
  }
  if (headline.zone && ZONE_LABEL[headline.zone]) return ZONE_LABEL[headline.zone];
  return <><bdi dir="ltr">{headline.fastPct}%</bdi> מהסף</>;
}

/** `8300` → `8.3`, `12000` → `12`. Kilometres, because nobody scans a book in metres. */
function km(metres: number): string {
  const value = metres / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * How often this entry has been run, in words.
 *
 * Grammatical rather than the mockup's shorthand (`הרצה 28 פעם`): the number is variable and
 * "פעם" next to anything but 1 is wrong in Hebrew. Zero is stated as never run rather than
 * as `0` — a fresh entry is not a neglected one, and it is the state every entry starts in.
 *
 * Short, because it is the last of three things on a line 182px wide at 375px: `הורץ 9 פעמים`
 * was the wording that pushed the heart-rate row past its own width in the audit, and this
 * line truncates from the end, so the longer phrasing cost the count itself.
 */
function useCountLabel(count: number): React.ReactNode {
  if (count === 0) return 'טרם הורץ';
  if (count === 1) return 'הרצה אחת';
  return <><bdi dir="ltr">{count}</bdi> הרצות</>;
}

/** The pure view. Split out so the audit harness mounts exactly what ships. */
export function BookList({
  entries,
  scope,
  onScope,
  onDuplicate,
}: {
  entries: LibraryEntry[];
  scope: LibraryScope;
  onScope: (next: LibraryScope) => void;
  onDuplicate?: (entry: LibraryEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<LibraryKind | null>(null);

  // The whole shelf's size, not the filtered count: the header answers "how big is my book",
  // and a number that drops to 2 while you type is answering a different question.
  const shelfSize = useMemo(
    () => entries.filter(e => e.scope === scope).length,
    [entries, scope],
  );
  const shown = useMemo(
    () => filterLibrary(entries, { scope, kind, query }),
    [entries, scope, kind, query],
  );

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-500">
          <bdi dir="ltr">{shelfSize}</bdi> אימונים שמורים
        </p>
        {/* שלי / אקדמיה. Two shelves rather than one, which is the structural answer to
            "is the book yours or the academy's": a mentor writes on their own shelf and
            pushes from the canon, and a workout from the canon is one Ofer already approved. */}
        <div className="flex rounded-pill bg-page p-0.5">
          {(['mine', 'academy'] as LibraryScope[]).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => onScope(value)}
              // 44px of height on a two-item segmented control, the same as RecordTest's:
              // switching shelves is the most-used control on the screen and it sat at 24px.
              className={cn(
                'min-h-[44px] rounded-pill px-4 text-[13px] font-semibold transition-colors',
                scope === value ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500',
              )}
            >
              {value === 'mine' ? 'שלי' : 'אקדמיה'}
            </button>
          ))}
        </div>
      </div>

      {/* No search and no chips over an empty shelf: six ways to filter nothing is an invitation
          to conclude the book is broken rather than empty. */}
      {shelfSize > 0 && (
      <div className="flex h-11 items-center gap-2 rounded-card bg-card px-3">
        <Search className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          // The field has no visible label — the magnifier is the label — so the name is here.
          aria-label="חיפוש בספר האימונים"
          // Not "או מרחק" as the mockup's placeholder has it: the search deliberately does
          // not match step distances, because '2000' is the warmup of nearly every entry and
          // a box that answers every query with "everything" is not a search box. Promising
          // it in the placeholder would make that a bug report instead of a decision.
          placeholder="חיפוש לפי שם או הערה…"
          // `text-[16px]`, not `text-sm`: iOS Safari zooms the whole page in when a field under
          // 16px takes focus, and the layout then jumps while the coach is typing.
          // `self-stretch`, so the tappable box is the whole 44px row and not the 22px of text
          // inside it — the audit measures the element, and a thumb lands on the element.
          className="min-w-0 flex-1 self-stretch bg-transparent text-[16px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>
      )}

      {shelfSize > 0 && (
      <div className="flex flex-wrap gap-1.5">
        {LIBRARY_KINDS.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(kind === value ? null : value)}
            aria-pressed={kind === value}
            className={cn(
              // 44px, wrapping onto a second line rather than staying one row of 24px pills:
              // six chips is six chances to filter the book to the wrong thing with a thumb.
              'h-11 min-w-[44px] rounded-pill px-3 text-[13px] font-semibold transition-colors',
              // `ink-700`, not the `ink-600` this first had: there is no 600 in the ramp
              // (900 / 700 / 500 / 400), and a dead Tailwind class fails silently — the
              // chips would have rendered in the inherited colour and looked deliberate.
              kind === value ? 'bg-brand-600 text-white' : 'bg-card text-ink-700',
            )}
          >
            {KIND_LABEL[value]}
          </button>
        ))}
      </div>
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-400">
          {shelfSize === 0
            ? (scope === 'mine' ? 'אין לך עדיין אימונים בספר.' : 'ספר האקדמיה עדיין ריק.')
            : 'אין אימון שמתאים לחיפוש.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.map(entry => (
            <Row key={entry.id} entry={entry} onDuplicate={onDuplicate} />
          ))}
        </div>
      )}

      {/* On the screen and not only in the mockup. A coach looking for the pace of a session
          and finding none has to be told that the absence is the design, or the first
          conclusion is that the entry is broken — and the second is to write the pace into
          the name, which is exactly the per-runner workout the book replaces. */}
      <div className="rounded-card bg-brand-600/10 px-3.5 py-3">
        <p className="flex items-start gap-2 text-xs text-brand-600">
          <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            אימון בספר נשמר <span className="font-bold">בלי קצבים מוחלטים</span> — הוא נשמר
            כ״קצב סף״ או כ״<bdi dir="ltr">92%</bdi> מהסף״, והקצב האמיתי נגזר לכל מתאמן מהטסט
            שלו. לכן אותו אימון מתאים לדבוקה <bdi dir="ltr">4</bdi> ולדבוקה{' '}
            <bdi dir="ltr">9</bdi>.
          </span>
        </p>
      </div>

      {/* Only when there is an order to explain. Over an empty shelf it reads as a caption for
          a list that failed to load. */}
      {shown.length > 0 && (
        <p className="text-center text-[11px] text-ink-400">מסודר לפי תכיפות שימוש</p>
      )}
    </div>
  );
}

function Row({
  entry,
  onDuplicate,
}: {
  entry: LibraryEntry;
  onDuplicate?: (entry: LibraryEntry) => void;
}) {
  const shape = entryShape(entry.steps);
  const { distanceM, durationSec } = entryVolume(entry.steps);
  const effort = effortLabel(entry.steps);

  return (
    <div className="flex items-center gap-3 rounded-card bg-card px-3 py-3 text-right">
      {/* The structure, on the leading edge, because that is what a coach recognises the
          session by before reading anything. band-3 for the heart-rate sessions — the
          academy's one warning-free accent that is not brand blue — so the entries that
          need no threshold to push are visible at a glance.

          A session with no shape gets NO badge, which is what the mockup does and what
          `entryShape` returns null to say. This first printed a blue `רצוף` pill instead, and
          the screenshot was the argument against it: four of seven rows carried the same pill,
          so the column of badges stopped being scannable — which is the badge's only job. */}
      {shape && (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-pill px-2 py-1 text-[11px] font-semibold',
            shape.kind === 'hr' ? 'bg-band-3/10 text-band-3-ink' : 'bg-brand-600/10 text-brand-600',
          )}
        >
          {shape.kind === 'hr'
            ? <><Heart className="h-3 w-3" />דופק</>
            : <><BookOpen className="h-3 w-3" /><bdi dir="ltr">{shape.count}×{shape.distanceM}</bdi></>}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* The name gets the whole line. The author used to sit beside it and cost it 50px of
            the 200 it has — on a list whose rows are told apart by their names. */}
        <p className="truncate text-sm font-bold text-ink-900" dir="auto">{entry.name}</p>
        {/* One measure of size, not two. A session written in minutes is a session whose
            kilometres are its warmup — the mockup's own heart-rate row prints no distance at
            all — and printing both ran the line past its width, which truncates from the end
            and so costs the use count. The author of a canon entry is not here for the same
            reason: it was the item this line lost first. */}
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-ink-500">
          {durationSec > 0
            ? <><bdi dir="ltr">{Math.round(durationSec / 60)}</bdi> דק׳ · </>
            : distanceM > 0 ? <><bdi dir="ltr">{km(distanceM)}</bdi> ק״מ · </> : null}
          {effort && <>{effort} · </>}
          {useCountLabel(entry.useCount)}
        </p>
      </div>

      {onDuplicate && (
        <button
          type="button"
          onClick={() => onDuplicate(entry)}
          // 44px of tappable height, laid out so the icon still reads as a small control:
          // the audit measures the TAP TARGET, and an icon button sized to its glyph is the
          // finding it raises most often.
          aria-label={`שכפול ${entry.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-ink-400 active:bg-page"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function WorkoutBook() {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [scope, setScope] = useState<LibraryScope>('mine');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/academy/library', { headers: await apiHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data?.error || 'לא הצלחנו לטעון את ספר האימונים'); return; }
        setNotSetUp(!!data.tableMissing);
        setEntries((data.entries || []) as LibraryEntry[]);
      } catch {
        if (!cancelled) setError('לא הצלחנו לטעון את ספר האימונים');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="py-6 text-center text-xs text-accent-red-ink">{error}</p>;
  // Said plainly rather than as an empty book: migration 109 is pasted in by hand, and a
  // screen that looks merely empty is one nobody thinks to go and apply a migration for.
  if (notSetUp) {
    return <p className="py-6 text-center text-xs text-ink-400">ספר האימונים עדיין לא הוגדר במסד הנתונים.</p>;
  }
  if (!entries) return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  return <BookList entries={entries} scope={scope} onScope={setScope} />;
}

/** The icon the tab uses, exported so the page does not import lucide twice. */
export const BookIcon = BookOpen;
