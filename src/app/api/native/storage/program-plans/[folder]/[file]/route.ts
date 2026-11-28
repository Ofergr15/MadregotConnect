import { NextResponse } from 'next/server';
import { programPlanKey } from '@/lib/native/supabase-proxy';
import { serveFile } from '@/lib/storage/file-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/native/storage/program-plans/{folder}/{file}.pdf — the native app's way to a
 * program PDF, now that the bucket is private (migration 300): the same gate as
 * /api/files (serveFile → resolveVerifiedCaller: a verified member by bearer token, or
 * the files cookie) and a 302 to a
 * ten-minute signed URL. Only the two PDF folders.
 */
export async function GET(request: Request, ctx: { params: Promise<{ folder: string; file: string }> }) {
  const { folder, file } = await ctx.params;
  if (!programPlanKey(folder, file)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return serveFile(request, 'program-plans', [folder, file]);
}
