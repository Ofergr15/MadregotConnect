import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { resendInviteMail } from '@/lib/academy/invite-email';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/academy/members/invite/resend — `{ cardId, kind: 'form' | 'install' }`.
 * "שליחה חוזרת" on one card: the same mail, the same link, to that one person (the import
 * board and the "כבר מתאמנים" invite). No account, no new token, nobody else. 429 when the
 * same mail for the same card went out in the last minute (a double tap). Manager only,
 * like the invite itself.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const cardId = typeof b.cardId === 'string' && UUID_RE.test(b.cardId) ? b.cardId : null;
    const kind = b.kind === 'form' || b.kind === 'install' ? b.kind : null;
    if (!cardId || !kind) return NextResponse.json({ error: 'cardId and kind are required' }, { status: 400 });
    const result = await resendInviteMail(createServerClient(), caller, cardId, kind);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('POST /api/academy/members/invite/resend error:', error);
    return NextResponse.json({ error: 'Failed to resend' }, { status: 500 });
  }
}
