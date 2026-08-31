import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CATEGORIES, DEFAULTS, isMigrationMissing, mergeWithDefaults, type Category } from '@/lib/notifications/prefs';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * Self-or-staff, resolved from the verified session — the same gate
 * GET /api/notifications/inbox uses.
 *
 * Both handlers took the target athleteId straight from the request and trusted
 * it ("the athleteId is the caller's own id (stored in localStorage)" — which
 * describes what the app's own UI does, not what the endpoint enforced). Any
 * signed-in athlete could therefore read anyone's preferences, and, worse,
 * silence anyone's notifications: a single PUT with someone else's id and
 * `enabled: false` mutes their coach messages, and nothing in the app would
 * show them why they went quiet.
 */
async function gate(request: Request, athleteId: string): Promise<Response | null> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!mayActFor(caller, athleteId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

// GET /api/athletes/notification-prefs?athleteId=… → { prefs }
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ prefs: DEFAULTS });
    const denied = await gate(request, athleteId);
    if (denied) return denied;
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athletes').select('notification_prefs').eq('id', athleteId).maybeSingle();
    if (error) {
      if (isMigrationMissing(error)) return NextResponse.json({ prefs: DEFAULTS });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const prefs = mergeWithDefaults(data?.notification_prefs as Partial<Record<Category, boolean>> | undefined);
    return NextResponse.json({ prefs });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT /api/athletes/notification-prefs { athleteId, category, enabled }
// Owner-or-staff, enforced by `gate` above. Merges the single toggle into the
// saved map. Degrades gracefully (501) if the column isn't migrated yet.
export async function PUT(request: Request) {
  try {
    const { athleteId, category, enabled } = await request.json();
    // Correlates with the client's logClient('notif-toggle-attempt', {actionId})
    // beacon — `vercel logs --search <actionId>` ties both sides together.
    console.log('[notification-prefs PUT]', request.headers.get('x-action-id'), { athleteId, category, enabled });
    if (!athleteId || !CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'athleteId and a valid category required' }, { status: 400 });
    }
    const denied = await gate(request, athleteId);
    if (denied) return denied;
    const supabase = createServerClient();
    // Read current, merge, write back (small JSON; no concurrent-writer concern per user).
    const cur = await supabase.from('athletes').select('notification_prefs').eq('id', athleteId).maybeSingle();
    if (isMigrationMissing(cur.error)) {
      return NextResponse.json({ error: 'notification_prefs not migrated (run migration 038)' }, { status: 501 });
    }
    if (cur.error) throw cur.error;
    const next = { ...(cur.data?.notification_prefs || {}), [category]: !!enabled };
    const { error } = await supabase.from('athletes').update({ notification_prefs: next }).eq('id', athleteId);
    if (error) {
      if (isMigrationMissing(error)) {
        return NextResponse.json({ error: 'notification_prefs not migrated (run migration 038)' }, { status: 501 });
      }
      throw error;
    }
    return NextResponse.json({ prefs: mergeWithDefaults(next) });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
