'use client';

import type { PaceAdjust } from '@/lib/academy/pace-kinds';
import { useTranslations } from 'next-intl';
import { Minus, MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  centrePct, effortPace, fieldValue, isPureZone, toneOf, traineeRepsTone,
  type BookStep, type Effort, type FieldName, type FieldRef, type Length, type Tone,
} from '@/lib/academy/book-steps';
import { CARD, N, Stripe, clockText, kmText } from './ui';

// ── The steps as sentences (mockup phones 2, 2ב and 5) ───────────────────────────────────
//
// `חימום 2 ק״מ קל` · `5 × 1000 מ׳ ב־4:05` · `מנוחה 2:00 ג׳וג`. A coach reads a workout as
// sentences, so it is drawn as sentences; in the adjust screen every number in them is a
// control (blue, underlined), and the row whose number was tapped opens its − + in place —
// no dialog, which is option B's one good idea. A second tap on the same number opens the
// wheel, for the change too big to tap out.
//
// One rep block is two lines, the work and its recovery, because that is how the mockup and
// every coach writes it — the recovery is not a property buried inside the reps.

/** `glue`: no space after this part — `ב־` sits on its number. */
type Part = { text: string; glue?: boolean } | { field: FieldName; text: string };

interface Line {
  key: string;
  step: number;
  tone: Tone;
  /** What the line is, for the trainee variant's number and sub-line. */
  role: 'warmup' | 'main' | 'cooldown' | 'reps' | 'between' | 'rest' | 'hr';
  parts: Part[];
  /** The pace printed at the end of a read-only line. */
  pace: number | null;
  paceMuted: boolean;
}

function lengthText(length: Length, as: 'km' | 'metres' | 'rest', u: (k: string) => string): { value: string; unit: string } {
  if (length.measure === 'time') {
    if (as === 'rest') return { value: clockText(length.value), unit: '' };
    if (length.value >= 60 && length.value % 60 === 0) return { value: String(length.value / 60), unit: u('min') };
    if (length.value >= 60) return { value: clockText(length.value), unit: '' };
    return { value: String(length.value), unit: u('sec') };
  }
  if (as === 'km') return { value: kmText(length.value), unit: u('km') };
  return { value: String(length.value), unit: u('m') };
}

