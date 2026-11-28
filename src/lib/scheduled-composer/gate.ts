import { NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

/**
 * Reading the scheduled list: staff. Writing it: whoever may broadcast to the club today —
 * an approver, an admin or the super user (the same people as POST /api/admin/surveys) —
 * and never while viewing as somebody.
 */
export async function composerGate(request: Request, write: boolean) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return { denied, caller };
  if (!write) return { denied: null, caller };
  if (caller.viewingAsBy) return { denied: NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 }), caller };
  const mayPublish = caller.isSuperUser || caller.canApprove || caller.role === 'admin' || !!caller.roles?.includes('admin');
  if (!mayPublish) return { denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }), caller };
  return { denied: null, caller };
}
