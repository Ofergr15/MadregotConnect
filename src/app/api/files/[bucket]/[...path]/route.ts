import { serveFile } from '@/lib/storage/file-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/files/<bucket>/<...path> — one object of a private bucket (lib/storage/buckets.ts):
 * 404 for a bucket it doesn't serve, 401 without a verified member (bearer token or the
 * `mc_files` cookie POST /api/files/session minted after resolveVerifiedCaller), 403 for staff-only content, else a
 * 302 to a ten-minute signed URL.
 */
export async function GET(request: Request, ctx: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await ctx.params;
  return serveFile(request, bucket, path);
}