export function useStepLines() {
  const t = useTranslations('workoutBook');
  const u = (k: string) => t(`unit.${k}`);

  const effortWord = (effort: Effort | null) => (effort?.zone ? t(`zone.${effort.zone}`) : '');

  /** Every step as lines. `thresholdSec` null → efforts are shown as % of threshold. */
  return (steps: BookStep[], thresholdSec: number | null, { editable = false, adjust, trainee = false, zoneWords = false }: { editable?: boolean; adjust?: PaceAdjust | null; trainee?: boolean; zoneWords?: boolean } = {}): Line[] => {
    // `zoneWords`: a named zone nobody gave a pace says its word, not the pace it would be
    // at `thresholdSec` — the day session draws at a typical threshold, not anybody's own.
    const word = (effort: Effort | null) => zoneWords && isPureZone(effort);
    // …and a typed pace prints only its number: the zone nearest it at a typical threshold
    // (4:00 at 5:00 reads "ספרינט") describes nobody's effort.
    const typedOnly = (effort: Effort | null) => zoneWords && !!effort && !isPureZone(effort) && !!thresholdSec;
    const paceOf = (effort: Effort | null) => (effort && thresholdSec && !word(effort) ? effortPace(effort, thresholdSec, adjust) : null);
    const paceParts = (effort: Effort | null): Part[] => {
      if (!effort) return [];
      if (word(effort)) return [{ field: 'pace', text: effortWord(effort) }];
      if (!thresholdSec) {
        return [{ field: 'pace', text: `${Math.round(centrePct(effort.intensity))}%` }, { text: t('ofThreshold') }];
      }
      return [{ text: t('at'), glue: true }, { field: 'pace', text: clockText(effortPace(effort, thresholdSec, adjust)) }];
    };

    const lines: Line[] = [];
    steps.forEach((step, i) => {
      switch (step.kind) {
        case 'run': {
          const tone = toneOf(step.effort);
          const parts: Part[] = [];
          if (step.role !== 'main') parts.push({ text: t(`role.${step.role}`) });
          if (step.length) {
            const { value, unit } = lengthText(step.length, 'km', u);
            parts.push({ field: 'length', text: value });
            if (unit) parts.push({ text: unit });
          } else {
            parts.push({ text: t('open') });
          }
          // An easy run says `קל` and shows no pace in the sentence — the mockup's choice,
          // and the right one: nobody adjusts the jog to the second.
          const showPace = editable && tone !== 'e';
          if (showPace) parts.push(...paceParts(step.effort));
          else if (step.effort?.zone && !typedOnly(step.effort)) parts.push({ text: effortWord(step.effort) });
          lines.push({
            key: `${i}`, step: i, tone, parts, role: step.role === 'warmup' || step.role === 'cooldown' ? step.role : 'main',
            pace: paceOf(step.effort),
            paceMuted: tone === 'e',
          });
          break;
        }
        case 'reps': {
          // The trainee screens tone a rep faster than threshold as fast, and name it so
          // ("מהיר", never "סף" beside a full-brand stripe) — traineeRepsTone.
          const tone = trainee ? traineeRepsTone(step.effort) : toneOf(step.effort);
          const { value, unit } = lengthText(step.work, 'metres', u);
          const parts: Part[] = [
            { field: 'count', text: String(step.count) },
            { text: '×' },
            { field: 'length', text: value },
            ...(unit ? [{ text: unit }] : []),
          ];
          if (editable) parts.push(...paceParts(step.effort));
          else if (trainee && tone === 'f' && toneOf(step.effort) !== 'f') parts.push({ text: t('zone.interval') });
          else if (step.effort?.zone && !typedOnly(step.effort)) parts.push({ text: effortWord(step.effort) });
          lines.push({
            key: `${i}`, step: i, tone, parts, role: 'reps',
            pace: paceOf(step.effort),
            paceMuted: false,
          });
          if (step.rest) {
            const rest = lengthText(step.rest.length, 'rest', u);
            const restParts: Part[] = [{ text: t('role.rest') }, { field: 'rest', text: rest.value }];
            if (rest.unit) restParts.push({ text: rest.unit });
            if (step.rest.mode) restParts.push({ text: t(`mode.${step.rest.mode}`) });
            lines.push({ key: `${i}r`, step: i, tone: 'r', parts: restParts, role: 'between', pace: null, paceMuted: true });
          }
          break;
        }
        case 'rest': {
          const rest = lengthText(step.length, 'rest', u);
          const parts: Part[] = [{ text: t('role.rest') }, { field: 'length', text: rest.value }];
          if (rest.unit) parts.push({ text: rest.unit });
          if (step.mode) parts.push({ text: t(`mode.${step.mode}`) });
          lines.push({ key: `${i}`, step: i, tone: 'r', parts, role: 'rest', pace: null, paceMuted: true });
          break;
        }
        case 'hr':
          lines.push({
            key: `${i}`, step: i, tone: 't', pace: null, paceMuted: true, role: 'hr',
            parts: [
              { text: t('hr') },
              { field: 'hrMin', text: String(step.minPct) },
              { text: '–' },
              { field: 'hrMax', text: `${step.maxPct}%` },
              { field: 'length', text: String(Math.round(step.seconds / 60)) },
              { text: u('min') },
            ],
          });
          break;
      }
    });
    return lines;
  };
}

/**
 * The card of sentences.
 *
 * `selected` + `onTap` make it the adjust screen's control surface; without them it is the
 * read-only list of "הבנתי כך" and of the trainee's own workout, with the pace at the end.
 */
