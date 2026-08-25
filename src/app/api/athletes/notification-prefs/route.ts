import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Per-user notification category preferences. Categories map to the push
// categories in src/lib/push.ts. A missing key = opted IN (receive everything),
// so defaults are all-on and nothing is silenced unless explicitly turned off.
const CATEGORIES = ['workouts', 'coach', 'achievements', 'program', 'teammates', 'news', 'events'] as const;
type Category = (typeof CATEGORIES)[number];
const DEFAULTS: Record<Category, boolean> = {
  workouts: true, coach: true, achievements: true, program: true, teammates: true, news: true, events: true,
};

function isMigrationMissing(error: { message?: string; code?: string } | null): boolean {
  return !!error && (/notification_prefs/.test(error.message || '') || error.code === '42703');
}

// GET /api/athletes/notification-prefs?athleteId=… → { prefs }
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ prefs: DEFAULTS });
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athletes').select('notification_prefs').eq('id', athleteId).maybeSingle();
    if (error) {
      // Only a genuinely-unmigrated column should read as "everything on" —
      // this used to catch EVERY error (a transient DB hiccup included) and
      // silently show all-defaults, which looked exactly like a saved
      // "off" preference randomly flipping back to "on" on its own.
      if (isMigrationMissing(error)) return NextResponse.json({ prefs: DEFAULTS });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const saved = (data?.notification_prefs || {}) as Partial<Record<Category, boolean>>;
    // Merge over defaults so any unset category reads as on.
    const prefs = { ...DEFAULTS, ...saved };
    return NextResponse.json({ prefs });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT /api/athletes/notification-prefs { athleteId, category, enabled }
// Owner-only: the athleteId is the caller's own id (stored in localStorage).
// Merges the single toggle into the saved map. Degrades gracefully (501) if the
// column isn't migrated yet.
export async function PUT(request: Request) {
  try {
    const { athleteId, category, enabled } = await request.json();
    // Correlates with the client's logClient('notif-toggle-attempt', {actionId})
    // beacon — `vercel logs --search <actionId>` ties both sides together.
    console.log('[notification-prefs PUT]', request.headers.get('x-action-id'), { athleteId, category, enabled });
    if (!athleteId || !CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'athleteId and a valid category required' }, { status: 400 });
    }
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
    return NextResponse.json({ prefs: { ...DEFAULTS, ...next } });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
