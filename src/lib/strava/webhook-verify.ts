// Strava webhook authenticity + durable idempotency (task 192).
//
// ── THERE IS NO SIGNATURE TO VERIFY ─────────────────────────────────────────
// Strava does not sign webhook events: no HMAC header, no shared-secret body
// field (developers.strava.com/docs/webhooks). The only secret in the protocol is
// `hub.verify_token`, and Strava sends it once, on the subscription handshake GET.
// So what this checks is everything a POST can actually be held to:
//
//   1. shape: the exact fields Strava sends, with the types it sends them in
//   2. subscription_id equals the one Strava gave us (STRAVA_WEBHOOK_SUBSCRIPTION_ID).
//      A forger has to know it; an event from a stale, replaced subscription is
//      refused too. Unset → not checked (today's behaviour; logged once).
//   3. event_time inside a window: a captured event replayed days later is refused.
//
// And it changes nothing the event can do: the webhook only ever triggers a sync
// that READS the athlete's own activities from Strava with the token we hold. A
// forged event can at worst cost one sync, which the idempotency below caps.
import { timingSafeEqual } from 'node:crypto';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import type { StravaEvent } from '@/lib/strava/webhook-dedupe';

/** Strava retries a missed ack for ~a day at most; anything older is a replay. */
export const MAX_EVENT_AGE_S = 24 * 3600;
/** Clock skew allowance for an event_time slightly ahead of ours. */
export const MAX_EVENT_SKEW_S = 10 * 60;
export const EVENT_RETENTION_DAYS = 7;

const ASPECTS = new Set(['create', 'update', 'delete']);
const OBJECT_TYPES = new Set(['activity', 'athlete']);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Constant-time compare for the handshake's hub.verify_token. Empty/missing never matches. */
export function verifyTokenMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type VerifyResult =
  | { ok: true; event: StravaEvent & { subscription_id?: number } }
  | { ok: false; reason: 'shape' | 'subscription' | 'stale' | 'future' };

export function verifyStravaEvent(
  payload: unknown,
  opts: { subscriptionId?: string | null; nowS?: number } = {},
): VerifyResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'shape' };
  const p = payload as Record<string, unknown>;
  if (typeof p.object_type !== 'string' || !OBJECT_TYPES.has(p.object_type)) return { ok: false, reason: 'shape' };
  if (typeof p.aspect_type !== 'string' || !ASPECTS.has(p.aspect_type)) return { ok: false, reason: 'shape' };
  if (!posInt(p.object_id) || !posInt(p.owner_id) || !posInt(p.event_time)) return { ok: false, reason: 'shape' };
  if (p.subscription_id !== undefined && !posInt(p.subscription_id)) return { ok: false, reason: 'shape' };

  const want = (opts.subscriptionId ?? '').trim();
  if (want && String(p.subscription_id ?? '') !== want) return { ok: false, reason: 'subscription' };

  const now = opts.nowS ?? Math.floor(Date.now() / 1000);
  if (p.event_time < now - MAX_EVENT_AGE_S) return { ok: false, reason: 'stale' };
  if (p.event_time > now + MAX_EVENT_SKEW_S) return { ok: false, reason: 'future' };

  return {
    ok: true,
    event: {
      object_type: p.object_type,
      aspect_type: p.aspect_type,
      object_id: p.object_id,
      owner_id: p.owner_id,
      event_time: p.event_time,
      ...(p.subscription_id !== undefined ? { subscription_id: p.subscription_id as number } : {}),
    },
  };
}

type InsertResult = { error: { code?: string; message?: string } | null };
export interface EventStore {
  from(table: 'strava_webhook_events'): {
    insert(row: { event_key: string }): PromiseLike<InsertResult>;
    delete(): { lt(col: 'received_at', v: string): PromiseLike<InsertResult> };
  };
}

/**
 * Claim an event key across instances. 'first' → go ahead; 'duplicate' → another
 * instance or an earlier delivery already took it; 'unknown' → the table is missing
 * (356 not applied) or the insert failed, and the caller falls back to its
 * in-memory answer. Never throws.
 */
export async function claimStravaEvent(db: EventStore, key: string): Promise<'first' | 'duplicate' | 'unknown'> {
  try {
    const { error } = await db.from('strava_webhook_events').insert({ event_key: key });
    if (!error) return 'first';
    if (error.code === '23505') return 'duplicate';
    if (!isMissingTable(error)) console.error('[strava/webhook] event claim failed:', error.code ?? '', error.message ?? '');
    return 'unknown';
  } catch (e) {
    console.error('[strava/webhook] event claim threw:', e instanceof Error ? e.message : String(e));
    return 'unknown';
  }
}

/** Drop claims older than the retention window. Best effort. */
export async function purgeOldStravaEvents(db: EventStore, nowMs = Date.now()): Promise<void> {
  try {
    await db.from('strava_webhook_events').delete().lt('received_at', new Date(nowMs - EVENT_RETENTION_DAYS * 86_400_000).toISOString());
  } catch {
    /* the next event retries */
  }
}
