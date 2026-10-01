'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronLeft, ChevronRight, Play, Sparkles } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { InsetRow } from '@/components/ui/InsetList';
import { cn, israelToday } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { isFramed } from '@/lib/framed';
import { APP_VERSION } from '@/lib/version';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { useEveningRelease } from '@/lib/use-evening-release';
import {
  WHATS_NEW, type WhatsNewEntry, type WhatsNewLang,
} from '@/lib/whats-new/entries';
import { EVENING_OPEN, TOUR_PARAM, composeWhatsNew, type WhatsNewContent } from '@/lib/whats-new/evening';
import {
  WHATS_NEW_EPOCH, WHATS_NEW_KEY, deviceIsReturning, initLedger, markSeen, readWhatsNewLedger,
  unseenEntries, visibleEntries,
} from '@/lib/whats-new/ledger';
import { WhatsNewArt } from './WhatsNewArt';
import { WhatsNewStory } from './WhatsNewStory';

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
      {entry.art ? (
        <WhatsNewArt art={entry.art} lang={lang} />
      ) : (
        <span className="flex h-[53px] w-[84px] shrink-0 items-center justify-center rounded-xl bg-brand-600/10 text-2xl">
          {entry.icon}
        </span>
      )}
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

/**
 * A headline (an entry with `cards`) in the sheet: version B of the showcase
 * mockup, which Settings keeps; the evening's first showing is the tour. The art
 * steps through real renders of each view, the way the mockup's cycled; the
 * button is the row's door, a real <Link> for the reason EntryRow gives.
 */
