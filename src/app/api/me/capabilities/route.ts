import { NextResponse } from 'next/server';
import { authError, mayViewAs, requireSession } from '@/lib/auth-session';
import { hasRole } from '@/lib/auth/roles';
import { createServerClient } from '@/lib/supabase/server';
import { levelsFor, readGrants } from '@/lib/access/grants';
import { accessFor } from '@/lib/club-updates/model';
import { readConfig } from '@/lib/club-updates/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/capabilities: what the signed-in caller may do in the manager screens, so a client can
 * hide what the server would refuse. Read-only: two app_settings reads, no write, no push, no mail
 * (unlike /api/auth/me). Each flag mirrors the gate of the route it stands for, nothing broader:
 *   events.manage      POST/PATCH/DELETE /api/events     isStaff || isSuperUser
 *   messages           /api/admin/publish/message        canApprove or grant 3 → 'publish'; grant 2 → 'draft'
 *   clubUpdates        lib/club-updates/access            accessFor(config, athleteId, admin)
 *   people.read        GET /api/admin/people, /users      isStaff || isSuperUser
 *   people.admin       admin/roles, admin/people/delete   isSuperUser || role admin
 *   approve            /api/admin/approve                 canApprove
 *   viewAs             /api/admin/view-as                 mayViewAs (the REAL session only)
 * While an admin views as someone, the answer is that person's, with every write false: writes are
 * refused in view-as anyway (view_as_read_only).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    const u = auth.user;
    const viewing = !!u.viewingAsBy;
    const staff = u.isStaff || u.isSuperUser;
    const admin = u.isSuperUser || hasRole(u, 'admin');

    const db = createServerClient();
    const [grants, cfg] = await Promise.all([readGrants(db), readConfig(db)]);
    // publishGate passes role 'runner' to levelsFor: only the grant counts beside canApprove.
    const level = levelsFor({ role: 'runner' }, u.athleteId ? grants[u.athleteId] : undefined).messages;
    const messages = viewing ? 'none' : u.canApprove || level >= 3 ? 'publish' : level === 2 ? 'draft' : 'none';
    const cu = accessFor(cfg, u.athleteId, admin);

    return NextResponse.json({
      viewingAs: viewing,
      events: { manage: !viewing && staff },
      messages,
      clubUpdates: { read: cu.canRead, write: !viewing && cu.canWrite, admin: !viewing && cu.admin },
      people: { read: staff, admin: !viewing && admin },
      approve: !viewing && !!u.canApprove,
      viewAs: !viewing && mayViewAs(u),
    });
  } catch (error) {
    console.error('[me/capabilities] failed:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
