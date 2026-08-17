/**
 * POST /api/run-chat/[chatId]/plan
 * Body: { plannedText: string }
 *
 * Coach edits the planned workout text; triggers a re-parse into planned_workout JSON.
 */
import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { canAccessChat } from '@/lib/run-chat/access';
import Anthropic from '@anthropic-ai/sdk';
import { zodResponseFormat } from 'openai/helpers/zod'; // not available — use raw schema
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SegmentSchema = z.object({
  kind: z.enum(['warmup', 'interval', 'recovery', 'cooldown', 'easy']),
  reps: z.number().int().min(1).optional(),
  distanceM: z.number().optional(),
  durationSec: z.number().optional(),
  targetPaceSec: z.number().optional(), // seconds per km
  targetHrPct: z.number().optional(),   // 0-100
  note: z.string().optional(),
});

const WorkoutSchema = z.object({
  title: z.string(),
  segments: z.array(SegmentSchema),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const { user } = auth;
  const { chatId } = await params;

  try {
    const { plannedText } = (await request.json()) as { plannedText?: string };
    if (!plannedText?.trim()) {
      return NextResponse.json({ error: 'plannedText required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: chat } = await supabase
      .from('run_chats')
      .select('id, athlete_id, coach_id')
      .eq('id', chatId)
      .maybeSingle();

    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessChat(user, chat)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Parse with Haiku — cheap structured extraction
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
    }
    const client = new Anthropic({ apiKey });
    let planned_workout: z.infer<typeof WorkoutSchema> | null = null;

    try {
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: 'Extract the workout plan into structured JSON. Return ONLY valid JSON matching the schema, no explanation.',
        messages: [{
          role: 'user',
          content: `Parse this workout plan into JSON with fields: title (string), segments (array of {kind, reps?, distanceM?, durationSec?, targetPaceSec?, targetHrPct?, note?}). Kind must be warmup/interval/recovery/cooldown/easy. targetPaceSec is seconds-per-km (e.g. 4:30/km = 270). Workout: ${plannedText}`,
        }],
      });

      const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        planned_workout = WorkoutSchema.parse(parsed);
      }
    } catch {
      // Parse failed — save raw text only, planned_workout stays null
    }

    const { data: updated, error } = await supabase
      .from('run_chats')
      .update({ planned_text: plannedText, planned_workout })
      .eq('id', chatId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ chat: updated });
  } catch (err: unknown) {
    console.error('POST /api/run-chat/[chatId]/plan error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
