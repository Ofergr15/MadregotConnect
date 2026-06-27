import Anthropic from '@anthropic-ai/sdk';
import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from './types';
import { WORKOUT_PARSER_SYSTEM_PROMPT } from './prompt';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// --- Claude AI parser (for images/PDFs, or complex text fallback) ---

function validateAndFixStep(step: WorkoutStep): WorkoutStep {
  const fixed = { ...step };

  if (fixed.durationType === 'time' && fixed.durationValue) {
    // If "time" value >= 1000, it's almost certainly meters (distance), not seconds
    // 1000 seconds = 16+ minutes is possible, but 1000m warmup is far more common
    // Check context: warmup steps with high "time" values are always distance
    if (fixed.durationValue >= 1000 && (fixed.type === 'warmup' || fixed.type === 'active' || fixed.type === 'interval')) {
      fixed.durationType = 'distance';
    }
  }

  if (fixed.durationType === 'time' && fixed.durationValue) {
    // Values like 200, 400, 800 with a pace target are almost certainly distance (meters)
    if ([200, 400, 800].includes(fixed.durationValue) && fixed.targetType === 'pace') {
      fixed.durationType = 'distance';
    }
  }

  if (fixed.durationType === 'open' && fixed.durationValue) {
    // If there's a durationValue but type is "open", fix it
    if (fixed.durationValue >= 1000) {
      fixed.durationType = 'distance';
    } else {
      fixed.durationType = 'time';
    }
  }

  if (fixed.repeatSteps) {
    fixed.repeatSteps = fixed.repeatSteps.map(validateAndFixStep);
  }

  return fixed;
}

function validatePlan(plan: ParsedWeeklyPlan): ParsedWeeklyPlan {
  return {
    workouts: plan.workouts.map(workout => ({
      ...workout,
      steps: workout.steps.map(validateAndFixStep),
    })),
  };
}

async function parseWithClaude(content: Anthropic.MessageCreateParams['messages'][0]['content'], useVision = false): Promise<ParsedWeeklyPlan> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: WORKOUT_PARSER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = cleaned.indexOf('{');
  if (jsonStart > 0) cleaned = cleaned.slice(jsonStart);

  const parsed = JSON.parse(cleaned);
  if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
    throw new Error('Invalid response structure');
  }
  return validatePlan(parsed as ParsedWeeklyPlan);
}

// --- Regex parser (for simple text inputs, zero cost) ---

const DAY_MAP: Record<string, number> = {
  'ראשון': 0, 'יום ראשון': 0, 'sunday': 0,
  'שני': 1, 'יום שני': 1, 'monday': 1,
  'שלישי': 2, 'יום שלישי': 2, 'tuesday': 2,
  'רביעי': 3, 'יום רביעי': 3, 'wednesday': 3,
  'חמישי': 4, 'יום חמישי': 4, 'thursday': 4,
  'שישי': 5, 'יום שישי': 5, 'friday': 5,
  'שבת': 6, 'saturday': 6,
};

function parsePace(paceStr: string): number {
  const match = paceStr.match(/(\d+):(\d+)/);
  if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
  return 0;
}

function parsePaceRange(str: string): { min: number; max: number } | null {
  const rangeMatch = str.match(/(\d+:\d+)\s*[-–]\s*(\d+:\d+)/);
  if (rangeMatch) {
    return { min: parsePace(rangeMatch[1]), max: parsePace(rangeMatch[2]) };
  }
  const singleMatch = str.match(/(\d+:\d+)/);
  if (singleMatch) {
    const p = parsePace(singleMatch[1]);
    return { min: p - 5, max: p + 5 };
  }
  return null;
}

