import type { SupabaseClient } from '@supabase/supabase-js';
import type { HiddenFieldKey } from '@/lib/feed/project';

/**
 * The stats a runner hides by default (migration 193, settings rev 3 Q1). New runs'
 * feed items are born with `payload.hiddenFields` = this list (the 047 trigger, as
 * replaced in 193), which is what pre-fills the share sheet. Enforcement is unchanged:
 * maskHiddenStats / maskDetailForViewer in lib/feed/project.ts.
 *
 * Read and written on its own (like hr-trace-privacy) so an unapplied 193 costs only
 * this row: `null` = not migrated, and the settings screen leaves the switches out.
 */
export const DEFAULT_HIDDEN_KEYS: readonly HiddenFieldKey[] = ['calories', 'heart_rate', 'pace'];
export const DEFAULT_HIDDEN_DEFAULT: HiddenFieldKey[] = ['calories'];

const missingColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';

export function cleanHiddenList(v: unknown): HiddenFieldKey[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string' && (DEFAULT_HIDDEN_KEYS as readonly string[]).includes(x))) return null;
  return [...new Set(v as HiddenFieldKey[])].sort();
}

export async function readDefaultHidden(db: SupabaseClient, athleteId: string): Promise<HiddenFieldKey[] | null> {
  try {
    const { data, error } = await db.from('athletes').select('default_hidden_fields').eq('id', athleteId).maybeSingle();
    if (missingColumn(error)) return null;
    if (error || !data) return [...DEFAULT_HIDDEN_DEFAULT];
    return cleanHiddenList((data as { default_hidden_fields?: unknown }).default_hidden_fields) ?? [...DEFAULT_HIDDEN_DEFAULT];
  } catch {
    return [...DEFAULT_HIDDEN_DEFAULT];
  }
}

export async function writeDefaultHidden(db: SupabaseClient, athleteId: string, list: HiddenFieldKey[]): Promise<'ok' | 'unmigrated' | 'error'> {
  const { error } = await db.from('athletes').update({ default_hidden_fields: list }).eq('id', athleteId);
  if (!error) return 'ok';
  return missingColumn(error) ? 'unmigrated' : 'error';
}
