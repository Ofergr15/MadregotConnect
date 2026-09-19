'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';

import { WorkoutEditor, type WorkoutDraftPayload } from '@/components/academy/WorkoutEditor';
import { CANON, SHELF } from '../academy-book/fixtures';

// ── אימון חדש ────────────────────────────────────────────────────────────────
//
// The composer, in the five states it actually appears in. Nothing about a form is visible
// from its code: whether the rows read as one thing each, whether four kinds of row look
// like four kinds of row, and whether the whole thing still fits a thumb once a real workout
// is in it.
//
// The five, and what each one is here to settle:
//
//  1. **Blank, new.** The state a coach meets first. It has to look like something to fill
//     in rather than like a screen that failed to load — no steps, one add-button row, and
//     the save button already explaining why it is off.
//  2. **A real workout loaded** (`אינטרוולים קלאסי`, 28 pushes). Three step rows, one of them
//     a set of reps with five fields on it. This is the row that either wraps into something
//     readable at 375px or does not, and there is no way to tell from the JSX.
//  3. **Every kind of row at once.** easy / continuous / reps / hr stacked, which is the only
//     way to see whether they are distinguishable — they share a frame and differ only in
//     their fields, and four near-identical grey cards is a form nobody can scan.
//  4. **An entry the editor refuses** (`טסט 30 דקות` — its step carries a note). The refusal
//     has to read as a deliberate statement about THIS workout, not as an error, because the
//     coach's alternative reading is that editing is broken.
//  5. **A mentor, not a manager.** No shelf picker at all. The thing to check is that its
//     absence leaves no gap and no orphan label.
//
// Development only. In production the route does not exist.

const CLASSIC = SHELF[0];
const REFUSES = CANON[2];

/** One entry holding all four kinds of row, which no real fixture does. */
const EVERYTHING = {
  ...SHELF[0],
  name: 'כל סוגי הצעדים',
  steps: [
    SHELF[0].steps[0],
    SHELF[0].steps[1],
    { order: 3, type: 'active' as const, durationType: 'time' as const, durationValue: 1200, targetType: 'pace' as const, targetZone: 'tempo', intensity: { fastPct: 97, slowPct: 94 } },
    { order: 4, type: 'active' as const, durationType: 'time' as const, durationValue: 1800, targetType: 'heart_rate' as const, targetHrMinPct: 88, targetHrMaxPct: 93 },
  ],
};

export default function AcademyBookEditorPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">אימון חדש</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · חדש, טעון, כל הסוגים, סירוב, ומלווה</p>
        </div>

        <Case label="חדש וריק">
          <Editor canWriteCanon />
        </Case>

        <Case label="אימון קיים — 28 הרצות">
          <Editor initial={CLASSIC} canWriteCanon />
        </Case>

        <Case label="כל ארבעת סוגי הצעדים">
          <Editor initial={EVERYTHING} canWriteCanon />
        </Case>

        <Case label="אימון שהעורך מסרב לצייר">
          <Editor initial={REFUSES} canWriteCanon />
        </Case>

        <Case label="מלווה — בלי בחירת מדף">
          <Editor initial={CLASSIC} canWriteCanon={false} />
        </Case>

        <Case label="שמירה נכשלה">
          <Editor initial={CLASSIC} canWriteCanon error="כבר קיים בספר אימון בשם הזה" />
        </Case>
      </div>
    </div>
  );
}

function Editor({
  initial, canWriteCanon, error,
}: {
  initial?: typeof CLASSIC;
  canWriteCanon: boolean;
  error?: string;
}) {
  // The payload is printed rather than sent: the screen this harness exists to check is the
  // form, and a preview that posts to the real table writes rows into the book.
  const [saved, setSaved] = useState<WorkoutDraftPayload | null>(null);
  return (
    <>
      <WorkoutEditor
        initial={initial}
        canWriteCanon={canWriteCanon}
        error={error ?? null}
        onSave={setSaved}
        onArchive={initial ? () => {} : undefined}
        onCancel={() => setSaved(null)}
      />
      {saved && (
        <pre className="overflow-x-auto rounded-card bg-card p-2 text-[10px] text-ink-500" dir="ltr">
          {JSON.stringify(saved, null, 1)}
        </pre>
      )}
    </>
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
