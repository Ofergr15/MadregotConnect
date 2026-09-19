'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';

import { BookList } from '@/components/academy/WorkoutBook';
import { type LibraryEntry, type LibraryScope } from '@/lib/academy/library';
import { CANON, SHELF } from './fixtures';

// ── ספר האימונים, on both shelves and in its empty states ─────────────────────
//
// The book's rows are ENTIRELY derived — the badge, the volume, the effort and the ordering
// are all computed from the steps, and none of them exists as a field anybody typed. So
// every one of them can be wrong in a way that looks perfectly plausible on screen, and
// there is no row in any database that would contradict it.
//
// The four things this screen exists to show, none of them visible from the code:
//
//  1. **A shelf in use.** The badges must read as a column of recognisable structures
//     (`6×800`, `4×1600`) rather than as four identical blue pills, and the order must be
//     the most-run session first — that ordering IS the three-clicks claim.
//  2. **A continuous session and a heart-rate one** next to the rep sessions. Those two get
//     a different badge and a different colour, and a warm chip beside a blue one is where
//     the academy's palette has smeared before (see ThreadInbox).
//  3. **A long name.** `truncate` next to a shape badge and an author name is a row with
//     three things competing for one line — the exact shape that truncated the name in the
//     weekly queue.
//  4. **The academy shelf**, which is the same list with an author on every row, and the
//     empty states for both shelves and for a search that matches nothing.
//
// Development only. In production the route does not exist.


export default function AcademyBookPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">ספר האימונים</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · שתי מדפים ושני מצבים ריקים</p>
        </div>

        <Case label="המדף שלי">
          <Book entries={[...SHELF, ...CANON]} initial="mine" />
        </Case>

        <Case label="ספר האקדמיה">
          <Book entries={[...SHELF, ...CANON]} initial="academy" />
        </Case>

        <Case label="מדף ריק">
          <Book entries={[]} initial="mine" />
        </Case>
      </div>
    </div>
  );
}

/** The scope tab is the parent's state in the real screen, so it is here too. */
function Book({ entries, initial }: { entries: LibraryEntry[]; initial: LibraryScope }) {
  const [scope, setScope] = useState<LibraryScope>(initial);
  return (
    <BookList
      entries={entries}
      scope={scope}
      onScope={setScope}
      onDuplicate={() => {}}
      onNew={() => {}}
      onEdit={() => {}}
      // A manager, so the canon rows carry a pencil too. The read to make here is whether a
      // row with the pencil and a row without it are distinguishable at a glance — they sit
      // on the same shelf in the real screen the moment a mentor opens it.
      canEdit={() => true}
    />
  );
}

function Case({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      {children}
    </div>
  );
}
