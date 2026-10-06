import { NextResponse } from 'next/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { deleteApplication } from '@/lib/academy/manage-server';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/academy/members/application — { athleteId?, candidateId?, confirm: 'delete' }
 *
 * Deletes somebody's academy application: the funnel card and the account the
 * public form opened for them. Only for a person who is NOT a club member — the
 * gate is `applicationDeletable` plus a count across the data tables, and any
 * doubt is a 409, never a delete. A club member who applied is removed from the
 * academy instead, and stays in the club.
 *
 * `confirm` is the second half of the screen's double confirmation, so a stray
 * request cannot delete anything.
 */
export async function DELETE(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' && body.athleteId.trim() ? body.athleteId.trim() : null;
    const candidateId = typeof body?.candidateId === 'string' && body.candidateId.trim() ? body.candidateId.trim() : null;
    if (!athleteId && !candidateId) {
      return NextResponse.json({ error: 'athleteId or candidateId is required' }, { status: 400 });
    }
    if (body?.confirm !== 'delete') {
      return NextResponse.json({ error: 'Confirm the delete' }, { status: 400 });
    }
    return await deleteApplication({ athleteId, candidateId });
  } catch (error) {
    console.error('Academy application delete error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
