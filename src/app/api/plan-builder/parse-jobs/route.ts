import { after, NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createParseJob, runParseJob } from '@/lib/plan-builder/server';
import { badWeek, fail, staff } from '@/lib/plan-builder/route-helpers';

// The reply returns at once with a jobId; the Opus vision parse runs in `after()`, so a
// phone that sleeps loses nothing. The background run is still bounded by this ceiling —
// streaming the vision call (CLAUDE.md, "Known latent issue") is the follow-up that lifts it.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** POST { week, text?, image?(base64), imageMediaType? } → 202 { jobId } */
export async function POST(req: NextRequest) {
  const { denied, caller } = await staff(req);
  if (denied) return denied;
  try {
    const { week, text, image, imageMediaType } = await req.json();
    const bad = badWeek(String(week || ''));
    if (bad) return bad;
    if (!text && !image) return NextResponse.json({ error: 'text or image required' }, { status: 400 });
    const input = { text, imageBase64: image || undefined, imageMediaType: image ? imageMediaType || 'image/png' : undefined };
    const db = createServerClient();
    const { id } = await createParseJob(db, week, input, caller.athleteId);
    after(() => runParseJob(db, id, input, caller.athleteId));
    return NextResponse.json({ jobId: id }, { status: 202 });
  } catch (e) { return fail(e, 'parse job create failed'); }
}