function HeadlineCard({
  entry, lang, isNew, onOpen,
}: { entry: WhatsNewEntry; lang: WhatsNewLang; isNew: boolean; onOpen: () => void }) {
  const t = useTranslations('whatsNew');
  const copy = entry[lang];
  const frames = entry.cards ?? [];
  const [at, setAt] = useState(0);
  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (frames.length < 2) return;
    // Still for anyone who asked the phone for less motion: the first view says it.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setAt((n) => (n + 1) % frames.length), 1800);
    return () => clearInterval(id);
  }, [frames.length]);

  return (
    <div className="mb-2.5 flex overflow-hidden rounded-2xl border border-ink-300/40">
      <div aria-hidden className="flex w-[112px] shrink-0 flex-col items-center justify-center gap-1.5 bg-[#eef0f7] py-2.5">
        <div className="relative h-[156px] w-[88px] overflow-hidden rounded-[10px] bg-[#1b1150] shadow-[0_8px_20px_rgba(0,0,0,.25)]">
          {frames.map((f, i) => (
            <img
              key={f.key}
              src={`/whats-new/${f.key}.${lang}.jpg`}
              alt=""
              className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', i === at ? 'opacity-100' : 'opacity-0')}
            />
          ))}
        </div>
        {/* Under the frame, not on it: every view draws something at its bottom edge. */}
        {frames[at] && (
          <span className="whitespace-nowrap rounded-pill bg-ink-900/75 px-2 py-0.5 text-3xs font-bold text-white">
            {frames[at][lang]}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-2.5 text-start">
        <span>
          <span className="text-[14.5px] font-bold text-ink-900">{copy.title}</span>
          {isNew && (
            <span className="ms-1.5 rounded-pill bg-brand-600/10 px-1.5 py-0.5 align-[2px] text-3xs font-bold text-brand-600">
              {t('badge')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-500">{copy.body}</span>
        <span className="mt-auto block pt-2">
          <Link
            href={entry.href}
            onClick={onOpen}
            className="flex h-[38px] items-center justify-center gap-0.5 rounded-[11px] bg-brand-600 text-[13px] font-extrabold text-white active:opacity-80"
          >
            {copy.cta} <Chevron className="h-3.5 w-3.5" />
          </Link>
        </span>
      </div>
    </div>
  );
}

/**
 * Everything else since the last What's new, folded to one row under the
 * headlines and opened in place. Titles only once opened, with the body a line
 * under each: this is the part a reader skims, and the headlines are the news.
 */
function MoreList({ notes }: { notes: ShownNote[] }) {
  const t = useTranslations('whatsNew');
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  return (
    <div className="border-t border-page pt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 text-start text-xs text-ink-500 active:opacity-70"
      >
        <span aria-hidden>🔧</span>
        <span className="min-w-0 flex-1 truncate">
          <b className="text-ink-900">{t('more', { count: notes.length })}</b>
          {!open && <> · {notes.slice(0, 2).map((n) => n.title).join(' · ')}</>}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-300 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="divide-y divide-page pb-1">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5 py-2">
              <span aria-hidden className="w-5 shrink-0 text-center">{n.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink-900">{n.title}</span>
                <span className="mt-0.5 block text-2xs leading-snug text-ink-500">{n.body}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WhatsNewSheet({
  open, onOpenChange, entries, newSlugs = [], more = [], onReplay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WhatsNewEntry[];
  /** Which rows carry the "new" badge. Empty when reopened from settings. */
  newSlugs?: string[];
  /** The "and N more" list under the headlines (lib/whats-new/evening.ts). */
  more?: ShownNote[];
  /** Settings' way back into the tour (WhatsNewStory), under the headlines. */
  onReplay?: () => void;
}) {
  const t = useTranslations('whatsNew');
  const lang = localeLang(useLocale());

  if (entries.length === 0) return null;
  const headlines = entries.filter((e) => e.cards?.length);
  const rows = entries.filter((e) => !e.cards?.length);

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
          <p className="mt-2 text-center text-2xs text-ink-400">
            {t('recall')} ·{' '}
            <Link href="/dashboard/whats-new" onClick={() => onOpenChange(false)} className="font-semibold text-brand-600">
              {t('allChanges')}
            </Link>
          </p>
        </div>
      }
    >
      <p className={cn('text-xs text-ink-500', headlines.length ? 'mb-2.5 text-center' : 'mb-1')}>
        {headlines.length ? t('leadHeadlines', { count: headlines.length }) : t('lead')}
      </p>
      {headlines.map((e) => (
        <HeadlineCard
          key={e.slug}
          entry={e}
          lang={lang}
          isNew={newSlugs.includes(e.slug)}
          onOpen={() => onOpenChange(false)}
        />
      ))}
      <div className="divide-y divide-page">
        {rows.map((e) => (
          <EntryRow
            key={e.slug}
            entry={e}
            lang={lang}
            isNew={newSlugs.includes(e.slug)}
            onOpen={() => onOpenChange(false)}
          />
        ))}
      </div>
      <MoreList notes={more} />
      {onReplay && headlines.length > 0 && (
        <button
          type="button"
          onClick={onReplay}
          className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-1.5 text-xs font-bold text-brand-600 active:opacity-70"
        >
          <Play className="h-3.5 w-3.5" /> {t('tourReplay')}
        </button>
      )}
    </Sheet>
  );
}

/**
 * The hand-written entries plus what the owner featured in the daily releases
 * (lib/release-notes.ts), or with `evening` the evening's headlines and the
 * list under them (lib/whats-new/evening.ts). `null` until the releases have
 * loaded, so the feed never spends a ledger on half the list.
 */
function useContent(evening: boolean): WhatsNewContent | null {
  const { data, error } = useApi<{ releases: WhatsNewRelease[] }>('/api/whats-new', { revalidateOnFocus: false });
  if (error) return { entries: evening ? composeWhatsNew([], APP_VERSION, true).entries : WHATS_NEW, more: [] };
  if (!data) return null;
  return composeWhatsNew(data.releases ?? [], APP_VERSION, evening);
}

/** The list belongs under the headlines, so a sheet without one leaves it out. */
function withHeadline(entries: WhatsNewEntry[], content: WhatsNewContent | null): ShownNote[] {
  return entries.some((e) => e.cards?.length) ? content?.more ?? [] : [];
}

/**
 * The auto-open on the feed. Renders nothing of its own.
 *
 * `ready` is the feed's own "I have painted" signal; see the sheet's docblock for
 * why it is a prop rather than a timer.
 */
export function WhatsNewAutoSheet({ ready }: { ready: boolean }) {
  // The switch itself and not the super user's early look: his own once-per-device
  // stays unspent until the evening does open (lib/whats-new/evening.ts).
  const content = useContent(EVENING_OPEN);
  const all = content?.entries ?? null;
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !all || entries) return;
    // Not inside the release rehearsal's frame: opening there would spend the
    // ledger, and the real sheet would never come (lib/framed.ts).
    if (isFramed()) return;
    const stored = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
    // Stamping `since` is what decides whether anything is news to this device at
    // all, so it happens on the first ready feed whether or not a sheet follows.
    const ledger = initLedger(
      stored, israelToday(), deviceIsReturning(Object.keys(localStorage)),
    );
    if (ledger !== stored) localStorage.setItem(WHATS_NEW_KEY, JSON.stringify(ledger));

    // The release push links here with ?tour=1 (TOUR_PARAM): a tap is asking, so the
    // tour opens on any device, a new or a spent one, and the link is dropped so a
    // reload does not replay it.
    const url = new URL(window.location.href);
    const asked = EVENING_OPEN && url.searchParams.get(TOUR_PARAM) === '1';
    if (asked) {
      url.searchParams.delete(TOUR_PARAM);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    const next = asked
      ? visibleEntries(all, { ...ledger, since: WHATS_NEW_EPOCH })
      : unseenEntries(all, ledger);
    if (next.length === 0) return;
    // Spent at OPEN, not at close: a sheet that only counted as shown once it was
    // dismissed would re-announce itself forever to anyone who closes the tab, and
    // "once, ever" is the whole restraint this module lives by.
    localStorage.setItem(
      WHATS_NEW_KEY, JSON.stringify(markSeen(ledger, next.map((e) => e.slug))),
    );
    setEntries(next);
    setOpen(true);
  }, [ready, all, entries]);

  if (!entries) return null;
  // The evening's headlines come as the full-screen tour (version A); the plain
  // rows keep the sheet.
  if (entries.some((e) => e.cards?.length)) {
    return open ? (
      <WhatsNewStory entries={entries} more={withHeadline(entries, content)} version={APP_VERSION} onClose={() => setOpen(false)} />
    ) : null;
  }
  return (
    <WhatsNewSheet
      open={open}
      onOpenChange={setOpen}
      entries={entries}
      newSlugs={entries.map((e) => e.slug)}
      more={withHeadline(entries, content)}
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
  const content = useContent(useEveningRelease());
  const all = content?.entries ?? null;
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [entries, setEntries] = useState<WhatsNewEntry[]>([]);

  useEffect(() => {
    if (!all) return;
    const ledger = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
    setEntries(visibleEntries(all, ledger));
    setUnseen(unseenEntries(all, ledger).map((e) => e.slug));
  }, [all]);

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
      <WhatsNewSheet
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        newSlugs={unseen}
        more={withHeadline(entries, content)}
        onReplay={() => { setOpen(false); setTour(true); }}
      />
      {tour && (
        <WhatsNewStory entries={entries} more={withHeadline(entries, content)} version={APP_VERSION} onClose={() => setTour(false)} />
      )}
    </>
  );
}
