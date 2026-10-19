import type { SupabaseClient } from '@supabase/supabase-js';
import { readStorySettings, storyGate, type GateResult, type StoryFeature, type StorySettingsRow } from './gate';
import { effectiveFor, readInstance, visibleAt, type StoryInstance } from './instances';

/**
 * May `viewer` see `owner`'s birthday / annual story NOW? The screen-side twin of
 * runners.ts, so a push and a screen can't disagree. Order:
 *   1. the owner's gate (state, testers, active, opt-out). A preview (admin) is only
 *      possible where the gate itself grants one, so 'off' shows an admin nothing.
 *   2. somebody else's story: the viewer's own gate must be open too (a tester's story is
 *      not shown to the club while the feature is in testing).
 *   3. not a preview: the person's overrides (skipped / enabled=false close it) and the
 *      display window [publish_at, publish_at + display_days).
 * The data loader runs only after a yes.
 */
export interface StoryAccessResult {
  allowed: boolean;
  preview: boolean;
  tester: boolean;
  reason: string;
  settings: StorySettingsRow | null;
  instance: StoryInstance | null;
}

export interface AccessDeps {
  gate: (f: StoryFeature, athleteId: string | null, isAdmin: boolean) => Promise<GateResult>;
  settings: (f: StoryFeature) => Promise<StorySettingsRow | null>;
  instance: (athleteId: string, f: StoryFeature, period: string) => Promise<StoryInstance | null>;
}

export const defaultAccessDeps = (db: SupabaseClient): AccessDeps => ({
  gate: (f, id, isAdmin) => storyGate(f, id, { isAdmin, db: db as never }),
  settings: (f) => readStorySettings(f, { db: db as never }),
  instance: (id, f, p) => readInstance(db, id, f, p),
});

const closed = (reason: string): StoryAccessResult => ({ allowed: false, preview: false, tester: false, reason, settings: null, instance: null });

export async function storyAccess(
  feature: StoryFeature,
  o: { viewerId: string | null; ownerId: string; isAdmin: boolean; period: string | null; now: Date; /** admin prep screen: look outside the window (still never in 'off') */ forcePreview?: boolean },
  deps: AccessDeps,
): Promise<StoryAccessResult> {
  const own = o.viewerId === o.ownerId;
  const ownerGate = await deps.gate(feature, o.ownerId, o.isAdmin);
  if (!ownerGate.allowed) return closed(ownerGate.reason);
  const preview = ownerGate.preview || (o.isAdmin && !!o.forcePreview);
  if (!own && !preview) {
    const viewerGate = await deps.gate(feature, o.viewerId, o.isAdmin);
    if (!viewerGate.allowed) return closed(`viewer_${viewerGate.reason}`);
  }
  const settings = await deps.settings(feature);
  if (!settings) return closed('no_settings');
  if (!o.period) return preview ? { allowed: true, preview: true, tester: false, reason: 'ok', settings, instance: null } : closed('no_period');
  const instance = await deps.instance(o.ownerId, feature, o.period);
  if (preview) return { allowed: true, preview: true, tester: false, reason: 'ok', settings, instance };
  const e = effectiveFor(settings, o.period, instance);
  if (!e.on) return closed(e.reason || 'off');
  if (!visibleAt(e, o.now)) return closed('outside_window');
  return { allowed: true, preview: false, tester: own && ownerGate.tester, reason: 'ok', settings, instance };
}
