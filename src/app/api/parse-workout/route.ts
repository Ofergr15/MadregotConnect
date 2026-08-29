import { NextRequest, NextResponse } from 'next/server';
import { parseWorkoutPlan } from '@/lib/ai/parser';
import { authError, requireSession } from '@/lib/auth-session';

// Image/PDF plans go through Opus 4.8 vision + adaptive thinking, which can take
// 60–180s on a dense Hebrew table (and up to 2x if the one-shot JSON retry fires).
// Without a raised limit the function hits Vercel's short default timeout and is
// killed mid-call, so the client fetch never resolves and the "Parsing your plan…"
// spinner hangs forever. Pinned to the Pro-plan ceiling of 300s.
export const maxDuration = 300;

// Staff-only. Its one caller is the coach's "new plan" screen, and every call
// spends real Anthropic credits on a long Opus vision run — unauthenticated, it
// was a way for anyone to burn the club's API budget (and the route helpfully
// reports when that budget runs out).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSession(req);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

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

    const status: number | undefined = error?.status;
    const rawMessage: string = error?.message || '';

    // Out of Anthropic API credits — surfaces as a 400 invalid_request_error
    // whose message mentions the credit balance. Give the operator a clear,
    // actionable message instead of the raw JSON blob from the SDK.
    if (/credit balance is too low/i.test(rawMessage)) {
      return NextResponse.json(
        {
          error:
            'AI parsing is temporarily unavailable — the Anthropic API account is out of credits. Add credits in the Anthropic console (Plans & Billing), then try again. In the meantime you can paste the plan as text.',
          code: 'insufficient_credits',
        },
        { status: 402 } // Payment Required
      );
    }

    // Bad/misconfigured API key.
    if (status === 401 || /authentication|invalid x-api-key|api key/i.test(rawMessage)) {
      return NextResponse.json(
        { error: 'AI parsing is unavailable — the API key is missing or invalid. Please check the server configuration.', code: 'auth_error' },
        { status: 502 }
      );
    }

    // Anthropic rate limit / overloaded.
    if (status === 429 || status === 529) {
      return NextResponse.json(
        { error: 'The AI service is busy right now. Please wait a moment and try again.', code: 'rate_limited' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: rawMessage || 'Failed to parse workout' },
      { status: 500 }
    );
  }
}
