import Anthropic from '@anthropic-ai/sdk';
import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from './types';
import { WORKOUT_PARSER_SYSTEM_PROMPT } from './prompt';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// --- Claude AI parser (for images/PDFs, or complex text fallback) ---

// Time units the coach uses in notes (Hebrew + English). Presence of these is a
// strong signal that a duration is genuinely time-based, not a distance.
const TIME_UNIT_RE = /דקות|דק['׳]|שנ['׳]|שניות|שעות|שעה|\bmin\b|minute|\bhour\b|\bhr\b/i;
// Distance units.
const DIST_UNIT_RE = /ק["״']?\s*מ|קמ|קילומטר|\bkm\b|kilometer|מטר|מ['׳]/i;

/**
 * The coach's notes are the source of truth for pace (the prompt tells the model
 * to preserve them character-for-character). The model sometimes writes a
 * slightly-off NUMBER into targetPace* while keeping the right text in notes
 * (e.g. notes "4:40 – 5:30" but targetPaceMin 270 = 4:30). Re-derive the Group ❶
 * pace from the leading pace token in the notes so the chip matches the notes.
 *
 * Returns null when the notes have no explicit leading pace (walk/effort/All-out).
 */
export function paceFromNotes(notes: string | undefined): { min: number; max: number } | null {
  if (!notes) return null;
  // Only look at the Group ❶ segment — the text BEFORE any "(...)" bracket,
  // which holds the fastest group's pace in this coach's notation.
  const head = notes.split('(')[0];
  const toSec = (p: string) => {
    const m = p.match(/(\d+):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const range = head.match(/(\d+:\d{2})\s*[-–]\s*(\d+:\d{2})/);
  if (range) {
    const a = toSec(range[1]);
    const b = toSec(range[2]);
    if (a == null || b == null) return null;
    // Normalize so min = faster (smaller sec/km), regardless of written order
    // (the coach writes recovery ranges high-to-low, e.g. "4:10-4:00").
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = head.match(/(\d+:\d{2})/);
  if (single) {
    const s = toSec(single[1]);
    if (s == null) return null;
    return { min: s, max: s };
  }
  return null;
}

function validateAndFixStep(step: WorkoutStep): WorkoutStep {
  const fixed = { ...step };

  // Skip duration validation for repeat parent steps — they don't need a duration
  if (fixed.repeatCount && fixed.repeatSteps) {
    fixed.repeatSteps = fixed.repeatSteps.map(validateAndFixStep);
    return fixed;
  }

  // Reconcile the Group ❶ pace with the notes (notes win). Only for steps that
  // ALREADY target a pace — never invent a target on walk/open/effort steps.
  if (fixed.targetType === 'pace' && fixed.targetPaceMinPerKm) {
    const fromNotes = paceFromNotes(fixed.notes);
    if (fromNotes && (fromNotes.min !== fixed.targetPaceMinPerKm || fromNotes.max !== (fixed.targetPaceMaxPerKm ?? fixed.targetPaceMinPerKm))) {
      fixed.targetPaceMinPerKm = fromNotes.min;
      fixed.targetPaceMaxPerKm = fromNotes.max;
    }
  }

  const notes = fixed.notes || '';
  const mentionsTime = TIME_UNIT_RE.test(notes);
  const mentionsDist = DIST_UNIT_RE.test(notes);

  // A "time" value that's really a distance (e.g. "3 ק״מ" mislabeled as time:3000).
  // Only reclassify when the notes clearly reference DISTANCE units and NOT time.
  // Previously this fired for ANY time value >= 1000, which wrongly turned legit
  // long runs like "50 דקות" (3000s) into 3000m. Guarding on units fixes that.
  if (fixed.durationType === 'time' && fixed.durationValue) {
    if (
      fixed.durationValue >= 1000 &&
      (fixed.type === 'warmup' || fixed.type === 'active' || fixed.type === 'interval') &&
      mentionsDist &&
      !mentionsTime
    ) {
      fixed.durationType = 'distance';
    }
  }

  // Classic track distances (200/400/800m) mislabeled as time — but not if the
  // note explicitly calls out seconds/minutes (e.g. a genuine 200s effort).
  if (fixed.durationType === 'time' && fixed.durationValue) {
    if ([200, 400, 800].includes(fixed.durationValue) && fixed.targetType === 'pace' && !mentionsTime) {
      fixed.durationType = 'distance';
    }
  }

  // An "open" (Lap Button) step that mistakenly carries a value: infer the real
  // unit from the notes rather than blindly assuming distance for large numbers.
  if (fixed.durationType === 'open' && fixed.durationValue) {
    if (mentionsTime && !mentionsDist) {
      fixed.durationType = 'time';
    } else if (mentionsDist && !mentionsTime) {
      fixed.durationType = 'distance';
    } else if (fixed.durationValue < 1000) {
      fixed.durationType = 'time';
    } else {
      // Ambiguous large value with no unit hint — keep it a true Lap Button step.
      fixed.durationValue = undefined;
    }
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

/**
 * Extract the JSON object from the model's reply. The model is told to return
 * only JSON, but it can wrap it in ```json fences or (rarely) add a stray
 * sentence. Strip fences, then slice from the first "{" to its matching close
 * brace (brace-counting, string-aware) so trailing prose can't break JSON.parse.
 */
export function extractJson(text: string): string {
  let s = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return s;
  s = s.slice(start);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return s; // unbalanced — let JSON.parse throw so the caller can retry
}

// Vision/PDF parsing of the coach's dense Hebrew RTL tables is the accuracy-
// critical path. Use Opus 4.8 (high-resolution vision, strongest table
// extraction) with adaptive thinking so paces/durations are read correctly —
// Haiku 4.5 mis-read descending pace ladders (e.g. 4:10→3:30 shifted to
// 4:00→3:30). Plain-text fallback (rare) stays on the cheaper Haiku tier.
const VISION_MODEL = 'claude-opus-4-8';
const TEXT_MODEL = 'claude-haiku-4-5-20251001';

async function parseWithClaude(content: Anthropic.MessageCreateParams['messages'][0]['content'], useVision = false): Promise<ParsedWeeklyPlan> {
  const call = async (extra?: string): Promise<ParsedWeeklyPlan> => {
    const msgContent = extra
      ? ([...(Array.isArray(content) ? content : [{ type: 'text', text: String(content) }]),
          { type: 'text', text: extra }] as typeof content)
      : content;
    const response = await anthropic.messages.create({
      model: useVision ? VISION_MODEL : TEXT_MODEL,
      max_tokens: 16000,
      ...(useVision ? { thinking: { type: 'adaptive' as const } } : {}),
      system: WORKOUT_PARSER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: msgContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = JSON.parse(extractJson(text));
    if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
      throw new Error('Invalid response structure');
    }
    return validatePlan(parsed as ParsedWeeklyPlan);
  };

  try {
    return await call();
  } catch {
    // One retry — transient truncation or a stray non-JSON preamble. Nudge the
    // model to return only the JSON object this time.
    return call('Return ONLY the JSON object, with no other text or markdown fences.');
  }
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
