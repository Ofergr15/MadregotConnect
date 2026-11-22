import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { defaultOpts, draftFor, publishVersion } from '@/lib/plan-builder/server';
import { defaultPublishAt } from '@/lib/plan-builder/schedule';
import { DEFAULT_PUBLISH_MODE } from '@/lib/plan-builder/constants';
import { badWeek, fail, gate } from '@/lib/plan-builder/route-helpers';

export const maxDuration = 300; // a "now" publish pushes the whole club to Garmin
export const dynamic = 'force-dynamic';

/**
 * POST { mode?: 'now'|'scheduled', publishAt?: ISO, notify?, push?, overwriteWatch?, message? }
 * → { scheduled: true, publishAt } | { published: true, planId, scope, notified, pushed }
 * Flags never block (FLAGS_BLOCK_PUBLISH = false).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { denied, me, who } = await gate(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const b = await req.json().catch(() => ({}));
    const db = createServerClient();
    const draft = await draftFor(db, week, who);
    if (!draft) return NextResponse.json({ error: 'no draft to publish' }, { status: 409 });
    const opts = defaultOpts(b);
    const mode = b.mode ?? DEFAULT_PUBLISH_MODE;
    if (mode === 'scheduled') {
      const publishAt = b.publishAt || defaultPublishAt(week);
      if (Date.parse(publishAt) > Date.now()) {
        await db.from('weekly_plan_versions').update({ state: 'scheduled', publish_at: publishAt, publish_opts: opts }).eq('id', draft.id);
        return NextResponse.json({ scheduled: true, publishAt });
      }
    }
    return NextResponse.json({ published: true, ...(await publishVersion(db, draft, opts, me)) });
  } catch (e) { return fail(e, 'publish failed'); }
}
