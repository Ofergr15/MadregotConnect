import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { pushSummary, retryPush, versionsFor } from '@/lib/plan-builder/server';
import { badWeek, fail, staff } from '@/lib/plan-builder/route-helpers';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
type P = { params: Promise<{ week: string }> };

async function published(week: string) {
  const db = createServerClient();
  return { db, v: (await versionsFor(db, week)).find((x) => x.state === 'published') };
}

/** GET → { versionId, sent, failed, reconnect, backoff, pending, athletes:[{athleteId,name,state,errorCode,attempts,retryAt}] } */
export async function GET(req: NextRequest, { params }: P) {
  const { denied } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const { db, v } = await published(week);
    if (!v) return NextResponse.json({ error: 'not published' }, { status: 404 });
    return NextResponse.json(await pushSummary(db, v.id));
  } catch (e) { return fail(e, 'push status failed'); }
}

/** POST { athleteIds?: string[] } → retry (all non-sent when omitted) → same shape as GET */
export async function POST(req: NextRequest, { params }: P) {
  const { denied } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const { athleteIds } = await req.json().catch(() => ({}));
    const { db, v } = await published(week);
    if (!v) return NextResponse.json({ error: 'not published' }, { status: 404 });
    return NextResponse.json(await retryPush(db, v.id, Array.isArray(athleteIds) ? athleteIds.map(String) : null));
  } catch (e) { return fail(e, 'push retry failed'); }
}
