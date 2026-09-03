/**
 * POST /api/run-chat/[chatId]/ai
 *
 * Triggered by the client when a message mentions @aicoach.
 * Runs a toolRunner turn, then posts the reply into the Stream channel
 * as the aicoach bot user.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeCoachTurn, type CoachTool } from '@/lib/run-chat/ai-complete';
import { claimAiTurn, releaseAiTurn } from '@/lib/run-chat/ai-lock';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { canAccessChat } from '@/lib/run-chat/access';
import {
  activitySummary,
  compareRuns,
  lapAnalysis,
  similarRunScore,
  type RunActivity,
} from '@/lib/run-chat/run-analysis';
import {
  getStreamServerClient,
  CHANNEL_TYPE,
  channelId,
  ensureAiUser,
  AI_USER_ID,
} from '@/lib/stream/server';
import { getStravaActivityUrl } from '@/lib/strava/client';
import { ensureLapsArtifact } from '@/lib/run-chat/run-artifacts';
import {
  downsampleRoute,
  RUN_ATTACHMENT_VERSION,
  TOOL_TRACE_VERSION,
  type RoutePoint,
  type RunSummaryPayload,
  type StravaRunAttachment,
  type ToolTraceAttachment,
  type ToolTraceStep,
} from '@/lib/run-chat/attachments';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AI_SYSTEM_PROMPT = `You are an AI running coach in a chat between a runner and their human coach.
You have tools for the planned workout, detailed activity and lap analysis, route data, run comparison, similar workouts, and full run-history search.
The planned workout is the exact published group-specific workout part matched to this activity. Its source metadata and structured field are authoritative; the clipboard image is only a visual attachment.
For questions about this run, call analyze_activity_workout first so you compare the coach's plan with what was actually executed.
Strava laps are often auto-laps rather than workout intervals. Align or merge consecutive laps against the planned time/distance structure; never assume one Strava lap equals one planned interval.
When comparing runs, a negative pace delta means the current run was faster.
Be specific, data-driven, and encouraging. Answer in the same language as the latest user message (Hebrew or English).
Keep replies concise — 2-4 sentences unless a detailed breakdown is requested.
When referencing lap data, include the actual numbers.`;

function hasInProgressCoachTurn(
  messages: Array<{
    user_id?: string;
    user?: { id?: string } | null;
    text?: string | null;
  }>,
): boolean {
  return messages.some((message) => {
    const uid = message.user_id || message.user?.id;
    return uid === AI_USER_ID && (message.text || '').includes('מנתח את נתוני הריצה');
  });
}

type ClaudeMsg = { role: 'user' | 'assistant'; content: string };

function buildClaudeMessages(
  streamMessages: Array<{ text?: string | null; user_id?: string; user?: { id?: string } | null }>,
  athleteId: string,
): ClaudeMsg[] {
  const out: ClaudeMsg[] = [];

  for (const m of streamMessages) {
    const text = (m.text || '').trim();
    if (!text) continue;

    const uid = m.user_id || m.user?.id || '';
    if (uid === AI_USER_ID) {
      // Merge consecutive assistant turns
      const last = out[out.length - 1];
      if (last?.role === 'assistant') last.content += `\n${text}`;
      else out.push({ role: 'assistant', content: text });
      continue;
    }

    const speaker = uid === athleteId ? 'הרץ' : 'המאמן';
    const labeled = `[${speaker}]: ${text}`;
    const last = out[out.length - 1];
    if (last?.role === 'user') last.content += `\n${labeled}`;
    else out.push({ role: 'user', content: labeled });
  }

  // Claude requires the final message to be from the user.
  if (out.length === 0) {
    out.push({ role: 'user', content: 'שלום, אפשר עזרה בניתוח הריצה?' });
  } else if (out[out.length - 1].role === 'assistant') {
    out.push({ role: 'user', content: 'המשך בבקשה.' });
  }

  return out;
}

function collectRunSummaries(value: unknown, output: Map<string, RunSummaryPayload>) {
  if (!value) return;
  if (typeof value === 'string') {
    try {
      collectRunSummaries(JSON.parse(value), output);
    } catch {
      // Plain-text tool results do not contain linked activities.
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRunSummaries(item, output));
    return;
  }
  if (typeof value !== 'object') return;

  const candidate = value as Partial<RunSummaryPayload> & Record<string, unknown>;
  if (
    typeof candidate.id === 'string' &&
    typeof candidate.date === 'string' &&
    typeof candidate.distance_m === 'number' &&
    typeof candidate.duration_s === 'number'
  ) {
    output.set(candidate.id, candidate as RunSummaryPayload);
  }
  Object.values(candidate).forEach((item) => collectRunSummaries(item, output));
}

function displayToolResult(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return text.length > 900 ? `${text.slice(0, 900)}\n…[truncated]` : text;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const { user } = auth;
  const { chatId } = await params;
  let claimed = false;

  try {
    const supabase = createServerClient();

    const { data: chat } = await supabase
      .from('run_chats')
      .select('id, activity_id, athlete_id, coach_id, planned_text, planned_workout')
      .eq('id', chatId)
      .maybeSingle();

    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessChat(user, chat)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    let messageId: string | undefined;
    try {
      const body = (await request.json()) as { messageId?: unknown };
      if (typeof body?.messageId === 'string' && body.messageId) messageId = body.messageId;
    } catch {
      /* mention id is optional */
    }

    if (!claimAiTurn(chat.id, messageId)) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    claimed = true;

    const stream = getStreamServerClient();
    await ensureAiUser(stream);

    const chId = channelId(chat.activity_id);
    const channel = stream.channel(CHANNEL_TYPE, chId);
    await channel.watch();

    const { messages: streamMessages } = await channel.query({ messages: { limit: 40 } });
    if (hasInProgressCoachTurn(streamMessages)) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    const messages = buildClaudeMessages(streamMessages, chat.athlete_id);
    const traceSteps: ToolTraceStep[] = [];
    const relatedRuns = new Map<string, RunSummaryPayload>();
    let traceMessageId: string | null = null;

    const traceAttachment = (): ToolTraceAttachment => ({
      type: 'tool_trace',
      version: TOOL_TRACE_VERSION,
      steps: traceSteps.map((step) => ({ ...step })),
    });

    const publishTrace = async () => {
      const attachments = [traceAttachment() as unknown as Record<string, unknown>];
      if (!traceMessageId) {
        const sent = await channel.sendMessage({
          text: 'מנתח את נתוני הריצה…',
          user_id: AI_USER_ID,
          attachments,
        } as Record<string, unknown>);
        traceMessageId = sent.message.id;
        return;
      }
      await channel.getClient().updateMessage(
        {
          id: traceMessageId,
          text: 'מנתח את נתוני הריצה…',
          attachments,
        },
        AI_USER_ID,
      );
    };

    const tracked = async <T,>(
      name: string,
      args: Record<string, unknown>,
      run: () => Promise<T>,
    ): Promise<T> => {
      const step: ToolTraceStep = {
        id: `${name}-${traceSteps.length + 1}`,
        name,
        status: 'running',
        args,
      };
      traceSteps.push(step);
      const startedAt = Date.now();
      console.log(`[run-chat ai] chat=${chatId} tool=${name} request`, JSON.stringify(args));
      await publishTrace();
      try {
        const result = await run();
        collectRunSummaries(result, relatedRuns);
        step.status = 'complete';
        step.result = displayToolResult(result);
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        console.log(
          `[run-chat ai] chat=${chatId} tool=${name} response ${Date.now() - startedAt}ms ${text.length}ch`,
          text.length > 2000 ? `${text.slice(0, 2000)}…` : text,
        );
        await publishTrace();
        return result;
      } catch (error) {
        step.status = 'error';
        step.result = error instanceof Error ? error.message : String(error);
        console.error(`[run-chat ai] chat=${chatId} tool=${name} failed`, error);
        await publishTrace();
        throw error;
      }
    };

    const activityColumns =
      'id, activity_name, start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr, elevation_gain, avg_cadence, perceived_rpe, perceived_feel, strava_activity_id, laps';

    const loadCurrentActivity = async (): Promise<RunActivity | null> => {
      const { data } = await supabase
        .from('athlete_activities')
        .select(activityColumns)
        .eq('id', chat.activity_id)
        .maybeSingle();
      return data as RunActivity | null;
    };

    const getCurrentDate: CoachTool = {
      name: 'get_current_date',
      description: 'Get the current date and day of week for date-relative run questions.',
      inputSchema: z.object({}),
      run: async () => tracked('get_current_date', {}, async () => {
        const now = new Date();
        return JSON.stringify({
          iso: now.toISOString(),
          date: now.toISOString().slice(0, 10),
          day_of_week: now.toLocaleDateString('en-US', { weekday: 'long' }),
        });
      }),
    };

    const getActivityDetails: CoachTool = {
      name: 'get_activity_details',
      description:
        'Get the complete summary for the run attached to this chat: distance, duration, pace, heart rate, elevation, effort and lap count.',
      inputSchema: z.object({}),
      run: async () => tracked('get_activity_details', {}, async () => {
        const activity = await loadCurrentActivity();
        return activity ? JSON.stringify(activitySummary(activity)) : 'No activity data found.';
      }),
    };

    const analyzeActivityLaps: CoachTool = {
      name: 'analyze_activity_laps',
      description:
        'Analyze every actual Strava lap for this run, including pace spread and heart-rate drift. Use for split/lap/pacing questions.',
      inputSchema: z.object({}),
      run: async () => tracked('analyze_activity_laps', {}, async () => {
        const activity = await loadCurrentActivity();
        if (!activity) return 'No activity data found.';
        if (!activity.laps?.length) return 'No lap data is stored for this activity.';
        return JSON.stringify(lapAnalysis(activity));
      }),
    };

    const getPlannedWorkout: CoachTool = {
      name: 'get_planned_workout',
      description:
        'Get the exact published, group-specific workout part matched to this run, including structured steps and match provenance.',
      inputSchema: z.object({}),
      run: async () => tracked('get_planned_workout', {}, async () => {
        if (chat.planned_workout) return JSON.stringify(chat.planned_workout);
        if (chat.planned_text) return chat.planned_text;
        return 'No planned workout on record for this run.';
      }),
    };

    const analyzeActivityWorkout: CoachTool = {
      name: 'analyze_activity_workout',
      description:
        'Analyze how this run executed the planned workout. Returns the plan plus normalized laps; align/merge auto-laps to the planned interval structure.',
      inputSchema: z.object({}),
      run: async () => tracked('analyze_activity_workout', {}, async () => {
        const activity = await loadCurrentActivity();
        if (!activity) return 'No activity data found.';
        return JSON.stringify({
          planned_workout: chat.planned_workout || chat.planned_text || null,
          actual: lapAnalysis(activity),
          analysis_instructions: [
            'Treat the planned workout as the source of truth.',
            'Strava laps may split a single planned interval; merge consecutive laps by cumulative time or distance.',
            'Compare each work/recovery phase for pace, heart rate, consistency and completion.',
            'Call out missing, shortened or extra segments explicitly.',
          ],
        });
      }),
    };

    const getActivityGpx: CoachTool = {
      name: 'get_activity_gpx',
      description:
        'Fetch the GPX (or route summary) for the actual run — use for route/terrain questions.',
      inputSchema: z.object({}),
      run: async () => tracked('get_activity_gpx', {}, async () => {
        const { data: act } = await supabase
          .from('athlete_activities')
          .select('strava_gpx_url, strava_streams, gps_points, distance, elevation_gain, activity_name')
          .eq('id', chat.activity_id)
          .maybeSingle();
        if (!act) return 'No activity found.';
        if (act.strava_gpx_url) {
          try {
            const res = await fetch(act.strava_gpx_url);
            if (res.ok) {
              const gpx = await res.text();
              // Cap for model context
              return gpx.length > 80_000
                ? `${gpx.slice(0, 80_000)}\n…[truncated]`
                : gpx;
            }
          } catch {
            /* fall through */
          }
          return JSON.stringify({
            strava_gpx_url: act.strava_gpx_url,
            note: 'Could not download GPX body; URL available.',
            streams_meta: act.strava_streams,
            gps_point_count: Array.isArray(act.gps_points) ? act.gps_points.length : 0,
          });
        }
        return JSON.stringify({
          gps_point_count: Array.isArray(act.gps_points) ? act.gps_points.length : 0,
          streams_meta: act.strava_streams,
          distance: act.distance,
          elevation_gain: act.elevation_gain,
        });
      }),
    };

    const getRecentRuns: CoachTool = {
      name: 'get_recent_runs',
      description: 'Get recent runs for this athlete to identify short-term trends.',
      inputSchema: z.object({
        count: z.number().int().min(1).max(30).optional().describe('Runs to return (default 5).'),
      }),
      run: async ({ count }) =>
        tracked('get_recent_runs', { count }, async () => {
          const { data: runs } = await supabase
            .from('athlete_activities')
            .select(activityColumns)
            .eq('athlete_id', chat.athlete_id)
            .order('start_time', { ascending: false })
            .limit(count || 5);
          return JSON.stringify((runs || []).map((run) => activitySummary(run as RunActivity)));
        }),
    };

    const searchRunHistory: CoachTool = {
      name: 'search_run_history',
      description:
        'Search the athlete stored Strava history, excluding the run attached to this chat, by date, distance, or day of week. Use for questions about previous runs, Friday runs, long runs, or date ranges.',
      inputSchema: z.object({
        min_distance_m: z.number().nonnegative().optional(),
        max_distance_m: z.number().positive().optional(),
        start_date: z.string().optional().describe('Inclusive YYYY-MM-DD.'),
        end_date: z.string().optional().describe('Inclusive YYYY-MM-DD.'),
        day_of_week: z.number().int().min(0).max(6).optional().describe('0=Sunday ... 6=Saturday.'),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      run: async (criteria) =>
        tracked('search_run_history', criteria, async () => {
          let query = supabase
            .from('athlete_activities')
            .select(activityColumns)
            .eq('athlete_id', chat.athlete_id)
            .neq('id', chat.activity_id)
            .order('start_time', { ascending: false });
          if (criteria.min_distance_m != null) query = query.gte('distance', criteria.min_distance_m);
          if (criteria.max_distance_m != null) query = query.lte('distance', criteria.max_distance_m);
          if (criteria.start_date) query = query.gte('start_time', `${criteria.start_date}T00:00:00`);
          if (criteria.end_date) query = query.lte('start_time', `${criteria.end_date}T23:59:59`);
          query = query.limit(Math.min((criteria.limit || 10) * 7, 200));
          const { data, error } = await query;
          if (error) return `Run-history search failed: ${error.message}`;
          const filtered = (data || []).filter(
            (run) =>
              criteria.day_of_week == null ||
              new Date(run.start_time).getUTCDay() === criteria.day_of_week,
          );
          return JSON.stringify({
            count: filtered.length,
            runs: filtered.slice(0, criteria.limit || 10).map((run) =>
              activitySummary(run as RunActivity),
            ),
          });
        }),
    };

    const compareRunTool: CoachTool = {
      name: 'compare_runs',
      description:
        'Compare this chat run with another stored run selected by Strava activity ID or local activity date.',
      inputSchema: z.object({
        comparison_strava_id: z.number().optional(),
        comparison_date: z.string().optional().describe('YYYY-MM-DD; latest run that day is used.'),
      }),
      run: async ({ comparison_strava_id, comparison_date }) =>
        tracked('compare_runs', { comparison_strava_id, comparison_date }, async () => {
          const current = await loadCurrentActivity();
          if (!current) return 'Current activity not found.';
          let query = supabase
            .from('athlete_activities')
            .select(activityColumns)
            .eq('athlete_id', chat.athlete_id)
            .neq('id', chat.activity_id);
          if (comparison_strava_id != null) {
            query = query.eq('strava_activity_id', comparison_strava_id);
          } else if (comparison_date) {
            query = query
              .gte('start_time', `${comparison_date}T00:00:00`)
              .lte('start_time', `${comparison_date}T23:59:59`);
          } else {
            return 'Provide comparison_strava_id or comparison_date.';
          }
          const { data: other, error } = await query
            .order('start_time', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) return `Run comparison failed: ${error.message}`;
          if (!other) return 'No comparison run matched.';
          return JSON.stringify(compareRuns(current, other as RunActivity));
        }),
    };

    const findSimilarWorkouts: CoachTool = {
      name: 'find_similar_workouts',
      description:
        'Find stored runs most similar to this run using distance, lap count and pace. Use for historical context and progression.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).optional(),
      }),
      run: async ({ limit }) =>
        tracked('find_similar_workouts', { limit }, async () => {
          const current = await loadCurrentActivity();
          if (!current) return 'Current activity not found.';
          const { data, error } = await supabase
            .from('athlete_activities')
            .select(activityColumns)
            .eq('athlete_id', chat.athlete_id)
            .neq('id', chat.activity_id)
            .order('start_time', { ascending: false })
            .limit(100);
          if (error) return `Similar-run search failed: ${error.message}`;
          const matches = (data || [])
            .filter(
              (candidate) =>
                candidate.id !== current.id &&
                !(
                  current.strava_activity_id &&
                  candidate.strava_activity_id === current.strava_activity_id
                ),
            )
            .map((candidate) => ({
              score: similarRunScore(current, candidate as RunActivity),
              run: activitySummary(candidate as RunActivity),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit || 5);
          return JSON.stringify(matches);
        }),
    };

    try {
      await channel.sendEvent({ type: 'typing.start', user_id: AI_USER_ID } as never);
    } catch {
      /* typing is best-effort */
    }

    const replyText = await completeCoachTurn({
      system: AI_SYSTEM_PROMPT,
      messages,
      tools: [
        getCurrentDate,
        getActivityDetails,
        analyzeActivityLaps,
        getPlannedWorkout,
        analyzeActivityWorkout,
        getActivityGpx,
        getRecentRuns,
        searchRunHistory,
        compareRunTool,
        findSimilarWorkouts,
      ],
    });

    const relatedIds = [...relatedRuns.keys()]
      .filter((id) => id !== chat.activity_id)
      .slice(0, 3);
    const { data: relatedRows } = relatedIds.length
      ? await supabase
          .from('athlete_activities')
          .select(
            `${activityColumns}, strava_gpx_url, gps_points`,
          )
          .in('id', relatedIds)
      : { data: [] };
    const rowsById = new Map((relatedRows || []).map((row) => [row.id, row]));
    const runAttachments: StravaRunAttachment[] = [];
    for (const id of relatedIds) {
      const summary = relatedRuns.get(id);
      if (!summary) continue;
      const row = rowsById.get(id);
      let lapsImageUrl: string | null = null;
      if (row) {
        try {
          lapsImageUrl = await ensureLapsArtifact(supabase, row);
        } catch (error) {
          console.warn('Could not build historical laps artifact', id, error);
        }
      }
      runAttachments.push({
        type: 'strava_run',
        version: RUN_ATTACHMENT_VERSION,
        run: summary,
        strava_url: summary.strava_activity_id
          ? getStravaActivityUrl(summary.strava_activity_id)
          : null,
        chat_url: `/dashboard/run-chat/${summary.id}`,
        gpx_url: row?.strava_gpx_url || null,
        laps_image_url: lapsImageUrl,
        route_points: downsampleRoute(row?.gps_points as RoutePoint[] | null, 20),
      });
    }

    const answer = replyText || 'לא הצלחתי לנסח תשובה כרגע — נסו לשאול שוב.';
    if (traceMessageId) {
      await channel.getClient().updateMessage(
        {
          id: traceMessageId,
          text: '',
          attachments: [traceAttachment() as unknown as Record<string, unknown>],
        },
        AI_USER_ID,
      );
    }
    await channel.sendMessage({
      text: answer,
      user_id: AI_USER_ID,
      attachments: runAttachments.map(
        (attachment) => attachment as unknown as Record<string, unknown>,
      ),
    } as Record<string, unknown>);

    try {
      await channel.sendEvent({ type: 'typing.stop', user_id: AI_USER_ID } as never);
    } catch {
      /* ignore */
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('POST /api/run-chat/[chatId]/ai error:', err);

    // Surface failure in-chat so tagging never looks like a no-op.
    try {
      const supabase = createServerClient();
      const { data: chat } = await supabase
        .from('run_chats')
        .select('activity_id')
        .eq('id', chatId)
        .maybeSingle();
      if (chat?.activity_id) {
        const stream = getStreamServerClient();
        await ensureAiUser(stream);
        const channel = stream.channel(CHANNEL_TYPE, channelId(chat.activity_id));
        await channel.sendMessage({
          text: '⚠️ מאמן ה-AI נתקל בשגיאה. נסו שוב בעוד רגע.',
          user_id: AI_USER_ID,
        });
      }
    } catch (postErr) {
      console.error('Failed to post AI error message:', postErr);
    }

    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    if (claimed) releaseAiTurn(chatId);
  }
}
