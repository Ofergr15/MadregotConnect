'use client';

import type { PaceAdjust } from '@/lib/academy/pace-kinds';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  centrePct, effortPace, fieldValue, toneOf,
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
  return (steps: BookStep[], thresholdSec: number | null, { editable = false, adjust }: { editable?: boolean; adjust?: PaceAdjust | null } = {}): Line[] => {
    const paceParts = (effort: Effort | null): Part[] => {
      if (!effort) return [];
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
          else if (step.effort?.zone) parts.push({ text: effortWord(step.effort) });
          lines.push({
            key: `${i}`, step: i, tone, parts,
            pace: step.effort && thresholdSec ? effortPace(step.effort, thresholdSec, adjust) : null,
            paceMuted: tone === 'e',
          });
          break;
        }
        case 'reps': {
          const tone = toneOf(step.effort);
          const { value, unit } = lengthText(step.work, 'metres', u);
          const parts: Part[] = [
            { field: 'count', text: String(step.count) },
            { text: '×' },
            { field: 'length', text: value },
            ...(unit ? [{ text: unit }] : []),
          ];
          if (editable) parts.push(...paceParts(step.effort));
          else if (step.effort?.zone) parts.push({ text: effortWord(step.effort) });
          lines.push({
            key: `${i}`, step: i, tone, parts,
            pace: step.effort && thresholdSec ? effortPace(step.effort, thresholdSec, adjust) : null,
            paceMuted: false,
          });
          if (step.rest) {
            const rest = lengthText(step.rest.length, 'rest', u);
            const restParts: Part[] = [{ text: t('role.rest') }, { field: 'rest', text: rest.value }];
            if (rest.unit) restParts.push({ text: rest.unit });
            if (step.rest.mode) restParts.push({ text: t(`mode.${step.rest.mode}`) });
            lines.push({ key: `${i}r`, step: i, tone: 'r', parts: restParts, pace: null, paceMuted: true });
          }
          break;
        }
        case 'rest': {
          const rest = lengthText(step.length, 'rest', u);
          const parts: Part[] = [{ text: t('role.rest') }, { field: 'length', text: rest.value }];
          if (rest.unit) parts.push({ text: rest.unit });
          if (step.mode) parts.push({ text: t(`mode.${step.mode}`) });
          lines.push({ key: `${i}`, step: i, tone: 'r', parts, pace: null, paceMuted: true });
          break;
        }
        case 'hr':
          lines.push({
            key: `${i}`, step: i, tone: 't', pace: null, paceMuted: true,
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
  steps, thresholdSec, paceAdjust, selected, onTap, onNudge, className,
}: {
  steps: BookStep[];
  thresholdSec: number | null;
  /** The coach's pace update in force for this trainee: the paces shown are the ones sent. */
  paceAdjust?: PaceAdjust | null;
  selected?: FieldRef | null;
  onTap?: (ref: FieldRef) => void;
  onNudge?: (ref: FieldRef, sign: 1 | -1) => void;
  className?: string;
}) {
  const t = useTranslations('workoutBook');
  const build = useStepLines();
  const editable = !!onTap;
  const lines = build(steps, thresholdSec, { editable, adjust: paceAdjust });

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
              'flex min-h-[51px] items-center gap-2.5 border-b border-[#EFEFF4] px-4 py-[11px] text-[17px] leading-[1.45] last:border-0',
              isSelected && 'bg-[#F7F8FF]',
            )}
          >
            <Stripe tone={line.tone} />
            <div className="min-w-0 flex-1 text-ink-900">
              {line.parts.map((part, j) => {
                const prev = line.parts[j - 1];
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