export function StepLines({
  steps, thresholdSec, paceAdjust, selected, onTap, onNudge, onStepMenu, rangeFor, trainee = false, zoneWords = false, className,
}: {
  /** A named zone with no pace given says its word (tappable when editable), not a pace. */
  zoneWords?: boolean;
  steps: BookStep[];
  thresholdSec: number | null;
  /**
   * The trainee experience's screen 4 (mockup trainee-experience-v2): numbered steps ("1 ·
   * חימום 2 ק״מ קל"), each with its one sub-line (how to run it, the watch range, "לאט ככל
   * שצריך"), the recovery said as "בין החזרות:", the brand ramp, and rows tight enough for
   * the whole screen to fit a phone. Read-only.
   */
  trainee?: boolean;
  /**
   * The range a WORK step carries on the watch (trainee-experience-v2 screen 4: "טווח
   * בשעון 4:01–4:09"), printed under work lines only — the warmup and the cooldown get a
   * wide range on the watch, but on the screen just their pace. Read-only lines only.
   */
  rangeFor?: (step: number, paceSec: number) => { min: number; max: number } | null;
  /** The coach's pace update in force for this trainee: the paces shown are the ones sent. */
  paceAdjust?: PaceAdjust | null;
  selected?: FieldRef | null;
  onTap?: (ref: FieldRef) => void;
  onNudge?: (ref: FieldRef, sign: 1 | -1) => void;
  /** The step's ⋯ — its sheet (type, measure, range, move, duplicate, delete, add after). */
  onStepMenu?: (step: number) => void;
  className?: string;
}) {
  const t = useTranslations('workoutBook');
  const tw = useTranslations('trainee.workout');
  const build = useStepLines();
  const editable = !!onTap;
  const lines = build(steps, thresholdSec, { editable, adjust: paceAdjust, trainee, zoneWords });
  // The trainee variant numbers every line but the recovery between reps.
  const numbers = new Map<string, number>();
  if (trainee) {
    let n = 0;
    for (const l of lines) if (l.role !== 'between') numbers.set(l.key, (n += 1));
  }
  const subOf = (line: Line): string | null => {
    if (!trainee) return null;
    if (line.role === 'warmup') return tw('stepSubWarmup');
    if (line.role === 'between' || line.role === 'rest') return tw('stepSubJog');
    return null;
  };

  return (
    <div className={cn(CARD, 'overflow-hidden', className)}>
      {lines.map(line => {
        const lineFields = line.parts.filter((p): p is Extract<Part, { field: FieldName }> => 'field' in p).map(p => p.field);
        // A rep line and its recovery line share a step; the field says which line it is.
        const isSelected = !!selected && selected.step === line.step && lineFields.includes(selected.field);
        return (
          <div
            key={line.key}
            className={cn(
              'flex items-center gap-2.5 border-b border-[#EFEFF4] px-4 last:border-0',
              trainee ? 'min-h-[44px] py-[7px] text-[15.5px] leading-[1.35]' : 'min-h-[51px] py-[11px] text-[17px] leading-[1.45]',
              trainee && line.role === 'reps' && 'bg-[#F5F6FF]',
              isSelected && 'bg-[#F7F8FF]',
            )}
          >
            <Stripe tone={line.tone} palette={trainee ? 'trainee' : undefined} />
            <div className={cn('min-w-0 flex-1 text-ink-900', trainee && 'font-bold')}>
              <span>
              {numbers.has(line.key) && <span><N>{numbers.get(line.key)}</N> · </span>}
              {trainee && line.role === 'between' && <span className="ms-3">{tw('stepBetween')} </span>}
              {(trainee && line.role === 'between' ? line.parts.slice(1) : line.parts).map((part, j, parts) => {
                const prev = parts[j - 1];
                const space = j > 0 && !(prev && 'glue' in prev && prev.glue) ? ' ' : '';
                // The `×` between two numbers gets air on both sides, so the count's tap
                // halo and the rep length's do not meet over it.
                if (!('field' in part)) {
                  return <span key={j}>{space}<span className={part.text === '×' && editable ? 'mx-1' : undefined}>{part.text}</span></span>;
                }
                if (!editable) {
                  return <span key={j}>{space}<N className="font-extrabold">{part.text}</N></span>;
                }
                const ref = { step: line.step, field: part.field };
                const on = !!selected && selected.step === ref.step && selected.field === ref.field;
                return (
                  <span key={j}>
                    {space}
                    <button
                      type="button"
                      onClick={() => onTap!(ref)}
                      aria-label={t('a11y.editNumber', { value: part.text })}
                      aria-pressed={on}
                      className={cn(
                        // The visible number stays the mockup's size; the after-element makes
                        // the tap target 48px (44 plus the probe's margin) without moving the
                        // sentence. A later number's halo paints over an earlier one's, so two
                        // numbers a `×` apart still each own the side facing the other.
                        'relative inline-block px-0.5 font-black text-brand-600 after:absolute after:left-1/2 after:top-1/2 after:h-12 after:w-[max(100%+8px,48px)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
                        on ? 'rounded-[7px] bg-brand-600 px-[7px] text-white' : 'border-b-[2.5px] border-brand-600',
                      )}
                    >
                      <N>{part.text}</N>
                    </button>
                  </span>
                );
              })}
              </span>
              {(() => {
                const work = !editable && rangeFor && line.pace !== null && line.tone !== 'e' && line.tone !== 'r' && !line.key.endsWith('r');
                const range = work ? rangeFor!(line.step, line.pace!) : null;
                if (range) {
                  return (
                    <small className="mt-px block text-[12.5px] font-normal leading-snug text-ink-400">
                      {tw.rich('watchRange', {
                        range: `${clockText(range.min)}–${clockText(range.max)}`,
                        m: (c) => <bdi dir="ltr">{c}</bdi>,
                        b: (c) => <b className="font-extrabold text-ink-900">{c}</b>,
                      })}
                    </small>
                  );
                }
                const sub = subOf(line);
                return sub ? <small className={cn('mt-px block text-[12.5px] font-normal leading-snug text-ink-400', line.role === 'between' && 'ms-3')}>{sub}</small> : null;
              })()}
            </div>
            {editable && isSelected && onNudge && selected && (
              <div className="flex shrink-0 gap-2.5">
                {([-1, 1] as const).map(sign => (
                  <button
                    key={sign}
                    type="button"
                    onClick={() => onNudge(selected, sign)}
                    aria-label={sign < 0 ? t('a11y.less') : t('a11y.more')}
                    className="relative grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[#EEF0FF] text-brand-600 after:absolute after:-inset-[5px] after:content-['']"
                  >
                    {sign < 0 ? <Minus className="h-5 w-5" strokeWidth={3} /> : <Plus className="h-5 w-5" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            )}
            {editable && onStepMenu && !(isSelected && onNudge) && !line.key.endsWith('r') && (
              <button
                type="button"
                onClick={() => onStepMenu(line.step)}
                aria-label={t('stepMenu.more')}
                className="relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-ink-400 after:absolute after:-inset-[5px] after:content-['']"
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </button>
            )}
            {!editable && line.pace !== null && (
              <N className={cn('shrink-0 whitespace-nowrap font-black', line.paceMuted ? 'font-bold text-ink-400' : 'text-ink-900')}>
                {clockText(line.pace)}
              </N>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The value a field shows in the quick row / the wheel. */
export function fieldDisplay(steps: BookStep[], ref: FieldRef, thresholdSec: number | null, adjust?: PaceAdjust | null): string {
  const value = fieldValue(steps, ref, thresholdSec, adjust);
  return value === null ? '—' : formatField(steps, ref, value, thresholdSec);
}

/** Any value of a field, in that field's own notation — the wheel's rows. */
export function formatField(steps: BookStep[], ref: FieldRef, value: number, thresholdSec: number | null): string {
  const step = steps[ref.step];
  switch (ref.field) {
    case 'count': return String(value);
    case 'pace': return thresholdSec ? clockText(value) : `${Math.round(value)}%`;
    case 'rest': return step?.kind === 'reps' && step.rest?.length.measure === 'distance' ? String(value) : clockText(value);
    case 'hrMin': case 'hrMax': return `${value}%`;
    case 'length': {
      if (step?.kind === 'hr') return String(Math.round(value / 60));
      const length = step?.kind === 'reps' ? step.work : step?.kind === 'run' ? step.length : step?.kind === 'rest' ? step.length : null;
      if (!length) return '—';
      if (length.measure === 'time') return value % 60 === 0 && step?.kind !== 'rest' ? String(value / 60) : clockText(value);
      return step?.kind === 'run' ? kmText(value) : String(value);
    }
  }
}

