import { NextRequest, NextResponse } from 'next/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';

// Image/PDF plans go through Opus 4.8 vision + adaptive thinking, which can take
// 60–180s on a dense Hebrew table (and up to 2x if the one-shot JSON retry fires).
// Without a raised limit the function hits Vercel's short default timeout and is
// killed mid-call, so the client fetch never resolves and the "Parsing your plan…"
// spinner hangs forever. Pinned to the Pro-plan ceiling of 300s.
export const maxDuration = 300;

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
      imageBase64: image || undefined,
      imageMediaType: image ? (imageMediaType || 'image/png') : undefined,
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
