'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronLeft, Sparkles, Wrench } from 'lucide-react';
import { addDaysToDateStr, cn, getPlanWeekStart } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { APP_VERSION } from '@/lib/version';
import { DemoPhone } from './DemoPhone';

/**
 * "מה חדש" as a member reads it (mockup ~/.cache/madregot/whats-new-v6.html, Ofer
 * 2026-10-19): by week, not by version. The week's biggest change on top with its
 * recorded demo, the other changes as rows with a picture that open to the change
 * itself, the small fixes folded into one row, earlier weeks folded under.
 */

interface Week { start: string; notes: ShownNote[] }

const media = (n: ShownNote) => (n.media ? `/whats-new/${n.media}` : null);
const poster = (n: ShownNote) => (n.poster ? `/whats-new/${n.poster}` : null);
const dm = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;

/** Releases → Sunday weeks, newest first; within a week, the changes with a demo first. */
export function weeksOf(releases: WhatsNewRelease[]): Week[] {
  const by = new Map<string, ShownNote[]>();
  for (const r of releases) {
    const start = getPlanWeekStart(new Date(new Date(r.released_at).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })));
    by.set(start, [...(by.get(start) ?? []), ...r.notes]);
  }
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([start, notes]) => ({ start, notes: [...notes].sort((x, y) => Number(!!y.media) - Number(!!x.media) || Number(y.featured) - Number(x.featured)) }));
}

function Thumb({ n }: { n: ShownNote }) {
  const p = poster(n);
  if (p) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p} alt="" className="h-[58px] w-[58px] shrink-0 rounded-[14px] object-cover object-top shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]" />;
  }
  const fix = n.kind === 'fix';
  return (
    <span className={cn('grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[14px]', fix ? 'bg-ink-900/[0.05] text-ink-500' : 'bg-brand-600/10 text-brand-600')}>
      {fix ? <Wrench className="h-[22px] w-[22px]" /> : <Sparkles className="h-[22px] w-[22px]" />}
    </span>
  );
}

function Row({ n, onOpen, last }: { n: ShownNote; onOpen: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className={cn('relative flex w-full items-center gap-3 px-3.5 py-2.5 text-start active:bg-page/50', !last && 'after:absolute after:bottom-0 after:end-0 after:start-[84px] after:h-px after:bg-page')}>
      <Thumb n={n} />
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-semibold text-ink-900">{n.title}</b>
        <span className="block truncate text-13 text-ink-400">{n.body}</span>
      </span>
      <ChevronLeft className="h-[18px] w-[18px] shrink-0 text-ink-300 ltr:rotate-180" />
    </button>
  );
}

export function WhatsNewWeeks({ releases }: { releases: WhatsNewRelease[] }) {
  const t = useTranslations('whatsNew');
  const weeks = weeksOf(releases).filter((w) => w.notes.length > 0);
  const [open, setOpen] = useState<ShownNote | null>(null);
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [openFixes, setOpenFixes] = useState<Set<string>>(new Set());
  const thisWeek = getPlanWeekStart(new Date());
  const toggle = (set: Set<string>, k: string, apply: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); apply(n); };

  if (weeks.length === 0) return <p className="px-4 py-8 text-center text-13 text-ink-400">{t('noReleases')}</p>;

  return (
    <div>
      {weeks.map((w, wi) => {
        const a = new Date(`${w.start}T12:00:00Z`); const b = new Date(a.getTime() + 6 * 86_400_000);
        const range = a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${dm(b)}` : `${dm(a)}–${dm(b)}`;
        const label = w.start === thisWeek ? t('weekThis') : w.start === addDaysToDateStr(thisWeek, -7) ? t('weekLast') : t('weekOf', { date: dm(a) });
        const features = w.notes.filter((n) => n.kind !== 'fix');
        const fixes = w.notes.filter((n) => n.kind === 'fix');
        const hero = features.find((n) => n.media) ?? null;
        const rows = features.filter((n) => n !== hero);
        const folded = wi > 0 && !openWeeks.has(w.start);
        if (folded) {
          return (
            <button key={w.start} type="button" onClick={() => toggle(openWeeks, w.start, setOpenWeeks)} className="mt-3 flex w-full items-center gap-2 rounded-2xl bg-card px-4 py-3.5 text-start">
              <b className="text-[15px] font-bold text-ink-900">{label}</b>
              <span className="flex-1 text-13 text-ink-400"><bdi dir="ltr">{range}</bdi> · {t('weekCount', { n: features.length })}</span>
              <ChevronDown className="h-4 w-4 text-ink-300" />
            </button>
          );
        }
        return (
          <section key={w.start} className={cn(wi > 0 && 'mt-6')}>
            <div className="flex items-baseline gap-2 px-1 pb-2">
              <b className="text-[15px] font-extrabold text-ink-900">{label}</b>
              <span className="text-13 text-ink-400"><bdi dir="ltr">{range}</bdi></span>
            </div>
            {hero && (
              <button type="button" onClick={() => setOpen(hero)} className="mb-3 block w-full overflow-hidden rounded-[26px] bg-card text-start">
                <DemoPhone src={media(hero)!} poster={poster(hero) ?? undefined} tint={0} height={300} phoneWidth={190} />
                <span className="block px-[18px] pb-4 pt-3.5">
                  <span className="text-xs font-extrabold text-brand-600">{t('heroKicker')}</span>
                  <b className="mt-0.5 block text-[19px] font-extrabold text-ink-900">{hero.title}</b>
                  <span className="mt-0.5 block line-clamp-2 text-13 text-ink-500">{hero.body}</span>
                </span>
              </button>
            )}
            {(rows.length > 0 || fixes.length > 0) && (
              <div className="overflow-hidden rounded-[20px] bg-card">
                {rows.map((n, k) => <Row key={n.id} n={n} onOpen={() => setOpen(n)} last={k === rows.length - 1 && fixes.length === 0} />)}
                {fixes.length > 0 && (
                  <>
                    <button type="button" onClick={() => toggle(openFixes, w.start, setOpenFixes)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start">
                      <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[14px] bg-ink-900/[0.05] text-ink-500"><Wrench className="h-[22px] w-[22px]" /></span>
                      <span className="min-w-0 flex-1">
                        <b className="block text-[15px] font-semibold text-ink-900">{t('fixesRow', { n: fixes.length })}</b>
                        <span className="block truncate text-13 text-ink-400">{fixes.slice(0, 2).map((n) => n.title).join(' · ')}</span>
                      </span>
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-300 transition-transform', openFixes.has(w.start) && 'rotate-180')} />
                    </button>
                    {openFixes.has(w.start) && (
                      <ul className="border-t border-page px-4 py-2">
                        {fixes.map((n) => <li key={n.id} className="py-1.5 text-13 leading-snug text-ink-700"><b className="font-semibold">{n.title}</b> — <span className="text-ink-500">{n.body}</span></li>)}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        );
      })}
      <p className="mt-6 text-center text-xs text-ink-400">{t('version', { v: APP_VERSION })}</p>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} title={open?.title ?? ''}>
        {open && (
          <div className="pb-2">
            {media(open) && <div className="overflow-hidden rounded-[24px]"><DemoPhone src={media(open)!} poster={poster(open) ?? undefined} tint={1} height={380} phoneWidth={220} /></div>}
            <p className="mt-3 text-[15px] leading-relaxed text-ink-700">{open.body}</p>
            {open.href && (
              <Link href={open.href} onClick={() => setOpen(null)} className="mt-4 flex h-[52px] w-full items-center justify-center rounded-2xl bg-ink-900 text-base font-bold text-white">
                {t('open')}
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