function parseDistance(str: string): number | null {
  const kmMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:km|קמ|ק"מ|ק״מ|קילומטר)/i);
  if (kmMatch) return parseFloat(kmMatch[1]) * 1000;
  const mMatch = str.match(/(\d+)\s*(?:m(?=[^a-z]|$)|מטר|מ'|מ(?=\s|$))/i);
  if (mMatch) {
    const val = parseInt(mMatch[1]);
    if (val >= 100) return val;
  }
  return null;
}

function parseTime(str: string): number | null {
  const minMatch = str.match(/(\d+)\s*(?:דקות|דק|min|minutes)/i);
  if (minMatch) return parseInt(minMatch[1]) * 60;
  const secMatch = str.match(/(\d+)\s*(?:שניות|שנ|sec|seconds|s\b)/i);
  if (secMatch) return parseInt(secMatch[1]);
  const mmssMatch = str.match(/^(\d+):(\d+)$/);
  if (mmssMatch) return parseInt(mmssMatch[1]) * 60 + parseInt(mmssMatch[2]);
  return null;
}

function detectWorkoutType(text: string): string {
  const lower = text.toLowerCase();
  if (/אינטרוול|interval|x\s*\(|פעמים/.test(lower)) return 'Interval Session';
  if (/ארוכה|long run/.test(lower)) return 'Long Run';
  if (/טמפו|tempo/.test(lower)) return 'Tempo Run';
  if (/שחרור|easy|קלה/.test(lower)) return 'Easy Run';
  if (/מתגברת|progressive/.test(lower)) return 'Progressive Run';
  if (/fartlek|פרטלק/.test(lower)) return 'Fartlek';
  return 'Workout';
}

function stripBracketPaces(str: string): string {
  return str.replace(/\(\(.*?\)\)/g, '').replace(/\([\d:]+\)/g, '').trim();
}

function parseSegment(segment: string, orderStart: number): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  let order = orderStart;
  const cleaned = stripBracketPaces(segment.trim());

  const repeatMatch = cleaned.match(/(\d+)\s*(?:x|פעמים|×)\s*[\(]?(.+?)[\)]?\s*$/i);
  if (repeatMatch) {
    const count = parseInt(repeatMatch[1]);
    const inner = repeatMatch[2];
    const parts = inner.split(/\s*[+,]\s*/).filter(Boolean);
    const repeatSteps: WorkoutStep[] = [];
    let subOrder = 1;

    for (const part of parts) {
      const pace = parsePaceRange(part);
      const dist = parseDistance(part);
      const time = parseTime(part);
      const isRest = /מנוחה|rest|הליכה|walk|recovery/.test(part);

      repeatSteps.push({
        order: subOrder++,
        type: isRest ? 'rest' : 'interval',
        durationType: dist ? 'distance' : time ? 'time' : 'open',
        durationValue: dist || time || undefined,
        targetType: pace ? 'pace' : 'no_target',
        targetPaceMinPerKm: pace?.min,
        targetPaceMaxPerKm: pace?.max,
      });
    }

    if (repeatSteps.length === 1 && repeatSteps[0].type === 'interval') {
      repeatSteps.push({
        order: subOrder,
        type: 'rest',
        durationType: 'time',
        durationValue: 90,
        targetType: 'no_target',
      });
    }

    steps.push({
      order: order++,
      type: 'interval',
      durationType: repeatSteps[0]?.durationType || 'open',
      durationValue: repeatSteps[0]?.durationValue,
      targetType: 'pace',
      repeatCount: count,
      repeatSteps,
    });

    return steps;
  }

  const isWarmup = /חימום|warmup|warm up|wu|ווארם/i.test(cleaned);
  const isCooldown = /צינון|cooldown|cool down|cd|קולדאון/i.test(cleaned);
  const isRest = /מנוחה|rest|הליכה|walk/i.test(cleaned);
  const isEasy = /שחרור|easy|קלה|recovery/i.test(cleaned);

  const pace = parsePaceRange(cleaned);
  const dist = parseDistance(cleaned);
  const time = parseTime(cleaned);

  let type: WorkoutStep['type'] = 'active';
  if (isWarmup) type = 'warmup';
  else if (isCooldown) type = 'cooldown';
  else if (isRest) type = 'rest';

  let targetZone: string | undefined;
  if (isEasy || isWarmup || isCooldown) targetZone = 'easy';
  if (/טמפו|tempo/.test(cleaned)) targetZone = 'tempo';
  if (/סף|threshold/.test(cleaned)) targetZone = 'threshold';
  if (/מרתון|marathon|mp/.test(cleaned)) targetZone = 'marathon_pace';

  steps.push({
    order,
    type,
    durationType: dist ? 'distance' : time ? 'time' : 'open',
    durationValue: dist || time || undefined,
    targetType: pace ? 'pace' : targetZone ? 'pace' : 'no_target',
    targetZone: !pace ? targetZone : undefined,
    targetPaceMinPerKm: pace?.min,
    targetPaceMaxPerKm: pace?.max,
  });

  return steps;
}

function parseDayWorkout(dayText: string, dayOfWeek: number): ParsedWorkout {
  const segments = dayText.split(/,\s*(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  const steps: WorkoutStep[] = [];
  let order = 1;

  for (const seg of segments) {
    const parsed = parseSegment(seg, order);
    for (const s of parsed) {
      s.order = order++;
      steps.push(s);
    }
  }

  const hasWarmup = steps.some(s => s.type === 'warmup');
  const hasCooldown = steps.some(s => s.type === 'cooldown');
  const hasInterval = steps.some(s => s.repeatCount || s.type === 'interval');

  if (hasInterval && !hasWarmup) {
    steps.unshift({ order: 0, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy' });
  }
  if (hasInterval && !hasCooldown) {
    steps.push({ order: steps.length + 1, type: 'cooldown', durationType: 'distance', durationValue: 1500, targetType: 'pace', targetZone: 'easy' });
  }

  steps.forEach((s, i) => { s.order = i + 1; });
  return { dayOfWeek, name: detectWorkoutType(dayText), steps };
}

function splitIntoDays(text: string): { day: number; content: string }[] {
  const results: { day: number; content: string }[] = [];
  const dayPattern = new RegExp(`(${Object.keys(DAY_MAP).join('|')})\\s*[-–:]\\s*`, 'gi');
  const parts = text.split(dayPattern).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const normalized = parts[i].trim().replace(/^יום\s*/, '');
    const dayNum = DAY_MAP[normalized] ?? DAY_MAP[normalized.toLowerCase()];
    if (dayNum !== undefined && i + 1 < parts.length) {
      results.push({ day: dayNum, content: parts[i + 1].trim() });
      i++;
    }
  }

  if (results.length === 0 && text.trim()) {
    // Default to today's day (0=Sunday, 1=Monday, etc.)
    const dayOfWeek = new Date().getDay();
    results.push({ day: dayOfWeek, content: text.trim() });
  }

  return results;
}

function parseWithRegex(text: string): ParsedWeeklyPlan | null {
  try {
    const days = splitIntoDays(text);
    if (days.length === 0) return null;

    const workouts: ParsedWorkout[] = [];
    for (const { day, content } of days) {
      if (content.trim()) {
        const workout = parseDayWorkout(content, day);
        if (workout.steps.length > 0) workouts.push(workout);
      }
    }

    return workouts.length > 0 ? { workouts } : null;
  } catch {
    return null;
  }
}

// --- Main entry point ---

export async function parseWorkoutPlan(input: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}): Promise<ParsedWeeklyPlan> {
  // Images/PDFs always go to Claude (vision needed)
  if (input.imageBase64 && input.imageMediaType) {
    const isPdf = input.imageMediaType === 'application/pdf';
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    if (isPdf) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.imageBase64 },
      } as any);
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.imageMediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: input.imageBase64,
        },
      });
    }

    content.push({
      type: 'text',
      text: input.text
        ? `Here is the training plan document/image. Also, the coach provided this text:\n\n${input.text}\n\nParse all workouts from both the document and the text.`
        : 'Parse this training plan into structured workouts. Extract every day and every workout detail.',
    });

    return parseWithClaude(content, true);
  }

  // Text: try regex first (free), fall back to Claude Haiku if regex fails
  if (input.text?.trim()) {
    const regexResult = parseWithRegex(input.text);
    if (regexResult) return regexResult;

    // Regex couldn't handle it — use Claude Haiku
    return parseWithClaude([{ type: 'text', text: `Parse this training plan:\n\n${input.text}` }], false);
  }

  throw new Error('Either text or image must be provided');
}
