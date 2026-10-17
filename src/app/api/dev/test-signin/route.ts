/**
 * POST /api/dev/test-signin
 *
 * Dev-only. Uses the service-role admin client to generate a Supabase magic
 * link for a test account. The link works regardless of which auth providers
 * are enabled (Google-only is fine). Following the link in the browser sets a
 * real JWT session, so requireSession() works correctly.
 *
 * Also creates the auth.users row if it doesn't exist yet, so no manual
 * "create user in dashboard" step is needed.
 *
 * Force-approves the matching athletes row — seed inserts historically left
 * `approved` at its DEFAULT false, which parks /auth/resolve on pending-approval.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';

export const dynamic = 'force-dynamic';

const TEST_USERS: Record<string, { id: string; name: string; role: 'runner' | 'coach'; coachId: string }> = {
  'test-runner@madregot.local': {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'Test Runner',
    role: 'runner',
    coachId: 'aaaaaaaa-0000-0000-0000-000000000002',
  },
  'test-coach@madregot.local': {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    name: 'Test Coach',
    role: 'coach',
    coachId: 'aaaaaaaa-0000-0000-0000-000000000002',
  },
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function magicLink(admin: ReturnType<typeof adminClient>, email: string, origin: string) {
  const result = await createSyntheticSession(admin, email);
  if (result.error || !result.session) return { error: result.error || 'Session creation failed' };
  const fragment = new URLSearchParams({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
    expires_in: String(result.session.expires_in),
    token_type: result.session.token_type,
    type: 'dev',
  });
  return { url: `${origin}/auth/resolve#${fragment.toString()}` };
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const body = (await req.json()) as { email?: string; athleteId?: string };
  const admin = adminClient();
  const origin = req.headers.get('origin') ?? 'http://localhost:3000';

  // ── Strava-linked athlete (re-enter after first real OAuth) ───────────────
  if (body.athleteId || (body.email && /@strava\.madregot\.local$/i.test(body.email))) {
    let q = admin
      .from('athletes')
      .select('id, email, name, strava_auth')
      .not('strava_auth', 'is', null);
    if (body.athleteId) q = q.eq('id', body.athleteId);
    else q = q.eq('email', body.email!);

    const { data: athlete, error: athleteErr } = await q.maybeSingle();
    if (athleteErr || !athlete?.email) {
      return NextResponse.json(
        { error: athleteErr?.message || 'No Strava-linked athlete found — use Strava login first' },
        { status: 404 },
      );
    }

    await admin
      .from('athletes')
      .update({
        approved: true,
        status: 'active',
        approved_at: new Date().toISOString(),
      })
      .eq('id', athlete.id);

    const result = await magicLink(admin, athlete.email, origin);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ url: result.url });
  }

  // ── Seeded test accounts ─────────────────────────────────────────────────
  const email = body.email;
  if (!email) {
    return NextResponse.json({ error: 'email or athleteId required' }, { status: 400 });
  }
  const profile = TEST_USERS[email];
  if (!profile) {
    return NextResponse.json({ error: 'Not a test account' }, { status: 400 });
  }

  // Coach row is required by athletes.coach_id FK (same ids as 049_run_chat.sql).
  await admin.from('coaches').upsert(
    { id: profile.coachId, email: 'test-coach@madregot.local', name: 'Test Coach' },
    { onConflict: 'id' },
  );

  // Force-approve whatever row owns this email (seed left approved=DEFAULT false).
  const { data: existing } = await admin
    .from('athletes')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    await admin
      .from('athletes')
      .update({
        approved: true,
        status: 'active',
        approved_at: new Date().toISOString(),
        role: profile.role,
        name: profile.name,
      })
      .eq('id', existing.id);
  } else {
    await admin.from('athletes').insert({
      id: profile.id,
      name: profile.name,
      email,
      role: profile.role,
      status: 'active',
      coach_id: profile.coachId,
      approved: true,
      approved_at: new Date().toISOString(),
    });
  }

  const result = await magicLink(admin, email, origin);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ url: result.url });
}
