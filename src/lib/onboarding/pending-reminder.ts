import type { createServerClient } from '@/lib/supabase/server';
import { notifyStaff } from '@/lib/notifications/staff';
import { pendingReminderCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';

type Db = ReturnType<typeof createServerClient>;

// ═════════════════════════════════════════════════════════════════════════════
// "Still waiting for approval" — once a day, to the approvers (cron/tick, 09:00).
//
// The joining analysis (2026-10-10, lib/onboarding/funnel): everyone approved
// within hours stayed; the two who waited 3 and 6 days were lost; one request had
// waited 27 days. The sign-up itself already pings the staff once, and a single
// ping is easy to miss. So every morning, for as long as anyone has waited more
// than a day, one push (and the inbox row) lists them, oldest first.
// ═════════════════════════════════════════════════════════════════════════════
const WAIT_MS = 24 * 3600 * 1000;

export async function runPendingReminders(
  supabase: Db,
  now: Date,
  ledger: { already: (tag: string) => Promise<boolean>; markFired: (tag: string, n: number) => Promise<void> },
): Promise<number> {
  const tag = `pendingReminder:${israelToday(now)}`;
  if (await ledger.already(tag)) return 0;
  const { data, error } = await supabase
    .from('signup_requests')
    .select('id, full_name, created_at, athlete_id')
    .eq('status', 'pending')
    .lte('created_at', new Date(now.getTime() - WAIT_MS).toISOString())
    .order('created_at', { ascending: true });
  if (error || !data?.length) { await ledger.markFired(tag, 0); return 0; }
  const rows = data as Array<{ id: string; full_name: string | null; created_at: string; athlete_id: string | null }>;
  const ids = rows.map((r) => r.athlete_id).filter((x): x is string => !!x);
  const { data: ath } = ids.length ? await supabase.from('athletes').select('id, name').in('id', ids) : { data: [] };
  const nameBy = new Map(((ath ?? []) as Array<{ id: string; name: string | null }>).map((a) => [a.id, a.name]));
  const names = rows.map((r) => r.full_name || (r.athlete_id ? nameBy.get(r.athlete_id) : null));
  const oldestDays = Math.floor((now.getTime() - new Date(rows[0].created_at).getTime()) / (24 * 3600 * 1000));
  const { sent } = await notifyStaff({
    kind: 'signup_request',
    url: '/dashboard/entry-queue?at=mine',
    tag,
    category: 'management',
    copy: (locale) => pendingReminderCopy(locale, { names, count: rows.length, oldestDays }),
  });
  await ledger.markFired(tag, sent);
  return rows.length;
}
