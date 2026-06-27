import { NextRequest, NextResponse } from 'next/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';
import { ParsedWeeklyPlan } from '@/lib/ai/types';

function getMockResponse(): ParsedWeeklyPlan {
  return {
    workouts: [
      {
        dayOfWeek: 0,
        name: 'Easy Run',
        steps: [
          { order: 1, type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetZone: 'easy' },
        ],
      },
      {
        dayOfWeek: 2,
        name: 'Interval Session',
        steps: [
          { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy' },
          {
            order: 2, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetZone: 'interval',
            repeatCount: 5,
            repeatSteps: [
              { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 265, targetPaceMaxPerKm: 275 },
              { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target' },
            ],
          },
          { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy' },
        ],
      },
      {
        dayOfWeek: 3,
        name: 'Easy Run',
        steps: [
          { order: 1, type: 'active', durationType: 'distance', durationValue: 6000, targetType: 'pace', targetZone: 'easy' },
        ],
      },
      {
        dayOfWeek: 5,
        name: 'Tempo Run',
        steps: [
          { order: 1, type: 'warmup', durationType: 'distance', durationValue: 3000, targetType: 'pace', targetZone: 'easy' },
          { order: 2, type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetZone: 'threshold' },
          { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetZone: 'easy' },
        ],
      },
      {
        dayOfWeek: 6,
        name: 'Long Run',
        steps: [
          { order: 1, type: 'active', durationType: 'distance', durationValue: 18000, targetType: 'pace', targetZone: 'easy' },
        ],
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, image, imageMediaType } = body;

    if (!text && !image) {
      return NextResponse.json(
        { error: 'Either text or image must be provided' },
        { status: 400 }
      );
    }

    // Use mock if no API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(getMockResponse());
    }

    const result = await parseWorkoutPlan({
      text,
      imageBase64: image,
      imageMediaType: imageMediaType || 'image/png',
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Parse workout error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to parse workout' },
      { status: 500 }
    );
  }
}
