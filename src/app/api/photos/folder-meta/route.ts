import { NextResponse } from 'next/server';
import { requireContentStaff } from '@/lib/auth/require-content-staff';
import { setFolderMeta } from '@/lib/photos/folder-meta';
import type { FolderKind } from '@/lib/photos/folder-kind';

export const dynamic = 'force-dynamic';

// PATCH { id, kind?, tags?, title?, pinned?, cover? } -> { ok }  Staff only. (No DELETE: the app never removes photos.)
export async function PATCH(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof b?.id === 'string' ? b.id : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await setFolderMeta(id, {
      ...(typeof b?.kind === 'string' ? { kind: b.kind as FolderKind } : {}),
      ...(Array.isArray(b?.tags) ? { tags: (b!.tags as unknown[]).filter((t): t is string => typeof t === 'string') } : {}),
      ...(typeof b?.title === 'string' ? { title: b.title } : {}),
      ...(typeof b?.pinned === 'boolean' ? { pinned: b.pinned } : {}),
      ...(b && 'cover' in b ? { cover: typeof b.cover === 'string' ? b.cover : null } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[photos/folder-meta] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
