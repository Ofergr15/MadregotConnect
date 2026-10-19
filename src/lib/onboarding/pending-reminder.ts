import type { createServerClient } from '@/lib/supabase/server';
import { notifyStaff } from '@/lib/notifications/staff';
import { pendingReminderCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';
import { notifyAdminPendingDigest } from '@/lib/email';

type Db = ReturnType<typeof createServerClient>;

// ═════════════════════════════════════════════════════════════════════════════
// "Still waiting for approval" — once a day, to the approvers (cron/tick, 09:00).
//
// The joining analysis (2026-10-10, lib/onboarding/funnel): everyone approved
// within hours stayed; the two who waited 3 and 6 days were lost; one request had
// waited 27 days. The sign-up itself already pings the staff once, and a single
// ping is easy to miss. So every morning, for as long as anyone has waited more
// than a day, one push (and the inbox row) lists them, oldest first.
//
// 2026-10-19, escalating: past two days it also comes in the EVENING (19:00) and
// by email to every approver, and the push opens the joining funnel already on
// the approval step, where each of them is one tap from approved.
// ═════════════════════════════════════════════════════════════════════════════
const WAIT_MS = 24 * 3600 * 1000;
const ESCALATE_MS = 48 * 3600 * 1000;
/** Where the reminder lands: the funnel, on the people waiting for approval. */
export const PENDING_REMINDER_URL = '/dashboard/onboarding-funnel?stage=approved';

export async function runPendingReminders(
  supabase: Db,
  now: Date,
  ledger: { already: (tag: string) => Promise<boolean>; markFired: (tag: string, n: number) => Promise<void> },
  /** 'evening': the second, escalated round — only for waits past two days, and by email too. */
  slot: 'morning' | 'evening' = 'morning',
): Promise<number> {
  const tag = `pendingReminder:${israelToday(now)}${slot === 'evening' ? ':evening' : ''}`;
  if (await ledger.already(tag)) return 0;
  const { data, error } = await supabase
    .from('signup_requests')
    .select('id, full_name, created_at, athlete_id')
    .eq('status', 'pending')
    .lte('created_at', new Date(now.getTime() - (slot === 'evening' ? ESCALATE_MS : WAIT_MS)).toISOString())
    .order('created_at', { ascending: true });
  if (error || !data?.length) { await ledger.markFired(tag, 0); return 0; }
  const all = data as Array<{ id: string; full_name: string | null; created_at: string; athlete_id: string | null }>;
  const ids = all.map((r) => r.athlete_id).filter((x): x is string => !!x);
  const { data: ath } = ids.length ? await supabase.from('athletes').select('id, name, approved').in('id', ids) : { data: [] };
  const athRows = (ath ?? []) as Array<{ id: string; name: string | null; approved: boolean | null }>;
  const nameBy = new Map(athRows.map((a) => [a.id, a.name]));
  // A request whose person is already approved is bookkeeping, not somebody at the
  // door (approval-sync closes it on the next approve); it does not ring anybody.
  const approved = new Set(athRows.filter((a) => a.approved === true).map((a) => a.id));
  const rows = all.filter((r) => !r.athlete_id || !approved.has(r.athlete_id));
  if (!rows.length) { await ledger.markFired(tag, 0); return 0; }
  const names = rows.map((r) => r.full_name || (r.athlete_id ? nameBy.get(r.athlete_id) : null));
  const oldestDays = Math.floor((now.getTime() - new Date(rows[0].created_at).getTime()) / (24 * 3600 * 1000));
  const { sent } = await notifyStaff({
    kind: 'signup_request',
    url: PENDING_REMINDER_URL,
    tag,
    category: 'management',
    copy: (locale) => pendingReminderCopy(locale, { names, count: rows.length, oldestDays }),
  });
  if (slot === 'evening') {
    await notifyAdminPendingDigest({ names: names.map((n) => n ?? null), count: rows.length, oldestDays }).catch(() => undefined);
  }
  await ledger.markFired(tag, sent);
  return rows.length;
}
