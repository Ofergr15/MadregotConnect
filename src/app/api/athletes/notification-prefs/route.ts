import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CATEGORIES, defaultsFor, isMigrationMissing, mergeWithDefaults, type SavedPrefs } from '@/lib/notifications/prefs';
import { isStaffRole } from '@/lib/constants';
import { isSupportedNotificationLocale } from '@/lib/notifications/locale';
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
    if (!athleteId) return NextResponse.json({ prefs: defaultsFor(false), isStaff: false });
    const denied = await gate(request, athleteId);
    if (denied) return denied;
    const supabase = createServerClient();
    // `role` because an untouched category's baseline depends on it — staff
    // default OUT of the social channel (see STAFF_QUIET_CATEGORIES), so a coach
    // who has never opened this screen must see that switch already off rather
    // than on-but-silently-not-sending.
    const { data, error } = await supabase
      .from('athletes').select('role, notification_prefs').eq('id', athleteId).maybeSingle();
    if (error) {
      if (isMigrationMissing(error)) return NextResponse.json({ prefs: defaultsFor(false), isStaff: false });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const isStaff = isStaffRole(data?.role);
    const prefs = mergeWithDefaults(data?.notification_prefs as SavedPrefs | undefined, isStaff);
    return NextResponse.json({ prefs, isStaff });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT /api/athletes/notification-prefs { athleteId, category, enabled }
//                                    or { athleteId, language: 'he' | 'en' }
// Owner-or-staff, enforced by `gate` above. Merges the single change into the
// saved map. Degrades gracefully (501) if the column isn't migrated yet.
//
// `language` shares this column with the category booleans deliberately — see
// src/lib/notifications/locale.ts for why the notification language cannot live
// in the NEXT_LOCALE cookie the UI uses (no cookie exists inside the cron and
// sync jobs that send almost every push).
export async function PUT(request: Request) {
  try {
    const { athleteId, category, enabled, language } = await request.json();
    // Correlates with the client's logClient('notif-toggle-attempt', {actionId})
    // beacon — `vercel logs --search <actionId>` ties both sides together.
    console.log('[notification-prefs PUT]', request.headers.get('x-action-id'), { athleteId, category, enabled, language });
    const isLanguageChange = language !== undefined;
    if (!athleteId || (isLanguageChange
      ? !isSupportedNotificationLocale(language)
      : !CATEGORIES.includes(category))) {
      return NextResponse.json(
        { error: 'athleteId and either a valid category or a supported language required' },
        { status: 400 },
      );
    }
    const denied = await gate(request, athleteId);
    if (denied) return denied;
    const supabase = createServerClient();
    // Read current, merge, write back (small JSON; no concurrent-writer concern per user).
    const cur = await supabase.from('athletes').select('role, notification_prefs').eq('id', athleteId).maybeSingle();
    if (isMigrationMissing(cur.error)) {
      return NextResponse.json({ error: 'notification_prefs not migrated (run migration 038)' }, { status: 501 });
    }
    if (cur.error) throw cur.error;
    const next = {
      ...(cur.data?.notification_prefs || {}),
      // `language` is already known to be exactly 'he' or 'en' — the guard above
      // is the strict check, so nothing needs normalizing on the way in.
      ...(isLanguageChange ? { language } : { [category]: !!enabled }),
    };
    const { error } = await supabase.from('athletes').update({ notification_prefs: next }).eq('id', athleteId);
    if (error) {
      if (isMigrationMissing(error)) {
        return NextResponse.json({ error: 'notification_prefs not migrated (run migration 038)' }, { status: 501 });
      }
      throw error;
    }
    const isStaff = isStaffRole(cur.data?.role);
    return NextResponse.json({ prefs: mergeWithDefaults(next, isStaff), isStaff });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
