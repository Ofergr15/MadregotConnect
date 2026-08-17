/**
 * GET /api/photos/selfie-url?athleteId=<uuid>
 *
 * Returns a short-lived signed URL for an athlete's reference selfie in the
 * private reference-faces bucket. Athletes can only fetch their own; staff can
 * fetch any.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rawId = new URL(req.url).searchParams.get('athleteId');
    const resolvedId = isStaff(user.role) ? (rawId ?? user.athleteId) : user.athleteId;

    const supabase = createServerClient();

    // Find the athlete's most recent selfie path
    // Selfies are stored at athletes/{athleteId}/selfie.{ext}
    const { data: list } = await supabase.storage
      .from('reference-faces')
      .list(`athletes/${resolvedId}`, { limit: 5 });

    const selfie = (list ?? []).find(f => f.name.startsWith('selfie.'));
    if (!selfie) return NextResponse.json({ url: null });

    const path = `athletes/${resolvedId}/${selfie.name}`;
    const { data: signed } = await supabase.storage
      .from('reference-faces')
      .createSignedUrl(path, 3600); // 1-hour TTL

    return NextResponse.json({ url: signed?.signedUrl ?? null });
  } catch (error: unknown) {
    console.error('GET /api/photos/selfie-url error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
