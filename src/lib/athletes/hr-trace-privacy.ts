import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The runner-wide switch for the heart-rate trace on the run page (migration 147).
 *
 * Read on its own, never as part of a bigger select: migrations are pasted by hand,
 * so the deploy is live before the column exists, and one missing column must not
 * blank the profile or 500 the run page. Missing column, missing row and NULL all
 * read as TRUE — the default the migration sets.
 */

const missingColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';

export async function readHrTracePublic(supabase: SupabaseClient, athleteId: string): Promise<boolean> {
  return (await readHrTraceSetting(supabase, athleteId)) !== false;
}

/**
 * The switch as Settings shows it: `null` while migration 147 isn't applied, so the
 * screen can leave the row out instead of offering a switch that cannot save.
 */
export async function readHrTraceSetting(supabase: SupabaseClient, athleteId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('athletes')
      .select('hr_trace_public')
      .eq('id', athleteId)
      .maybeSingle();
    if (missingColumn(error)) return null;
    if (error || !data) return true;
    return (data as { hr_trace_public?: boolean | null }).hr_trace_public !== false;
  } catch {
    return true;
  }
}

export type HrTraceWrite = 'ok' | 'unmigrated' | 'error';

export async function writeHrTracePublic(
  supabase: SupabaseClient,
  athleteId: string,
  value: boolean,
): Promise<HrTraceWrite> {
  const { error } = await supabase.from('athletes').update({ hr_trace_public: value }).eq('id', athleteId);
  if (!error) return 'ok';
  return missingColumn(error) ? 'unmigrated' : 'error';
}

/**
 * May this viewer see the HR line on this run? The runner and staff always may.
 * Everyone else needs the runner's switch on AND this run's heart rate not hidden
 * in the share sheet.
 */
export function mayViewHrTrace({
  isSelfOrStaff,
  runnerAllows,
  hiddenOnThisRun,
}: {
  isSelfOrStaff: boolean;
  runnerAllows: boolean;
  hiddenOnThisRun: boolean;
}): boolean {
  if (isSelfOrStaff) return true;
  return runnerAllows && !hiddenOnThisRun;
}
