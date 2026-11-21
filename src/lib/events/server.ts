import type { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { effectiveStatus, isMissingSchema, type EventBlock } from './lifecycle';

type Db = ReturnType<typeof createServerClient>;

/**
 * The caller of a read that stays public for published content (GET /api/events has
 * never required auth). No credential → anonymous; a bad credential → anonymous too,
 * never a 401, so the old public read keeps working. Only a VERIFIED staff caller
 * unlocks drafts, and only a verified member unlocks blocks.
 */
export async function optionalCaller(request: Request): Promise<VerifiedCaller | null> {
  if (!request.headers.get('authorization')) return null;
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    return denied ? null : caller;
  } catch {
    return null;
  }
}

export function callerIsStaff(c: VerifiedCaller | null): boolean {
  return !!c && (c.isStaff || c.isSuperUser);
}

/** Blocks for one event, ordered. [] when the table isn't there yet. */
export async function loadBlocks(supabase: Db, eventId: string): Promise<EventBlock[]> {
  const { data, error } = await supabase
    .from('event_blocks')
    .select('id, kind, position, enabled, config')
    .eq('event_id', eventId)
    .order('position', { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as EventBlock[];
}

/** Replace the whole block list (delete + insert; blocks have no inbound references). */
export async function replaceBlocks(supabase: Db, eventId: string, blocks: EventBlock[]): Promise<void> {
  const del = await supabase.from('event_blocks').delete().eq('event_id', eventId);
  if (del.error) throw del.error;
  if (blocks.length === 0) return;
  const ins = await supabase.from('event_blocks').insert(
    blocks.map((b, i) => ({ event_id: eventId, kind: b.kind, position: i, enabled: b.enabled, config: b.config })),
  );
  if (ins.error) throw ins.error;
}

/**
 * Ids of events a member must not see right now (drafts, not-yet-live scheduled).
 * For the reads that select a narrow column list and so can't run `projectEvents`
 * themselves (upcoming card, search, cron reminders). Empty before migration 184.
 */
export async function hiddenEventIds(supabase: Db, now: Date = new Date()): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('events')
    .select('id, status, publish_at')
    .neq('status', 'published');
  if (error) {
    if (isMissingSchema(error)) return new Set();
    throw error;
  }
  const hidden = new Set<string>();
  for (const r of (data ?? []) as Array<{ id: string; status: string; publish_at: string | null }>) {
    if (effectiveStatus(r, now) !== 'published') hidden.add(r.id);
  }
  return hidden;
}
