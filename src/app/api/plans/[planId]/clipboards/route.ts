import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { extractJson } from '@/lib/ai/parser';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import {
  parsedWorkoutToClipboard,
  workoutToClipboardText,
} from '@/lib/plans/clipboard';
import { renderGarminClipboardPng } from '@/lib/run-chat/garmin-clipboard';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BUCKET = 'run-chat';
const ARTIFACT_VERSION = 'v1';

function isGrouped(value: unknown): value is GroupedWeeklyPlans {
  const object = value as Partial<GroupedWeeklyPlans> | null;
  return Boolean(object?.group1?.workouts && object?.group2?.workouts && object?.group3?.workouts);
}

async function ensureBucket(supabase: ReturnType<typeof createServerClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 20_000_000 });
  }
}

async function preview(workout: ParsedWorkout) {
  const clipboardText = workoutToClipboardText(workout);
  const png = await renderGarminClipboardPng(
    parsedWorkoutToClipboard({ ...workout, clipboardText }),
  );
  return {
    workout: { ...workout, clipboardText },
    clipboardText,
    previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
  };
}

async function refine(workout: ParsedWorkout, instruction: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `You edit one structured running workout for a coach.
Return ONLY the complete updated workout JSON object.
Preserve dayOfWeek, workoutKey, partIndex, partCount, and partKind exactly.
Workout steps use durationValue in meters for distance or seconds for time.
Do not add group bracket notation to a single-group workout.
Apply only the requested change; preserve all other fields and Hebrew wording.`,
    messages: [{
      role: 'user',
      content: `Coach instruction:\n${instruction}\n\nCurrent workout:\n${JSON.stringify(workout)}`,
    }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const parsed = JSON.parse(extractJson(text)) as ParsedWorkout;
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('AI returned an invalid workout');
  }
  return {
    ...parsed,
    dayOfWeek: workout.dayOfWeek,
    workoutKey: workout.workoutKey,
    partIndex: workout.partIndex,
    partCount: workout.partCount,
    partKind: workout.partKind,
    clipboardImageUrl: undefined,
    clipboardText: workoutToClipboardText(parsed),
  };
}

async function publish(
  supabase: ReturnType<typeof createServerClient>,
  planId: string,
  stored: GroupedWeeklyPlans | ParsedWeeklyPlan,
) {
  const grouped = isGrouped(stored) ? structuredClone(stored) : splitIntoGroups(stored);
  const baseKeys = grouped.group1.workouts.map((workout) => workout.workoutKey);
  if (baseKeys.some((key) => !key)) {
    throw new Error('Every workout part must have a stable workoutKey before publishing');
  }

  for (const group of [1, 2, 3] as const) {
    const plan = grouped[`group${group}`];
    if (plan.workouts.length !== baseKeys.length) {
      throw new Error(`Group ${group} has a different number of workout parts`);
    }
    for (let index = 0; index < plan.workouts.length; index++) {
      const workout = plan.workouts[index];
      if (workout.workoutKey !== baseKeys[index]) {
        throw new Error(`Group ${group} workout order does not match Group 1`);
      }
      const clipboardText = workoutToClipboardText(workout);
      const png = await renderGarminClipboardPng(
        parsedWorkoutToClipboard({ ...workout, clipboardText }),
      );
      const path = `weekly-plans/${planId}/${workout.workoutKey}/group-${group}-${ARTIFACT_VERSION}.png`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, png, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);
      plan.workouts[index] = {
        ...workout,
        clipboardText,
        clipboardImageUrl: `${publicUrl.publicUrl}?v=${ARTIFACT_VERSION}`,
      };
    }
  }

  const { data: updated, error } = await supabase
    .from('weekly_plans')
    .update({ parsed_workouts: grouped, status: 'pushed' })
    .eq('id', planId)
    .select('*')
    .single();
  if (error) throw error;
  return updated;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  const { planId } = await params;

  try {
    const body = await request.json();
    const action = body?.action as 'preview' | 'refine' | 'publish' | undefined;
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

    if (action === 'preview') {
      if (!body.workout) return NextResponse.json({ error: 'workout required' }, { status: 400 });
      return NextResponse.json(await preview(body.workout as ParsedWorkout));
    }
    if (action === 'refine') {
      if (!body.workout || !body.instruction?.trim()) {
        return NextResponse.json({ error: 'workout and instruction required' }, { status: 400 });
      }
      const workout = await refine(body.workout as ParsedWorkout, body.instruction.trim());
      return NextResponse.json(await preview(workout));
    }

    const supabase = createServerClient();
    const { data: plan, error } = await supabase
      .from('weekly_plans')
      .select('id, parsed_workouts')
      .eq('id', planId)
      .maybeSingle();
    if (error) throw error;
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    await ensureBucket(supabase);
    const updated = await publish(
      supabase,
      planId,
      plan.parsed_workouts as GroupedWeeklyPlans | ParsedWeeklyPlan,
    );
    return NextResponse.json({ plan: updated });
  } catch (error: unknown) {
    console.error('POST plan clipboards error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
