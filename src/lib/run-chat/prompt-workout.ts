import Anthropic from '@anthropic-ai/sdk';
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
  durationSec: number,
): WorkoutSegment {
  if (segment.kind === 'recovery' || segment.kind === 'rest') {
    return {
      ...segment,
      durationSec,
      detail: `${Math.round(durationSec / 60)} min, הליכה`,
      note: segment.note || 'הליכה',
    };
  }
  return segment.steps
    ? {
        ...segment,
        steps: segment.steps.map((step) => updateNestedRecovery(step, durationSec)),
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
  const recoveryDurationSec = recoveryDurationFromPrompt(plannedText);
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
      return recoveryDurationSec
        ? updateNestedRecovery(paceGuarded, recoveryDurationSec)
        : paceGuarded;
    });

  guarded = groupRepeatedSegments(guarded, repetition);

  if (recoveryDurationSec) {
    guarded = guarded.map((segment) => {
      if (segment.kind !== 'repeat' || segment.steps?.some(
        (step) => step.kind === 'recovery' || step.kind === 'rest',
      )) {
        return segment;
      }
      return {
        ...segment,
        steps: [
          ...(segment.steps || []),
          {
            kind: 'recovery',
            label: LABELS.recovery,
            detail: `${Math.round(recoveryDurationSec / 60)} min, הליכה`,
            durationSec: recoveryDurationSec,
            note: 'הליכה',
          },
        ],
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
  const recoveryDurationSec = recoveryDurationFromPrompt(plannedText);
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
    const steps: WorkoutSegment[] = [
      {
        kind: 'interval',
        label: LABELS.interval,
        detail: `${formatDistance(repetition.distanceM)}, קצב מרתון`,
        distanceM: repetition.distanceM,
        note: /קצב\s+מרתון/i.test(plannedText) ? 'קצב מרתון' : undefined,
      },
    ];
    if (recoveryDurationSec) {
      steps.push({
        kind: 'recovery',
        label: LABELS.recovery,
        detail: `${Math.round(recoveryDurationSec / 60)} min, הליכה`,
        durationSec: recoveryDurationSec,
        note: 'הליכה',
      });
    }
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

export async function parsePromptWorkout(plannedText: string): Promise<PlannedWorkout> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPromptWorkout(plannedText);

  try {
    const response = await new Anthropic({ apiKey }).messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      system: `Extract a runnable workout into JSON. Return ONLY valid JSON with a title and segments.
Preserve every explicit distance, duration, repetition, recovery, and pace.
A repeated work step and its between-repetition recovery MUST be represented as one repeat segment:
{"kind":"repeat","reps":5,"steps":[{"kind":"interval",...},{"kind":"recovery",...}]}.
Never put reps on the interval itself. In Hebrew coach shorthand, "2 חימום" means a 2 km warmup unless a time unit is explicit.
Do not invent a cooldown or any other step that the coach did not request.`,
      messages: [
        {
          role: 'user',
          content:
            'Return {"title": string, "segments": [{"kind":"warmup"|"interval"|"recovery"|"cooldown"|"easy"|"rest"|"repeat","label"?:string,"detail"?:string,"reps"?:number,"distanceM"?:number,"durationSec"?:number,"targetPaceSec"?:number,"targetHrPct"?:number,"note"?:string,"steps"?:segment[]}]}. targetPaceSec is seconds per km. Workout: ' +
            plannedText,
        },
      ],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return parsePromptWorkoutJson(text, plannedText);
  } catch (error) {
    console.warn('Prompt workout parsing fell back to deterministic plan:', error);
    return fallbackPromptWorkout(plannedText);
  }
}
