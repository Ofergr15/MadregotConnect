import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import type { PlannedWorkout, WorkoutSegment } from './mock-workout';

interface ParsedSegment {
  kind: WorkoutSegment['kind'];
  label?: string;
  detail?: string;
  reps?: number;
  distanceM?: number;
  durationSec?: number;
  targetPaceSec?: number;
  targetHrPct?: number;
  note?: string;
  steps?: ParsedSegment[];
}

const SegmentSchema: z.ZodType<ParsedSegment> = z.lazy(() =>
  z.object({
    kind: z.enum([
      'warmup',
      'interval',
      'recovery',
      'cooldown',
      'easy',
      'rest',
      'repeat',
    ]),
    label: z.string().optional(),
    detail: z.string().optional(),
    reps: z.number().int().min(1).optional(),
    distanceM: z.number().optional(),
    durationSec: z.number().optional(),
    targetPaceSec: z.number().optional(),
    targetHrPct: z.number().optional(),
    note: z.string().optional(),
    steps: z.array(SegmentSchema).optional(),
  }),
);

const WorkoutSchema = z.object({
  title: z.string(),
  segments: z.array(SegmentSchema),
});

const LABELS: Record<WorkoutSegment['kind'], string> = {
  warmup: 'Warm Up',
  interval: 'Run',
  recovery: 'Recover',
  cooldown: 'Cool Down',
  easy: 'Easy Run',
  rest: 'Rest',
  repeat: 'Repeat',
};

function formatPace(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`;
}

function formatDistance(distanceM: number) {
  return distanceM >= 1000 && distanceM % 1000 === 0
    ? `${distanceM / 1000} km`
    : `${distanceM} m`;
}

function segmentDetail(segment: ParsedSegment, fallback: string) {
  if (segment.detail) return segment.detail;
  if (segment.kind === 'repeat' && segment.reps) return `${segment.reps} Times`;

  const details: string[] = [];
  if (segment.distanceM) details.push(formatDistance(segment.distanceM));
  if (segment.durationSec) details.push(`${Math.round(segment.durationSec / 60)} min`);
  if (segment.targetPaceSec) details.push(formatPace(segment.targetPaceSec));
  return details.join(', ') || segment.note || fallback;
}

function normalizeSegment(segment: ParsedSegment, plannedText: string): WorkoutSegment {
  return {
    ...segment,
    label: segment.label || LABELS[segment.kind],
    detail: segmentDetail(segment, plannedText),
    steps: segment.steps?.map((step) => normalizeSegment(step, plannedText)),
  };
}

function recoveryDurationFromPrompt(plannedText: string): number | undefined {
  if (/דקה\s+(?:של\s+)?הליכה/i.test(plannedText)) return 60;
  const minutes = plannedText.match(
    /(\d+(?:[.,]\d+)?)\s*(?:דקות?|דק['׳]?|minutes?|mins?)\s+(?:של\s+)?הליכה/i,
  );
  return minutes ? Number(minutes[1].replace(',', '.')) * 60 : undefined;
}

const RECOVERY_WORDS = /(לאט|קל(?:ה|ות)?|מנוחה|הליכה|ג['׳]?וג|jog|easy|slow|recovery|rest|walk)/i;

/**
 * Distance-based recovery: "1000 לאט", "1 ק"מ קל", "200 הליכה", "200m jog".
 * Bare numbers under 50 are kilometres (coach shorthand), otherwise metres.
 */
function recoveryDistanceFromPrompt(plannedText: string): number | undefined {
  const match = plannedText.match(
    new RegExp(
      `(\\d+(?:[.,]\\d+)?)\\s*(ק["״']?מ|km|מ(?:טר)?|m)?\\s*(?:של\\s+)?${RECOVERY_WORDS.source}`,
      'i',
    ),
  );
  if (!match) return undefined;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (match[2] || '').toLowerCase();
  const isKm = /ק|km/.test(unit) || (!unit && value < 50);
  return isKm ? value * 1000 : value;
}

