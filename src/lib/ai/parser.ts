import Tesseract from 'tesseract.js';
import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from './types';

const DAY_MAP: Record<string, number> = {
  'ראשון': 6, 'יום ראשון': 6, 'sunday': 6,
  'שני': 0, 'יום שני': 0, 'monday': 0,
  'שלישי': 1, 'יום שלישי': 1, 'tuesday': 1,
  'רביעי': 2, 'יום רביעי': 2, 'wednesday': 2,
  'חמישי': 3, 'יום חמישי': 3, 'thursday': 3,
  'שישי': 4, 'יום שישי': 4, 'friday': 4,
  'שבת': 5, 'saturday': 5,
};

function parsePace(paceStr: string): number {
  const match = paceStr.match(/(\d+):(\d+)/);
  if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
  return 0;
}

function parsePaceRange(str: string): { min: number; max: number } | null {
  // "4:30-5:00" or "4:30 - 5:00"
  const rangeMatch = str.match(/(\d+:\d+)\s*[-–]\s*(\d+:\d+)/);
  if (rangeMatch) {
    return { min: parsePace(rangeMatch[1]), max: parsePace(rangeMatch[2]) };
  }
  // single pace "4:30"
  const singleMatch = str.match(/(\d+:\d+)/);
  if (singleMatch) {
    const p = parsePace(singleMatch[1]);
    return { min: p - 5, max: p + 5 };
  }
  return null;
}

function parseDistance(str: string): number | null {
  // "3km" "3 km" "3 קמ" "3 ק״מ" "3 קילומטר" "400m" "400 מטר" "1000מ"
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
  // "9 דקות" "9 min" "9דק" "45 שניות" "45sec" "45שנ" "1:30" as mm:ss
  const minMatch = str.match(/(\d+)\s*(?:דקות|דק|min|minutes)/i);
  if (minMatch) return parseInt(minMatch[1]) * 60;
  const secMatch = str.match(/(\d+)\s*(?:שניות|שנ|sec|seconds|s\b)/i);
  if (secMatch) return parseInt(secMatch[1]);
  // "1:30" in context of duration (not pace — pace has /km or is in pace position)
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
  // Remove (4:00) and ((4:10)) group notations — we use the first (fastest) pace
  return str.replace(/\(\(.*?\)\)/g, '').replace(/\([\d:]+\)/g, '').trim();
}

function parseSegment(segment: string, orderStart: number): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  let order = orderStart;
  const cleaned = stripBracketPaces(segment.trim());

  // Repeat pattern: "6x(9min + 1min rest)" or "5x1000מ" or "3x45שנ 3:50"
  const repeatMatch = cleaned.match(/(\d+)\s*(?:x|פעמים|×)\s*[\(]?(.+?)[\)]?\s*$/i);
  if (repeatMatch) {
    const count = parseInt(repeatMatch[1]);
    const inner = repeatMatch[2];

    // Split inner by "+" or "," for sub-steps
    const parts = inner.split(/\s*[+,]\s*/).filter(Boolean);
    const repeatSteps: WorkoutStep[] = [];
    let subOrder = 1;

    for (const part of parts) {
      const pace = parsePaceRange(part);
      const dist = parseDistance(part);
      const time = parseTime(part);
      const isRest = /מנוחה|rest|הליכה|walk|recovery/.test(part);

      const step: WorkoutStep = {
        order: subOrder++,
        type: isRest ? 'rest' : 'interval',
        durationType: dist ? 'distance' : time ? 'time' : 'open',
        durationValue: dist || time || undefined,
        targetType: pace ? 'pace' : 'no_target',
        targetPaceMinPerKm: pace?.min,
        targetPaceMaxPerKm: pace?.max,
      };
      repeatSteps.push(step);
    }

    // If only one step in repeat (e.g., "5x1000m at 4:30"), add a rest
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

  // Single segment parse
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
    order: order,
    type,
    durationType: dist ? 'distance' : time ? 'time' : 'open',
    durationValue: dist || time || undefined,
    targetType: pace ? 'pace' : targetZone ? 'pace' : isRest ? 'no_target' : 'no_target',
    targetZone: !pace ? targetZone : undefined,
    targetPaceMinPerKm: pace?.min,
    targetPaceMaxPerKm: pace?.max,
  });

  return steps;
}

function parseDayWorkout(dayText: string, dayOfWeek: number): ParsedWorkout {
  // Split by comma, then parse each segment
  // But be careful with commas inside time expressions
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

  // Auto-add warmup/cooldown for interval sessions without them
  const hasWarmup = steps.some(s => s.type === 'warmup');
  const hasCooldown = steps.some(s => s.type === 'cooldown');
  const hasInterval = steps.some(s => s.repeatCount || s.type === 'interval');

  if (hasInterval && !hasWarmup) {
    steps.unshift({
      order: 0,
      type: 'warmup',
      durationType: 'distance',
      durationValue: 2000,
      targetType: 'pace',
      targetZone: 'easy',
    });
  }

  if (hasInterval && !hasCooldown) {
    steps.push({
      order: steps.length + 1,
      type: 'cooldown',
      durationType: 'distance',
      durationValue: 1500,
      targetType: 'pace',
      targetZone: 'easy',
    });
  }

  // Re-number
  steps.forEach((s, i) => { s.order = i + 1; });

  const name = detectWorkoutType(dayText);

  return { dayOfWeek, name, steps };
}

function splitIntoDays(text: string): { day: number; content: string }[] {
  const results: { day: number; content: string }[] = [];

  // Try splitting by Hebrew day names or English day names
  const dayPattern = new RegExp(
    `(${Object.keys(DAY_MAP).join('|')})\\s*[-–:]\\s*`,
    'gi'
  );

  const parts = text.split(dayPattern).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const normalized = parts[i].trim().replace(/^יום\s*/, '');
    const dayNum = DAY_MAP[normalized] ?? DAY_MAP[normalized.toLowerCase()];
    if (dayNum !== undefined && i + 1 < parts.length) {
      results.push({ day: dayNum, content: parts[i + 1].trim() });
      i++;
    }
  }

  // If no day headers found, treat entire text as one workout for today
  if (results.length === 0 && text.trim()) {
    const today = new Date().getDay();
    // JS: 0=Sun,1=Mon..6=Sat → our format: 0=Mon..6=Sun
    const dayOfWeek = today === 0 ? 6 : today - 1;
    results.push({ day: dayOfWeek, content: text.trim() });
  }

  return results;
}

async function extractTextFromImage(base64: string, mediaType: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const { data: { text } } = await Tesseract.recognize(buffer, 'heb+eng');
  return text;
}

export async function parseWorkoutPlan(input: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}): Promise<ParsedWeeklyPlan> {
  let textInput = input.text || '';

  // Only use OCR if no text was provided at all
  if (!textInput.trim() && input.imageBase64 && input.imageMediaType) {
    textInput = await extractTextFromImage(input.imageBase64, input.imageMediaType);
    if (!textInput.trim()) {
      throw new Error('Could not extract text from image. Please paste the workout as text instead.');
    }
  }

  if (!textInput.trim()) {
    throw new Error('Either text or image must be provided');
  }

  const text = textInput.trim();
  const days = splitIntoDays(text);
  const workouts: ParsedWorkout[] = [];

  for (const { day, content } of days) {
    if (content.trim()) {
      workouts.push(parseDayWorkout(content, day));
    }
  }

  if (workouts.length === 0) {
    throw new Error('Could not parse any workouts from the input text');
  }

  return { workouts };
}
