import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { eventRowFrom, recipientStatuses, campaignTotals, unopened, type LogRow } from '@/lib/email/tracking';

describe('eventRowFrom', () => {
  it('maps Resend events and keeps only link/bounce detail', () => {
    const r = eventRowFrom({ type: 'email.clicked', created_at: '2026-11-25T10:00:00Z', data: { email_id: 'e1', to: ['A@x.com'], click: { link: 'https://a' } } }, 'msg_1');
    expect(r).toMatchObject({ type: 'clicked', provider_id: 'e1', recipient: 'a@x.com', detail: 'https://a/', svix_id: 'msg_1' });
    expect(eventRowFrom({ type: 'email.opened', data: { email_id: 'e1' } }, null)?.type).toBe('opened');
    expect(eventRowFrom({ type: 'contact.created', data: { email_id: 'e1' } }, null)).toBeNull();
    expect(eventRowFrom({ type: 'email.opened', data: {} }, null)).toBeNull();
  });
});

const log = (id: string, status = 'sent'): LogRow => ({ id, created_at: '2026-11-25T09:00:00Z', recipients: [`${id}@x.com`], status, provider_id: `p${id}`, athlete_id: null });
const ev = (id: string, type: string) => ({ type: type as never, provider_id: `p${id}`, occurred_at: '2026-11-25T10:00:00Z' });

describe('recipient status + totals', () => {
  const rows = recipientStatuses(
    [log('a', 'delivered'), log('b', 'delivered'), log('c', 'delivered'), log('d', 'bounced'), log('e', 'refused'), log('f')],
    [ev('a', 'delivered'), ev('a', 'opened'), ev('a', 'opened'), ev('b', 'delivered'), ev('b', 'clicked'), ev('c', 'delivered'), ev('d', 'bounced')],
  );
  it('takes the strongest state', () => {
    expect(rows.map(r => r.state)).toEqual(['opened', 'clicked', 'delivered', 'bounced', 'failed', 'sent']);
    expect(rows[0].opens).toBe(2);
  });
  it('counts a click as an open (images off)', () => {
    const t = campaignTotals(rows);
    expect(t).toMatchObject({ recipients: 6, delivered: 3, opened: 2, clicked: 1, bounced: 1, failed: 1 });
    expect(t.openRate).toBe(67);
  });
  it('resends only to delivered/sent with no open — never a bounce or failure', () => {
    expect(unopened(rows).map(r => r.email)).toEqual(['c@x.com', 'f@x.com']);
  });
});

// ── the webhook: signature first, then the event row ───────────────────────────
const inserted: Array<{ table: string; row: unknown }> = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => { inserted.push({ table, row }); return { error: null }; },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

describe('POST /api/webhooks/resend', async () => {
  const { POST } = await import('@/app/api/webhooks/resend/route');
  const key = Buffer.from('test-secret-bytes');
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString('base64')}`;
  const signed = (body: string, sig?: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const s = sig ?? createHmac('sha256', key).update(`msg_9.${ts}.${body}`).digest('base64');
    return new Request('http://x/api/webhooks/resend', { method: 'POST', body, headers: { 'svix-id': 'msg_9', 'svix-timestamp': ts, 'svix-signature': `v1,${s}` } });
  };

  it('refuses a bad signature and writes nothing', async () => {
    inserted.length = 0;
    const res = await POST(signed(JSON.stringify({ type: 'email.opened', data: { email_id: 'e1' } }), 'nope'));
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it('records an open as an email_events row', async () => {
    inserted.length = 0;
    const res = await POST(signed(JSON.stringify({ type: 'email.opened', data: { email_id: 'e1', to: ['a@x.com'] } })));
    expect(res.status).toBe(200);
    expect(inserted).toEqual([{ table: 'email_events', row: expect.objectContaining({ type: 'opened', provider_id: 'e1', svix_id: 'msg_9' }) }]);
  });
});