type PromptRecovery = { durationSec?: number; distanceM?: number };

function recoveryFromPrompt(plannedText: string): PromptRecovery | undefined {
  const durationSec = recoveryDurationFromPrompt(plannedText);
  if (durationSec) return { durationSec };
  const distanceM = recoveryDistanceFromPrompt(plannedText);
  return distanceM ? { distanceM } : undefined;
}

function recoveryDetail(recovery: PromptRecovery, note: string) {
  if (recovery.durationSec) return `${Math.round(recovery.durationSec / 60)} min, ${note}`;
  return `${formatDistance(recovery.distanceM || 0)}, ${note}`;
}

function recoveryStep(recovery: PromptRecovery): WorkoutSegment {
  const note = recovery.durationSec ? 'הליכה' : 'קל';
  return {
    kind: 'recovery',
    label: LABELS.recovery,
    detail: recoveryDetail(recovery, note),
    durationSec: recovery.durationSec,
    distanceM: recovery.distanceM,
    note,
  };
}

function warmupDistanceFromPrompt(plannedText: string): number | undefined {
  const warmup = plannedText.match(
    /(\d+(?:[.,]\d+)?)\s*(?:(?:ק["״']?מ|km)\s*)?חימום/i,
  );
  return warmup ? Number(warmup[1].replace(',', '.')) * 1000 : undefined;
}

function repetitionFromPrompt(
  plannedText: string,
): { reps: number; distanceM: number } | undefined {
  const repetition = plannedText.match(
    /(\d+)\s*(?:×|x|X|כפול)\s*(\d+(?:[.,]\d+)?)\s*(?:מ(?:טר)?|m)?/i,
  );
  if (!repetition) return undefined;
  return {
    reps: Number(repetition[1]),
    distanceM: Number(repetition[2].replace(',', '.')),
  };
}

function updateNestedRecovery(
  segment: WorkoutSegment,
  recovery: PromptRecovery,
): WorkoutSegment {
  if (segment.kind === 'recovery' || segment.kind === 'rest') {
    const note = segment.note || (recovery.durationSec ? 'הליכה' : 'קל');
    return {
      ...segment,
      durationSec: recovery.durationSec,
      distanceM: recovery.distanceM,
      detail: recoveryDetail(recovery, note),
      note,
    };
  }
  return segment.steps
    ? {
        ...segment,
        steps: segment.steps.map((step) => updateNestedRecovery(step, recovery)),
      }
    : segment;
}

function removeInferredPace(
  segment: WorkoutSegment,
  plannedText: string,
  repetition: { reps: number; distanceM: number } | undefined,
): WorkoutSegment {
  const hasExplicitPace = /(?:@|בקצב\s*)?\d{1,2}:\d{2}/i.test(plannedText);
  const isRepeatedInterval =
    segment.kind === 'interval' &&
    repetition &&
    Math.abs((segment.distanceM ?? repetition.distanceM) - repetition.distanceM) < 1;

  if (isRepeatedInterval && !hasExplicitPace) {
    const paceNote = /קצב\s+מרתון/i.test(plannedText) ? 'קצב מרתון' : segment.note;
    return {
      ...segment,
      targetPaceSec: undefined,
      detail: [formatDistance(repetition.distanceM), paceNote].filter(Boolean).join(', '),
      note: paceNote,
    };
  }

  return segment.steps
    ? {
        ...segment,
        steps: segment.steps.map((step) =>
          removeInferredPace(step, plannedText, repetition),
        ),
      }
    : segment;
}

function groupRepeatedSegments(
  segments: WorkoutSegment[],
  repetition: { reps: number; distanceM: number } | undefined,
): WorkoutSegment[] {
  const withPromptReps = repetition
    ? segments.map((segment) =>
        segment.kind === 'interval' &&
        !segments.some((candidate) => candidate.kind === 'repeat') &&
        Math.abs((segment.distanceM ?? repetition.distanceM) - repetition.distanceM) < 1
          ? { ...segment, reps: segment.reps || repetition.reps }
          : segment,
      )
    : segments;

  const grouped: WorkoutSegment[] = [];
  for (let index = 0; index < withPromptReps.length; index += 1) {
    const segment = withPromptReps[index];
    if (segment.kind !== 'repeat' && segment.reps && segment.reps > 1) {
      const { reps, ...step } = segment;
      const steps: WorkoutSegment[] = [{ ...step, reps: undefined }];
      const recovery = withPromptReps[index + 1];
      if (recovery?.kind === 'recovery' || recovery?.kind === 'rest') {
        steps.push(recovery);
        index += 1;
      }
      grouped.push({
        kind: 'repeat',
        label: LABELS.repeat,
        detail: `${reps} Times`,
        reps,
        steps,
      });
    } else {
      grouped.push(segment);
    }
  }
  return grouped;
}

function applyPromptGuardrails(
  segments: WorkoutSegment[],
  plannedText: string,
): WorkoutSegment[] {
  const warmupDistanceM = warmupDistanceFromPrompt(plannedText);
  const recovery = recoveryFromPrompt(plannedText);
  const repetition = repetitionFromPrompt(plannedText);
  const mentionsCooldown = /שחרור|cool[\s-]?down/i.test(plannedText);

  let guarded = segments
    .filter((segment) => mentionsCooldown || segment.kind !== 'cooldown')
    .map((segment) => {
      if (segment.kind === 'warmup' && warmupDistanceM) {
        return {
          ...segment,
          distanceM: warmupDistanceM,
          durationSec: undefined,
          detail: formatDistance(warmupDistanceM),
        };
      }
      const paceGuarded = removeInferredPace(segment, plannedText, repetition);
      return recovery ? updateNestedRecovery(paceGuarded, recovery) : paceGuarded;
    });

  guarded = groupRepeatedSegments(guarded, repetition);

  if (recovery) {
    guarded = guarded.map((segment) => {
      if (segment.kind !== 'repeat' || segment.steps?.some(
        (step) => step.kind === 'recovery' || step.kind === 'rest',
      )) {
        return segment;
      }
      return {
        ...segment,
        steps: [...(segment.steps || []), recoveryStep(recovery)],
      };
    });
  }

  return guarded;
}

function workoutTitle(modelTitle: string, plannedText: string) {
  const repetition = repetitionFromPrompt(plannedText);
  if (!repetition || !/[\u0590-\u05FF]/.test(plannedText)) return modelTitle;
  const purpose = /קצב\s+מרתון/i.test(plannedText) ? ' קצב מרתון' : '';
  return `${repetition.reps}×${repetition.distanceM}${purpose}`;
}

export function parsePromptWorkoutJson(
  responseText: string,
  plannedText: string,
): PlannedWorkout {
  const json = responseText.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('No workout JSON found');
  const parsed = WorkoutSchema.parse(JSON.parse(json));
  const segments = parsed.segments.map((segment) =>
    normalizeSegment(segment, plannedText),
  );
  return {
    title: workoutTitle(parsed.title, plannedText),
    prompt: plannedText,
    segments: applyPromptGuardrails(segments, plannedText),
  };
}

export function fallbackPromptWorkout(plannedText: string): PlannedWorkout {
  const warmupDistanceM = warmupDistanceFromPrompt(plannedText);
  const repetition = repetitionFromPrompt(plannedText);
  const recovery = recoveryFromPrompt(plannedText);
  const segments: WorkoutSegment[] = [];

  if (warmupDistanceM) {
    segments.push({
      kind: 'warmup',
      label: LABELS.warmup,
      detail: formatDistance(warmupDistanceM),
      distanceM: warmupDistanceM,
    });
  }

  if (repetition) {
    const marathonPace = /קצב\s+מרתון/i.test(plannedText);
    const steps: WorkoutSegment[] = [
      {
        kind: 'interval',
        label: LABELS.interval,
        detail: [formatDistance(repetition.distanceM), marathonPace ? 'קצב מרתון' : null]
          .filter(Boolean)
          .join(', '),
        distanceM: repetition.distanceM,
        note: marathonPace ? 'קצב מרתון' : undefined,
      },
    ];
    if (recovery) steps.push(recoveryStep(recovery));
    segments.push({
      kind: 'repeat',
      label: LABELS.repeat,
      detail: `${repetition.reps} Times`,
      reps: repetition.reps,
      steps,
    });
  }

  if (segments.length) {
    return {
      title: workoutTitle(plannedText, plannedText),
      prompt: plannedText,
      segments,
    };
  }

  const distanceMatch = plannedText.match(/(\d+(?:[.,]\d+)?)\s*(?:km|ק["״']?מ)/i);
  const distanceKm = distanceMatch ? Number(distanceMatch[1].replace(',', '.')) : null;
  const isEasy = /easy|קל(?:ה)?/i.test(plannedText);
  const kind: WorkoutSegment['kind'] = isEasy ? 'easy' : 'interval';
  return {
    title: isEasy && distanceKm ? `ריצה קלה ${distanceKm} ק״מ` : plannedText,
    prompt: plannedText,
    segments: [
      {
        kind,
        label: LABELS[kind],
        detail: distanceKm ? `${distanceKm} km${isEasy ? ', קל' : ''}` : plannedText,
        ...(distanceKm ? { distanceM: distanceKm * 1000 } : {}),
        ...(isEasy ? { note: 'קל' } : {}),
      },
    ],
  };
}

const PROMPT_PARSE_SYSTEM = `Extract a runnable workout into JSON. Return ONLY valid JSON with a title and segments.
Preserve every explicit distance, duration, repetition, recovery, and pace.
A repeated work step and its between-repetition recovery MUST be represented as one repeat segment:
{"kind":"repeat","reps":5,"steps":[{"kind":"interval",...},{"kind":"recovery",...}]}.
Never put reps on the interval itself. In Hebrew coach shorthand, "2 חימום" means a 2 km warmup unless a time unit is explicit.
Do not invent a cooldown or any other step that the coach did not request.`;

const PROMPT_PARSE_USER =
  'Return {"title": string, "segments": [{"kind":"warmup"|"interval"|"recovery"|"cooldown"|"easy"|"rest"|"repeat","label"?:string,"detail"?:string,"reps"?:number,"distanceM"?:number,"durationSec"?:number,"targetPaceSec"?:number,"targetHrPct"?:number,"note"?:string,"steps"?:segment[]}]}. targetPaceSec is seconds per km. Workout: ';

export async function parsePromptWorkout(plannedText: string): Promise<PlannedWorkout> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return fallbackPromptWorkout(plannedText);

  try {
    let text = '';
    if (openaiKey) {
      const model = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
      const response = await new OpenAI({ apiKey: openaiKey }).chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROMPT_PARSE_SYSTEM },
          { role: 'user', content: PROMPT_PARSE_USER + plannedText },
        ],
        ...(model.startsWith('gpt-5.') ? { reasoning_effort: 'none' as const } : {}),
      });
      text = response.choices[0]?.message?.content || '';
    } else {
      const response = await new Anthropic({ apiKey: anthropicKey }).messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1400,
        system: PROMPT_PARSE_SYSTEM,
        messages: [{ role: 'user', content: PROMPT_PARSE_USER + plannedText }],
      });
      text = response.content[0].type === 'text' ? response.content[0].text : '';
    }
    return parsePromptWorkoutJson(text, plannedText);
  } catch (error) {
    console.warn('Prompt workout parsing fell back to deterministic plan:', error);
    return fallbackPromptWorkout(plannedText);
  }
}
