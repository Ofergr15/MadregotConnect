import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { STORY_PREF_KEYS, isPrefsColumnMissing, parseStoryPrefs, type StoryPrefKey } from '@/lib/stories/prefs';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/me/story-prefs — the caller's OWN story opt-outs (athletes.story_prefs).
 * Self only, from the verified session; a view-as may read but not write.
 * `ready:false` = migration 157 not pasted (the settings rows hide).
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ ready: false, prefs: {} });
  const { data, error } = await createServerClient().from('athletes').select('story_prefs').eq('id', caller.athleteId).maybeSingle();
  if (error) return isPrefsColumnMissing(error) ? NextResponse.json({ ready: false, prefs: {} }) : NextResponse.json({ error: 'read failed' }, { status: 500 });
  return NextResponse.json({ ready: true, prefs: parseStoryPrefs((data as { story_prefs?: unknown } | null)?.story_prefs) });
}

export async function PUT(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 400 });
  if (caller.viewingAsBy) return NextResponse.json({ error: 'not while viewing as' }, { status: 403 });
  const { key, enabled } = (await request.json().catch(() => ({}))) as { key?: StoryPrefKey; enabled?: boolean };
  if (!key || !STORY_PREF_KEYS.includes(key) || typeof enabled !== 'boolean') return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('story_prefs').eq('id', caller.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: isPrefsColumnMissing(error) ? 'not ready' : 'read failed' }, { status: isPrefsColumnMissing(error) ? 501 : 500 });
  const prefs = parseStoryPrefs((data as { story_prefs?: unknown } | null)?.story_prefs);
  // ON = the key removed (missing = on); OFF = an explicit false.
  if (enabled) delete prefs[key]; else prefs[key] = false;
  const { error: e2 } = await db.from('athletes').update({ story_prefs: prefs }).eq('id', caller.athleteId);
  if (e2) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ ready: true, prefs });
}
