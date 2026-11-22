import { NextResponse } from 'next/server';
import { programPlanKey, publicProgramPlanUrl } from '@/lib/native/supabase-proxy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/native/storage/program-plans/{folder}/{file}.pdf → 302 to the CURRENT
 * project's public object URL. The program-plans bucket is public today (GET
 * /api/program-weeks already hands its URLs out unauthenticated), so this adds no
 * access: same objects, same rule, only the host is resolved server-side. If the bucket
 * ever goes private, this route must switch to a resolveVerifiedCaller-gated signed URL.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ folder: string; file: string }> }) {
  const { folder, file } = await ctx.params;
  const key = programPlanKey(folder, file);
  if (!key) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const url = publicProgramPlanUrl(key);
  if (!url) return NextResponse.json({ error: 'not-configured' }, { status: 503 });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
