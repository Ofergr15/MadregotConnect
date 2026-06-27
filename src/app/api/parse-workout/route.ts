import { NextRequest, NextResponse } from 'next/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';

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
