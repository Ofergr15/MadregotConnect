import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { createServerClient } from '@/lib/supabase/server';
import { ORDER_SOURCES } from './sources';

type Db = ReturnType<typeof createServerClient>;

/**
 * Reads the club's Gmail (GMAIL_IMAP_USER + an app password in GMAIL_IMAP_APP_PASSWORD) and stores
 * one partner_orders row per order email. READ-ONLY: the mailbox is opened with readOnly and only
 * BODY.PEEK is fetched, so nothing is marked as read. Re-reading is harmless (message_id is unique).
 * `sinceDays` bounds the search; null reads everything (the first backfill).
 */
export async function syncPartnerOrders(supabase: Db, sinceDays: number | null = 45) {
  const user = process.env.GMAIL_IMAP_USER, pass = process.env.GMAIL_IMAP_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) return { skipped: 'no mailbox credentials' as const };
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const out = { read: 0, stored: 0, unparsed: 0 };
  try {
    const lock = await client.getMailboxLock('[Gmail]/All Mail', { readOnly: true });
    try {
      for (const src of ORDER_SOURCES) {
        const since = sinceDays == null ? '' : ` newer_than:${sinceDays}d`;
        const uids = await client.search({ gmraw: src.query + since }, { uid: true });
        if (!uids || uids.length === 0) continue;
        const rows = [];
        for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
          out.read++;
          if (!msg.source) continue;
          const mail = await simpleParser(msg.source);
          const parsed = src.parse(mail.text || (typeof mail.html === 'string' ? mail.html.replace(/<[^>]+>/g, ' ') : ''));
          if (!parsed) { out.unparsed++; continue; }
          rows.push({
            partner: src.partner, via: src.via, source: src.id,
            order_number: parsed.orderNumber, amount: parsed.amount, commission: parsed.commission,
            ordered_at: new Date(mail.date ?? msg.envelope?.date ?? Date.now()).toISOString(),
            message_id: mail.messageId ?? `${src.id}:${msg.uid}`,
          });
        }
        if (rows.length) {
          const { error, count } = await supabase.from('partner_orders').upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true, count: 'exact' });
          if (error) throw error;
          out.stored += count ?? 0;
        }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return out;
}
