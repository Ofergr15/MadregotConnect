import type { createServerClient } from '@/lib/supabase/server';
import { surveyAudienceIds } from '@/lib/surveys';
import { fromRow, isMissingComposerTable, nextOccurrence, type ComposerRow } from './model';

type Db = ReturnType<typeof createServerClient>;

/** Rows one tick looks at; the rest wait for the next tick. */
export const DRY_RUN_BATCH = 25;

export interface DryRunReport {
  missingTable: boolean;
  due: number;
  recorded: Array<{ id: string; occurrenceAt: string; audience: number; pushDevices: number; push: boolean; nextRunAt: string | null }>;
  /** Always 0: this cron never sends. */
  sent: 0;
}

/**
 * The dry-run sender (task 153): every enabled composer row whose next_run_at has come, its
 * audience resolved exactly as a survey's would be (lib/surveys surveyAudienceIds), recorded
 * in scheduled_composer_dry_runs, and next_run_at moved to the following occurrence (null for
 * a one-off). NOTHING is pushed and nothing is written to anyone's inbox.
 *
 * A row is advanced by a conditional update on the next_run_at it was read with, so two
 * overlapping ticks record an occurrence once (and the dry-run table's UNIQUE backs that up).
 */
export async function dryRunDueComposerItems(db: Db, now: Date = new Date()): Promise<DryRunReport> {
  const nowIso = now.toISOString();
  const report: DryRunReport = { missingTable: false, due: 0, recorded: [], sent: 0 };
  const { data, error } = await db.from('scheduled_composer_items').select('*')
    .eq('enabled', true).lte('next_run_at', nowIso).order('next_run_at').limit(DRY_RUN_BATCH);
  if (isMissingComposerTable(error)) return { ...report, missingTable: true };
  if (error) throw error;
  const rows = (data ?? []) as ComposerRow[];
  report.due = rows.length;
  for (const row of rows) {
    const item = fromRow(row);
    const occurrenceAt = row.next_run_at as string;
    const next = nextOccurrence(item, now.getTime());
    const { data: claimed, error: claimErr } = await db.from('scheduled_composer_items')
      .update({ next_run_at: next, last_dry_run_at: nowIso, updated_at: nowIso })
      .eq('id', row.id).eq('next_run_at', occurrenceAt).select('id');
    if (claimErr) throw claimErr;
    if (!(claimed ?? []).length) continue;   // another tick took it
    const ids = await surveyAudienceIds(db, item.audienceType, item.audienceId);
    let pushDevices = 0;
    if (item.push && ids.length) {
      const { count } = await db.from('push_subscriptions').select('id', { count: 'exact', head: true }).in('athlete_id', ids);
      pushDevices = count ?? 0;
    }
    const { error: logErr } = await db.from('scheduled_composer_dry_runs')
      .upsert({ item_id: row.id, occurrence_at: occurrenceAt, audience_count: ids.length, push_device_count: pushDevices }, { onConflict: 'item_id,occurrence_at', ignoreDuplicates: true });
    if (logErr) console.error('[scheduled-composer] dry-run log failed', logErr.message);
    report.recorded.push({ id: row.id, occurrenceAt, audience: ids.length, pushDevices, push: item.push, nextRunAt: next });
  }
  return report;
}
