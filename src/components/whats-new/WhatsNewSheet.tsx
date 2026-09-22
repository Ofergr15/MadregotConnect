'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { InsetRow } from '@/components/ui/InsetList';
import { israelToday } from '@/lib/utils';
import {
  WHATS_NEW, type WhatsNewEntry, type WhatsNewLang,
} from '@/lib/whats-new/entries';
import {
  WHATS_NEW_KEY, deviceIsReturning, initLedger, markSeen, readWhatsNewLedger,
  unseenEntries, visibleEntries,
} from '@/lib/whats-new/ledger';
import { WhatsNewArt } from './WhatsNewArt';

/**
 * WHAT'S NEW — the digest sheet.
 *
 * One sheet, up to three rows, each row a door into the feature it announces.
 * The shape he picked, and the one the research argues for: a launch-time change
 * list is a "push revelation" (NN/g) — out of context and poorly retained — so
 * the only way it earns the interruption is by handing back the pull. Hence no
 * single "Next → Next → Done" flow and no carousel: the rows ARE the actions, and
 * the one button at the bottom just closes.
 *
 * What is deliberately absent:
 *   · any auto-open on a cold paint. The feed passes `ready`, and it is true only
 *     once the feed itself has rendered. A modal over a skeleton throws away the
 *     context that made the announcement mean anything.
 *   · any appearance for somebody new — see ledger.ts rule 1.
 *   · any way to make it come back on its own. Closing it is final, which is only
 *     honest because WhatsNewSettingsRow keeps it permanently reachable
 *     (dismissible AND recallable is one rule, not two).
 */

function localeLang(locale: string): WhatsNewLang {
  return locale === 'en' ? 'en' : 'he';
}

function EntryRow({
  entry, lang, isNew, onOpen,
}: { entry: WhatsNewEntry; lang: WhatsNewLang; isNew: boolean; onOpen: () => void }) {
  const t = useTranslations('whatsNew');
  const copy = entry[lang];
  // The chevron points at the row's trailing edge, which flips with the script.
  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;
  // A real <Link>, not a button that calls router.push: lib/use-back-dismiss.ts
  // watches for a click inside `a[href]` to know a navigation is coming, and
  // without that evidence it pops the sheet's own history entry on close — which
  // cancels the push outright and leaves the reader exactly where they were.
  // This row looked dead in 2.40.91 for precisely that reason.
  return (
    <Link
      href={entry.href}
      onClick={onOpen}
      className="flex w-full items-center gap-3 py-3 text-start active:opacity-70"
    >
      <WhatsNewArt art={entry.art} lang={lang} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-ink-900">{copy.title}</span>
          {isNew && (
            <span className="rounded-pill bg-brand-600/10 px-1.5 py-0.5 text-3xs font-bold text-brand-600">
              {t('badge')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-500">{copy.body}</span>
      </span>
      <Chevron className="h-4 w-4 shrink-0 text-ink-300" />
    </Link>
  );
}

export function WhatsNewSheet({
  open, onOpenChange, entries, newSlugs = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WhatsNewEntry[];
  /** Which rows carry the "new" badge. Empty when reopened from settings. */
  newSlugs?: string[];
}) {
  const t = useTranslations('whatsNew');
  const lang = localeLang(useLocale());

  if (entries.length === 0) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-brand-600" />
          {t('title')}
        </span>
      }
      footer={
        <div className="border-t border-page px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-card bg-brand-600 py-3.5 text-sm font-bold text-white active:opacity-80"
          >
            {t('gotIt')}
          </button>
          {/* The recall promise, made where the sheet is being closed — this is the
              sentence that makes a final dismissal safe to offer. */}
          <p className="mt-2 text-center text-2xs text-ink-400">{t('recall')}</p>
        </div>
      }
    >
      <p className="mb-1 text-xs text-ink-500">{t('lead')}</p>
      <div className="divide-y divide-page">
        {entries.map((e) => (
          <EntryRow
            key={e.slug}
            entry={e}
            lang={lang}
            isNew={newSlugs.includes(e.slug)}
            onOpen={() => onOpenChange(false)}
          />
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The auto-open on the feed. Renders nothing of its own.
 *
 * `ready` is the feed's own "I have painted" signal; see the sheet's docblock for
 * why it is a prop rather than a timer.
 */
export function WhatsNewAutoSheet({ ready }: { ready: boolean }) {
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || entries) return;
    const stored = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
    // Stamping `since` is what decides whether anything is news to this device at
    // all, so it happens on the first ready feed whether or not a sheet follows.
    const ledger = initLedger(
      stored, israelToday(), deviceIsReturning(Object.keys(localStorage)),
    );
    if (ledger !== stored) localStorage.setItem(WHATS_NEW_KEY, JSON.stringify(ledger));

    const next = unseenEntries(WHATS_NEW, ledger);
    if (next.length === 0) return;
    // Spent at OPEN, not at close: a sheet that only counted as shown once it was
    // dismissed would re-announce itself forever to anyone who closes the tab, and
    // "once, ever" is the whole restraint this module lives by.
    localStorage.setItem(
      WHATS_NEW_KEY, JSON.stringify(markSeen(ledger, next.map((e) => e.slug))),
    );
    setEntries(next);
    setOpen(true);
  }, [ready, entries]);

  if (!entries) return null;
  return (
    <WhatsNewSheet
      open={open}
      onOpenChange={setOpen}
      entries={entries}
      newSlugs={entries.map((e) => e.slug)}
    />
  );
}

/**
 * The permanent way back in, on Settings. Shows the same recent entries, badges
 * whatever the auto-sheet has not spent yet, and — importantly — does NOT mark
 * anything seen: coming here on purpose is a pull, and a pull should not quietly
 * cancel the one push the feature is allowed.
 */
export function WhatsNewSettingsRow() {
  const t = useTranslations('whatsNew');
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [entries, setEntries] = useState<WhatsNewEntry[]>([]);

  useEffect(() => {
    const ledger = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
    setEntries(visibleEntries(WHATS_NEW, ledger));
    setUnseen(unseenEntries(WHATS_NEW, ledger).map((e) => e.slug));
  }, []);

  if (entries.length === 0) return null;

  return (
    <>
      <InsetRow
        icon={Sparkles}
        iconBg="bg-brand-600"
        label={t('title')}
        onClick={() => setOpen(true)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            {unseen.length > 0 && (
              <span className="min-w-[22px] rounded-pill bg-brand-600 px-1.5 py-0.5 text-center text-2xs font-bold tabular-nums text-white">
                {unseen.length}
              </span>
            )}
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
          </span>
        }
      />
      <WhatsNewSheet open={open} onOpenChange={setOpen} entries={entries} newSlugs={unseen} />
    </>
  );
}
