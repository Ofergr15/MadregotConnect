'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, X } from 'lucide-react';
import { useOnboarding } from '@/lib/onboarding/use-onboarding';
import type { SetupTask } from '@/lib/onboarding/setup-tasks';
import {
  nudgeAllowed,
  nudgeDayKey,
  nudgeLedgerKey,
  readNudgeLedger,
  recordNudgeShown,
  skipNudge,
  type NudgeLedger,
} from '@/lib/onboarding/nudge-ledger';
import { ProgressRing } from './ProgressRing';
import {
  SETUP_CHECKLIST_HREF,
  TASK_DEST_LABEL_KEY,
  TASK_HINT_KEY,
  TASK_ICON,
  TASK_LABEL_KEY,
  taskHref,
} from './task-meta';

// ═════════════════════════════════════════════════════════════════════════════
// THE SETUP NUDGE, AT THE TOP OF THE FEED
//
// Everything this card shows already existed — the score, the rows, the
// destinations — on /dashboard/profile, which is the one screen a member who
// hasn't finished setting up never opens. Nothing here is a new decision:
//
//   · the score and the rows come from computeSetupState, the same state that
//     feeds the 15-minute snapshot mail and the entry nudge, so the app and the
//     inbox can never name different missing things;
//   · every row lands on a screen that already edits that field
//     (TASK_DESTINATION / taskHref), so this adds no form and no route.
//
// Two things about it are deliberate and cost something:
//
//  1. **ONLY WHAT IS MISSING.** The checklist screen keeps its finished rows —
//     there, the list is the subject and it must not shrink under you. Here the
//     card is an interruption in somebody's feed, so it has to be as short as
//     the ask: three rows, not five with two ticks. The score beside them is what
//     keeps "done" visible.
//  2. **דלג IS A REAL, LABELLED ACTION**, not only an × in the corner. An × is a
//     guess ("is this gone for good, or back tomorrow?"), and what makes a
//     labelled skip honest is that the header pill does NOT go with it — the card
//     can leave forever, the score stays until it reads 5/5. Both the × and the
//     button do the same thing for exactly that reason.
//
// How often it may appear at all is in lib/onboarding/nudge-ledger.ts.
// ═════════════════════════════════════════════════════════════════════════════

export function SetupNudgeCard() {
  const t = useTranslations('setup');
  const { data } = useOnboarding();
  const [athleteId, setAthleteId] = useState<string | null>(null);
  // null = the ledger hasn't been read yet. The card stays hidden until it is,
  // so a member who pressed דלג never sees a flash of it on the way in.
  const [ledger, setLedger] = useState<NudgeLedger | null>(null);
  const today = nudgeDayKey(new Date());

  useEffect(() => {
    try {
      const id = localStorage.getItem('athlete_id');
      if (!id) return;
      setAthleteId(id);
      setLedger(readNudgeLedger(localStorage.getItem(nudgeLedgerKey(id))));
    } catch {
      /* private mode: no ledger to read and none to write, so never show it —
         a card whose dismissal cannot be remembered would return on every open. */
    }
  }, []);

  const open = data?.applicable ? data.tasks.filter((task) => !task.done) : [];
  const visible =
    !!data &&
    data.applicable &&
    !data.completed &&
    !data.allDone &&
    // The tour is in the middle of explaining this very thing.
    data.tourSeen &&
    open.length > 0 &&
    !!athleteId &&
    !!ledger &&
    nudgeAllowed(ledger, today);

  // Spend the day only once it is actually on screen. Written on the way in
  // rather than on dismissal: the cap is on APPEARANCES, and a member who sees
  // the card and navigates away without answering has still been asked today.
  useEffect(() => {
    if (!visible || !athleteId || !ledger) return;
    const next = recordNudgeShown(ledger, today);
    if (next === ledger) return;
    try {
      localStorage.setItem(nudgeLedgerKey(athleteId), JSON.stringify(next));
    } catch { /* private mode */ }
    setLedger(next);
  }, [visible, athleteId, ledger, today]);

  const skip = useCallback(() => {
    if (!athleteId || !ledger) return;
    const next = skipNudge(ledger);
    try {
      localStorage.setItem(nudgeLedgerKey(athleteId), JSON.stringify(next));
    } catch { /* private mode */ }
    setLedger(next);
  }, [athleteId, ledger]);

  if (!visible || !data || !data.applicable) return null;

  const row = (task: SetupTask, last: boolean) => {
    const Icon = TASK_ICON[task.key];
    // Same sublabel rule as the checklist screen: a declared source with no
    // credentials behind it is the single most useful thing the row can say.
    const source = task.meta?.source === 'strava' ? 'Strava' : 'Garmin';
    const hint =
      task.key === 'watch' && task.meta?.source
        ? t('hintWatchDeclared', { source })
        : task.meta?.total
          ? t('hintFilledOf', { filled: task.meta.filled ?? 0, total: task.meta.total })
          : t(TASK_HINT_KEY[task.key]);

    return (
      <Link
        key={task.key}
        href={taskHref(task.key)}
        className={`flex items-center gap-3 py-2.5 active:opacity-60 ${last ? '' : 'border-b border-page'}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink-700">{t(TASK_LABEL_KEY[task.key])}</span>
          {/* Wraps rather than truncating. The longest hint here is the one that
              matters most — "בחרת Garmin, אבל אין חיבור פעיל והאימונים לא נכנסים" —
              and a single clipped line ended it at "לא נכ…", which is the half of
              the sentence that says nothing. */}
          <span className="block text-2xs font-light text-ink-400">{hint}</span>
          {/* Where the tap goes, said out loud. This card is somebody's first
              sight of these rows, and "חיבור שעון" alone doesn't tell them that
              tapping it leaves the feed. */}
          <span className="mt-1 inline-flex items-center gap-1 rounded-pill bg-brand-600/10 px-1.5 py-0.5">
            <ChevronLeft className="h-3 w-3 text-brand-600" />
            <span className="text-4xs font-bold text-brand-600">{t(TASK_DEST_LABEL_KEY[task.key])}</span>
          </span>
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
      </Link>
    );
  };

  return (
    <div className="rounded-card border border-band-3/35 bg-card p-4">
      <div className="flex items-start gap-3">
        <ProgressRing pct={data.pct} label={`${data.doneCount}/${data.totalCount}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-ink-700">{t('nudgeTitle', { left: open.length })}</h2>
          <p className="mt-0.5 text-2xs font-light text-ink-400">{t('nudgeSub')}</p>
        </div>
        <button
          type="button"
          onClick={skip}
          aria-label={t('nudgeSkip')}
          className="-me-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 active:bg-page"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2">{open.map((task, i) => row(task, i === open.length - 1))}</div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={SETUP_CHECKLIST_HREF}
          className="flex min-h-[42px] flex-1 items-center justify-center rounded-pill bg-brand-600 text-sm font-bold text-white active:bg-brand-700"
        >
          {t('nudgeCta')}
        </Link>
        <button
          type="button"
          onClick={skip}
          className="flex min-h-[42px] items-center justify-center rounded-pill border border-ink-300 px-5 text-sm font-bold text-ink-400 active:bg-page"
        >
          {t('nudgeSkip')}
        </button>
      </div>

      {/* Says the deal out loud, because a skip that quietly leaves something
          behind in the header would read as the card not having gone away. */}
      <p className="mt-2 text-center text-3xs font-light text-ink-400">{t('nudgeSkipNote')}</p>
    </div>
  );
}
