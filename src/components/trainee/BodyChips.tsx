'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { fmtSleep } from '@/lib/academy/normal-range';
import type { BodyChip } from '@/lib/academy/trainee-today';
import type { MetricMissing } from '@/lib/academy/normal-range';
import { traineeProgressUrl } from '@/lib/academy/deep-links';
import { RICH, SHADOW, Tag, dm, type TagTone } from './ui';

// ── Sleep and resting HR against the trainee's OWN range (mockup 1 / 1ב / 1ג) ───────────
//
// The value, ✓ or ▲, and the range it is judged against ("הטווח שלך 46–50") — or, until 14
// nights are in, "לומד אותך, עוד N לילות". A night that is not this morning's says which
// night it is. Each chip opens the body screen (8).

const TONE: Record<string, TagTone> = {
  normal: 'g', more: 'g', low: 'g', less: 'w', veryLittle: 'w', bitHigh: 'w', high: 'w',
};

function Chip({ kind, chip, today, partial }: { kind: 'sleep' | 'rhr'; chip: BodyChip; today: string; partial?: boolean }) {
  const t = useTranslations('trainee');
  const value = kind === 'sleep' ? fmtSleep(chip.value) : String(chip.value);
  const range = chip.range
    ? kind === 'sleep' ? `${fmtSleep(chip.range.lo)}–${fmtSleep(chip.range.hi)}` : `${chip.range.lo}–${chip.range.hi}`
    : null;
  const yesterday = chip.date !== today;
  return (
    <Link
      href={traineeProgressUrl('body')}
      className={cn('min-h-[56px] flex-1 rounded-2xl bg-white px-3 py-2.5 leading-snug', SHADOW)}
    >
      {/* The badge sits in the title row on both tiles (mockup 1), never wrapped above the
          number: the label gives way first. */}
      <span className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate whitespace-nowrap text-[12.5px] font-bold text-ink-400">{t(`home.body.${kind}`)}</span>
        {chip.verdict && <span className="shrink-0"><Tag tone={TONE[chip.verdict] ?? 'n'}>{t(`range.${kind}.${chip.verdict}` as never)}</Tag></span>}
      </span>
      <b className="block text-[17px] font-black text-ink-900">
        <bdi dir="ltr">{value}</bdi>
        {yesterday && <small className="ms-1.5 text-[11.5px] font-bold text-ink-400">{t.rich('home.body.on', { ...RICH, date: dm(chip.date) })}</small>}
      </b>
      <small className="mt-0.5 block text-[11.5px] text-ink-400">
        {partial
          ? t('home.body.missing.partial')
          : chip.learning != null
          ? t.rich('range.learning', { ...RICH, n: chip.learning })
          : chip.verdict === 'normal'
            ? t('home.body.inRange')
            : range ? t.rich('range.yours', { ...RICH, range }) : null}
      </small>
    </Link>
  );
}

/** The sentence for an empty (or unjudged) slot — what is missing and what will bring it. */
export function missingText(t: ReturnType<typeof useTranslations>, kind: 'sleep' | 'rhr', m: MetricMissing): { title: React.ReactNode; sub: React.ReactNode | null } {
  switch (m.reason) {
    case 'noGarmin': return { title: t('trainee.home.body.missing.noGarmin'), sub: t('trainee.home.body.missing.noGarminSub') };
    case 'neverWorn': return { title: t('trainee.home.body.missing.neverWorn'), sub: t('trainee.home.body.missing.neverWornSub') };
    case 'notMeasured': return { title: t('trainee.home.body.missing.notMeasured', { kind }), sub: null };
    case 'old': return { title: t.rich('trainee.home.body.missing.old', { ...RICH, date: dm(m.date) }), sub: null };
    case 'partial': return { title: t('trainee.home.body.missing.partial'), sub: null };
    case 'feed':
      return m.feed === 'failed'
        ? { title: t('trainee.home.body.missing.feedFailed'), sub: null }
        : { title: t.rich('trainee.home.body.missing.feedStale', { ...RICH, n: m.days ?? 0 }), sub: null };
  }
}

/** A slot whose value is missing: the metric's name and why, never a vanished tile. */
function MissingChip({ kind, missing, wide }: { kind: 'sleep' | 'rhr' | 'both'; missing: MetricMissing; wide?: boolean }) {
  const t = useTranslations('trainee');
  const tr = useTranslations();
  const text = missingText(tr, kind === 'both' ? 'sleep' : kind, missing);
  return (
    <Link
      href={traineeProgressUrl('body')}
      className={cn('min-h-[56px] rounded-2xl bg-white px-3 py-2.5 leading-snug', SHADOW, wide ? 'w-full' : 'flex-1')}
    >
      <span className="block truncate whitespace-nowrap text-[12.5px] font-bold text-ink-400">
        {kind === 'both' ? `${t('home.body.sleep')} · ${t('home.body.rhr')}` : t(`home.body.${kind}`)}
      </span>
      <b className="block text-[13.5px] font-extrabold leading-snug text-ink-900">{text.title}</b>
      {text.sub && <small className="mt-0.5 block text-[11.5px] text-ink-400">{text.sub}</small>}
    </Link>
  );
}

/** One reason for both slots (no Garmin, never worn, a broken connection): one wide card. */
const SHARED = new Set(['noGarmin', 'neverWorn', 'feed']);

export function BodyChips({ sleep, rhr, missing, today }: {
  sleep: BodyChip | null;
  rhr: BodyChip | null;
  missing?: { sleep: MetricMissing | null; rhr: MetricMissing | null };
  today: string;
}) {
  const t = useTranslations('trainee.home.body');
  const ms = missing?.sleep ?? null;
  const mr = missing?.rhr ?? null;
  if (!sleep && !rhr && !ms && !mr) return null;
  if (!sleep && !rhr && ms && mr && ms.reason === mr.reason && SHARED.has(ms.reason)) {
    return <div aria-label={t('label')} role="group"><MissingChip kind="both" missing={ms} wide /></div>;
  }
  return (
    <div className="flex gap-2" aria-label={t('label')} role="group">
      {sleep ? <Chip kind="sleep" chip={sleep} today={today} partial={ms?.reason === 'partial'} /> : ms ? <MissingChip kind="sleep" missing={ms} /> : null}
      {rhr ? <Chip kind="rhr" chip={rhr} today={today} /> : mr ? <MissingChip kind="rhr" missing={mr} /> : null}
    </div>
  );
}
