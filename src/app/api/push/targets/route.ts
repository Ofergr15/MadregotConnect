import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { NATIVE_TARGET_KINDS, nativeRoutingMap } from '@/lib/notifications/push-targets';

export const dynamic = 'force-dynamic';

// GET /api/push/targets — push url pattern → native screen kind (task 83). The same table the
// push builder uses (lib/notifications/push-targets.ts), so the native router can check at
// launch that it handles every kind the server may send. Member-gated; static, no PII.
export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return NextResponse.json(
    { kinds: NATIVE_TARGET_KINDS, targets: nativeRoutingMap(), ledgerPrefix: '#ledger:' },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
