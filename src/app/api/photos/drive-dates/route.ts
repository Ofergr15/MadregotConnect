import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { listRunFolders } from '@/lib/google-drive/client';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [folders, supabase] = [await listRunFolders(), createServerClient()];

    // Per-folder import + processing status
    const { data: photoRows } = await supabase
      .from('run_photos')
      .select('drive_folder_id, processed_at')
      .not('drive_folder_id', 'is', null);

    // Count imported and unprocessed per folder
    const folderStats = new Map<string, { imported: number; unprocessed: number }>();
    for (const row of photoRows ?? []) {
      const fid = row.drive_folder_id as string;
      if (!folderStats.has(fid)) folderStats.set(fid, { imported: 0, unprocessed: 0 });
      const s = folderStats.get(fid)!;
      s.imported++;
      if (!row.processed_at) s.unprocessed++;
    }

    return NextResponse.json({
      folders: folders.map(f => {
        const s = folderStats.get(f.id);
        return {
          ...f,
          imported: !!s,
          importedCount: s?.imported ?? 0,
          unprocessedCount: s?.unprocessed ?? 0,
        };
      }),
    });
  } catch (error: unknown) {
    console.error('GET /api/photos/drive-dates error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
