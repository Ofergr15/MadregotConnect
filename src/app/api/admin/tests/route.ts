import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { SUPER_USER_EMAIL } from '@/lib/constants';
import { testStatus } from '@/lib/testing/status';
import { readiness, summarise } from '@/lib/testing/readiness';
import { cleanupTestAccounts, createImportCard, fixTestEmail } from '@/lib/testing/actions';
import { SETUP_GATE_FOR_ALL } from '@/lib/setup/flag';
import { JOIN_UNIFIED_FOR_ALL } from '@/lib/join/flag';

export const dynamic = 'force-dynamic';

// The hand-test screen (/dashboard/tests): GET = the readiness checks + every flow's live
// status; POST = the three test-only writes (lib/testing/actions). Super user only.

async function gate(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!caller.isSuperUser) return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { caller };
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const db = createServerClient();
  const [checks, flows] = await Promise.all([
    readiness(db as never, { env: process.env, superUserEmail: SUPER_USER_EMAIL, flags: { setupGate: SETUP_GATE_FOR_ALL, joinUnified: JOIN_UNIFIED_FOR_ALL } }),
    testStatus(db as never),
  ]);
  return NextResponse.json({ checks, summary: summarise(checks), flows, at: new Date().toISOString() });
}

export async function POST(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const db = createServerClient();
  const body = await request.json().catch(() => ({}));
  if (body?.action === 'cleanup') {
    if (body.confirm !== 'מחיקה') return NextResponse.json({ error: 'confirm' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await cleanupTestAccounts(db as never)) });
  }
  if (body?.action === 'fix-email') return NextResponse.json({ ok: await fixTestEmail(db as never, String(body.id || ''), String(body.email || '')) });
  if (body?.action === 'create-import-card') return NextResponse.json({ ok: await createImportCard(db as never, g.caller!.athleteId ?? null) });
  return NextResponse.json({ error: 'bad-action' }, { status: 400 });
}
