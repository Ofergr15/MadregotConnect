import { NextResponse } from 'next/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { loadAcademyPeople } from '@/lib/academy/manage-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/members/people — the manager's three lists beside the roster:
 * who left the academy (and who coached them), who applied and is waiting, and
 * which approved club members could be added. Academy manager only: it carries
 * applicants who are not anybody's trainee yet.
 */
export async function GET(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    return NextResponse.json(await loadAcademyPeople());
  } catch (error) {
    console.error('Academy people GET error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
