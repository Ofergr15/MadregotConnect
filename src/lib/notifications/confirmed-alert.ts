import { createServerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email';
import { recipientsForKind } from '@/lib/notifications/routing';
import { notifyStaff, staffRecipientIds } from '@/lib/notifications/staff';
import type { PushCopy } from '@/lib/notifications/copy';
import type { NotificationLocale } from '@/lib/notifications/locale';
import type { NotificationCategory } from '@/lib/push';

/**
 * A MANAGEMENT ALERT THAT HAS TO BE SEEN, AND IS CHECKED (Ofer, 10-23: "make sure the
 * alert was received; if not, raise an alert that the notification system has a problem").
 *
 * "Sent" proves nothing: Apple accepts a push to a device that is long gone (see
 * /api/push/receipt). What proves it is a phone saying it SHOWED it — the receipt that
 * stamps push_subscriptions.last_success_at. So the alert is sent, and remembered; a later
 * run (the next cron, CHECK_AFTER_MS on) asks whether any recipient's device has reported
 * since. If none has, the push side is broken — and the one way left to say so is email,
 * to the same people.
 */

const KEY = 'alert_checks';
/** Long enough for a phone to have shown it and said so. */
export const CHECK_AFTER_MS = 5 * 60_000;

export interface PendingCheck { tag: string; title: string; sentAt: string; ids: string[] }

async function readPending(): Promise<PendingCheck[]> {
  const { data } = await createServerClient().from('app_settings').select('value').eq('key', KEY).maybeSingle();
  try { return data?.value ? (JSON.parse(data.value as string) as PendingCheck[]) : []; } catch { return []; }
}
async function writePending(list: PendingCheck[]): Promise<void> {
  await createServerClient().from('app_settings').upsert({ key: KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

/** Send it to the kind's people (the admins and Ofer by default), and queue the check. */
export async function sendConfirmedAlert(opts: {
  kind: string; url: string; tag: string; category: NotificationCategory;
  copy: (locale: NotificationLocale) => PushCopy;
}): Promise<{ recipients: number; sent: number }> {
  const ids = [...new Set((await recipientsForKind(opts.kind)) ?? (await staffRecipientIds()))];
  const sentAt = new Date().toISOString();
  const res = await notifyStaff(opts);
  if (ids.length) {
    const list = await readPending().catch(() => [] as PendingCheck[]);
    await writePending([...list.filter((p) => p.tag !== opts.tag), { tag: opts.tag, title: opts.copy('he').title, sentAt, ids }]).catch(() => {});
  }
  return res;
}

/** Whether any of `ids`' devices reported showing a push since `since`. */
export async function confirmedSince(ids: string[], since: string): Promise<number> {
  const { data } = await createServerClient().from('push_subscriptions').select('athlete_id').in('athlete_id', ids).gte('last_success_at', since);
  return new Set(((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id)).size;
}

/**
 * The checks that are due: confirmed → dropped; not → an email to the same people that
 * the notification system has a problem. Returns what it found, for the cron's log.
 */
export async function verifyPendingAlerts(now = Date.now()): Promise<Array<{ tag: string; confirmed: number; of: number }>> {
  const list = await readPending();
  const due = list.filter((p) => now - Date.parse(p.sentAt) >= CHECK_AFTER_MS);
  if (!due.length) return [];
  const out: Array<{ tag: string; confirmed: number; of: number }> = [];
  for (const p of due) {
    const confirmed = await confirmedSince(p.ids, p.sentAt);
    out.push({ tag: p.tag, confirmed, of: p.ids.length });
    if (confirmed > 0) continue;
    console.error('[alerts] not seen on any phone', p.tag, p.sentAt);
    const { data } = await createServerClient().from('athletes').select('email').in('id', p.ids);
    const to = ((data || []) as Array<{ email: string | null }>).map((r) => r.email).filter((e): e is string => !!e);
    if (to.length) {
      await sendEmail({
        template: 'push_not_seen',
        to,
        subject: '⚠️ בעיה במערכת ההתראות של מדרגות',
        html: `<div dir="rtl" style="font-family:-apple-system,Arial,sans-serif;font-size:15px;line-height:1.5">
<p><b>התראה לא הגיעה לאף טלפון.</b></p>
<p>ההתראה „${escapeHtml(p.title)}" נשלחה ב־${new Date(p.sentAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })} אל ${p.ids.length} אנשי ניהול, ואף מכשיר לא אישר שהציג אותה.</p>
<p>כדאי לבדוק: האפליקציה מותקנת במסך הבית, ההתראות מופעלות בהגדרות הטלפון ובאפליקציה (הגדרות ← התראות ← בדיקת התראה).</p>
</div>`,
      });
    }
  }
  await writePending(list.filter((p) => !due.includes(p)));
  return out;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
