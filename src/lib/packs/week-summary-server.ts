import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysToDateStr } from '@/lib/utils';
import { CHANNEL_TYPE, getStreamServerClient } from '@/lib/stream/server';
import { packChannelId, packMembers } from './server';
import { summariseWeek, type ChatMessage } from './summary';

/** Sunday 07:00 Israel (cron/tick): the week that just closed. */
export function isSummaryTick(weekday: number, hour: number): boolean {
  return weekday === 0 && hour === 7;
}

/**
 * Write `pack_week_summaries` for every pack for the plan week `weekStart`. Never throws.
 * A pack already summarised for that week is skipped, so the 12 ticks of the hour write once.
 */
export async function writePackWeekSummaries(db: SupabaseClient, weekStart: string): Promise<{ written: number }> {
  let written = 0;
  try {
    const [{ data: groups }, { data: done, error: doneErr }] = await Promise.all([
      db.from('groups').select('id'),
      db.from('pack_week_summaries').select('pack_id').eq('week_start', weekStart),
    ]);
    if (doneErr) return { written }; // 216 not pasted yet
    const skip = new Set(((done || []) as Array<{ pack_id: string }>).map((d) => d.pack_id));
    const weekEnd = addDaysToDateStr(weekStart, 7);
    let stream: ReturnType<typeof getStreamServerClient> | null = null;
    try { stream = getStreamServerClient(); } catch { stream = null; }
    for (const g of (groups || []) as Array<{ id: string }>) {
      if (skip.has(g.id)) continue;
      let messages: ChatMessage[] = [];
      if (stream) {
        try {
          const [ch] = await stream.queryChannels(
            { type: CHANNEL_TYPE, id: packChannelId(g.id) }, [{ last_message_at: -1 }],
            { limit: 1, message_limit: 300, state: true, watch: false, presence: false },
          );
          messages = ((ch?.state.messages ?? []) as any[]).map((m) => ({
            id: String(m.id), userId: m.user?.id ?? null, text: String(m.text ?? ''),
            createdAt: new Date(m.created_at).toISOString(),
          }));
        } catch (err) {
          console.warn('[pack-summary] Stream read failed', g.id, err);
        }
      }
      const [members, { data: att }] = await Promise.all([
        packMembers(db, g.id),
        db.from('pack_attendance').select('session_date, status').eq('pack_id', g.id)
          .gte('session_date', weekStart).lt('session_date', weekEnd),
      ]);
      if (!messages.length && !(att || []).length) continue; // nothing happened: no row
      const byDate = new Map<string, number>();
      for (const r of (att || []) as Array<{ session_date: string; status: string }>) {
        byDate.set(r.session_date, (byDate.get(r.session_date) ?? 0) + (r.status === 'present' ? 1 : 0));
      }
      const attendance = [...byDate].sort().map(([date, present]) => ({ date, present, total: members.length }));
      const s = summariseWeek(weekStart, messages, attendance);
      const { error } = await db.from('pack_week_summaries').upsert({
        pack_id: g.id, week_start: weekStart, msg_by_day: s.msgByDay, items: s.items, attendance: s.attendance,
      }, { onConflict: 'pack_id,week_start', ignoreDuplicates: true });
      if (!error) written++;
    }
  } catch (err) {
    console.error('[pack-summary] failed', err);
  }
  return { written };
}
