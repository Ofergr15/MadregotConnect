'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { fmtSleep } from '@/lib/academy/normal-range';
import type { BodyChip } from '@/lib/academy/trainee-today';
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

function Chip({ kind, chip, today }: { kind: 'sleep' | 'rhr'; chip: BodyChip; today: string }) {
  const t = useTranslations('trainee');
  const value = kind === 'sleep' ? fmtSleep(chip.value) : String(chip.value);
  const range = chip.range
    ? kind === 'sleep' ? `${fmtSleep(chip.range.lo)}–${fmtSleep(chip.range.hi)}` : `${chip.range.lo}–${chip.range.hi}`
    : null;
  const yesterday = chip.date !== today;
  return (
    <Link
      href={traineeProgressUrl('body')}
      className={cn('min-h-[56px] flex-1 rounded-2xl bg-white px-3 py-2.5', SHADOW)}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="text-[12.5px] font-bold text-ink-400">{t(`home.body.${kind}`)}</span>
        {chip.verdict && <Tag tone={TONE[chip.verdict] ?? 'n'}>{t(`range.${kind}.${chip.verdict}` as never)}</Tag>}
      </span>
      <b className="block text-[17px] font-black text-ink-900">
        <bdi dir="ltr">{value}</bdi>
        {yesterday && <small className="ms-1.5 text-[11.5px] font-bold text-ink-400">{t.rich('home.body.on', { ...RICH, date: dm(chip.date) })}</small>}
      </b>
      <small className="mt-0.5 block text-[11.5px] text-ink-400">
        {chip.learning != null
          ? t.rich('range.learning', { ...RICH, n: chip.learning })
          : chip.verdict === 'normal'
            ? t('home.body.inRange')
            : range ? t.rich('range.yours', { ...RICH, range }) : null}
      </small>
    </Link>
  );
}

export function BodyChips({ sleep, rhr, today }: { sleep: BodyChip | null; rhr: BodyChip | null; today: string }) {
  const t = useTranslations('trainee.home.body');
  if (!sleep && !rhr) return null;
  return (
    <div className="flex gap-2" aria-label={t('label')} role="group">
      {sleep && <Chip kind="sleep" chip={sleep} today={today} />}
      {rhr && <Chip kind="rhr" chip={rhr} today={today} />}
    </div>
  );
}
