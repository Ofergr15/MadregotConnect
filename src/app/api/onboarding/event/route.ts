import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth-session';
import { CLIENT_STEPS, deviceFromUa, recordOnbEvent, type OnbStep } from '@/lib/onboarding/events';

export const dynamic = 'force-dynamic';

// POST /api/onboarding/event { step, token?, platform?, standalone?, meta? }
//
// A joining member's browser reporting a step (lib/onboarding/events.ts). Public,
// because half the journey happens before there is a session: who it is comes
// from the session when there is one, else from their invite token (the same
// credential /join runs on). Only the client steps are accepted, `meta` is capped,
// and a view-type step from the same member and device inside 10 minutes is
// dropped, so a re-render or a reload cannot inflate a funnel.
const REPEATABLE = new Set<OnbStep>(['latest_clicked']);
const DEDUPE_MS = 10 * 60 * 1000;

function deviceFromPlatform(platform: string | undefined, ua: string | null): string | null {
  if (!platform) return deviceFromUa(ua);
  if (platform === 'desktop') return 'computer';
  if (platform.startsWith('ios')) return 'iphone';
  if (platform.startsWith('android')) return 'android';
  return deviceFromUa(ua); // 'standalone': the installed app, whose UA still says which phone
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { step?: string; token?: string; platform?: string; standalone?: boolean; meta?: Record<string, unknown> } | null;
  const step = body?.step as OnbStep | undefined;
  if (!step || !CLIENT_STEPS.has(step)) return NextResponse.json({ error: 'bad-step' }, { status: 400 });
  const meta = body?.meta && JSON.stringify(body.meta).length <= 1000 ? body.meta : {};

  let athleteId: string | null = null;
  if (request.headers.get('authorization')) {
    const auth = await requireSession(request).catch(() => null);
    if (auth?.ok) athleteId = auth.user.athleteId ?? null;
  }
  const db = createServerClient();
  if (!athleteId && body?.token && typeof body.token === 'string' && body.token.length >= 16) {
    const { data } = await db.from('athletes').select('id').eq('invite_token', body.token).maybeSingle();
    athleteId = (data as { id?: string } | null)?.id ?? null;
  }

  const ua = request.headers.get('user-agent');
  const device = deviceFromPlatform(body?.platform, ua);
  if (athleteId && !REPEATABLE.has(step)) {
    const { count, error } = await db.from('onboarding_events').select('id', { count: 'exact', head: true })
      .eq('athlete_id', athleteId).eq('step', step).eq('device', device ?? '')
      .gte('created_at', new Date(Date.now() - DEDUPE_MS).toISOString());
    if (!error && (count ?? 0) > 0) return NextResponse.json({ ok: true, deduped: true });
  }
  await recordOnbEvent({ step, athleteId, device, platform: body?.platform ?? null, standalone: body?.standalone ?? null, meta });
  return NextResponse.json({ ok: true });
}
