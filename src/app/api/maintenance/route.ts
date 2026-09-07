import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { clearMaintenanceCache, maintenanceBlocks, readMaintenance } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

/** Uncached — the writer below must see what it just wrote. */
async function getSettings() {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_allow']);
  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const on = map['maintenance_mode'] === 'on';
  const allow = (map['maintenance_allow'] || '')
    .split(',').map((e: string) => e.toLowerCase().trim()).filter(Boolean);
  return { on, allow };
}

// GET /api/maintenance  → { maintenance, allowed, allowlist? }
//
// `allowed` is about the VERIFIED session, never about a `?email=` the caller
// supplies. That parameter was the whole bypass: the addresses on the allowlist
// are approver addresses, which ship in the client bundle, so anybody could ask
// the endpoint whether an admin is allowed in and act on the yes. It is now
// ignored — and the screen no longer has an address to send, because it reads the
// answer for whoever holds the token.
//
// No session means blocked, not allowed: the allowlist cannot recognise somebody
// it knows nothing about. (The gate never covers the public paths, so a visitor
// who has not signed in yet is not affected — see PUBLIC_PATHS.)
//
// `allowlist` goes only to an approver. It is the list of who can still get in
// during a window, which is nobody else's business.
//
// `identified` and `superUser` are here so the screen stops working them out for
// itself — it used to read localStorage and run isSuperUser() in the browser, both
// of which the viewer can write.
export async function GET(request: Request) {
  try {
    const state = await readMaintenance();
    const auth = await requireSession(request);
    if (!auth.ok) {
      return NextResponse.json({
        maintenance: state.on,
        allowed: !state.on,
        identified: false,
        superUser: false,
      });
    }
    return NextResponse.json({
      maintenance: state.on,
      allowed: !maintenanceBlocks(auth.user.email, state),
      identified: true,
      superUser: auth.user.isSuperUser,
      ...(auth.user.canApprove ? { allowlist: state.allow } : {}),
    });
  } catch {
    // Fails open, the same way readMaintenance does and for the same reason: a
    // read that did not answer is not evidence that the club is closed.
    return NextResponse.json({ maintenance: false, allowed: true, identified: false, superUser: false });
  }
}

// PUT /api/maintenance  — toggle and/or update the allowlist (approver only)
//   Bearer <supabase jwt> + { on?: boolean, allowlist?: string[] }
//
// The actor is the VERIFIED session email, never a value from the body. It used
// to be `body.actorEmail`, which meant anyone could lock the whole club out of
// the app by posting an approver's address — and APPROVER_EMAILS ships in the
// client bundle, so those addresses are public.
export async function PUT(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    const actorEmail = auth.user.email;
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const { on, allowlist } = await request.json();
    const supabase = createServerClient();
    const now = new Date().toISOString();
    const rows: Array<{ key: string; value: string; updated_at: string }> = [];

    // Resolve the allowlist we'll end up with (explicit update wins, else current).
    let nextAllow: string[] | null = null;
    if (Array.isArray(allowlist)) {
      nextAllow = [...new Set(allowlist.map((e: string) => String(e).toLowerCase().trim()).filter(Boolean))];
    }

    if (typeof on === 'boolean') {
      rows.push({ key: 'maintenance_mode', value: on ? 'on' : 'off', updated_at: now });
      // SAFEGUARD: turning maintenance ON auto-adds the actor to the allowlist so
      // the admin who flips it can never lock themselves out.
      if (on) {
        const actor = String(actorEmail).toLowerCase().trim();
        const base = nextAllow ?? (await getSettings()).allow;
        if (actor && !base.includes(actor)) nextAllow = [...base, actor];
      }
    }
    if (nextAllow) rows.push({ key: 'maintenance_allow', value: nextAllow.join(','), updated_at: now });

    if (rows.length > 0) {
      const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
    // The API gate caches its answer for a few seconds. Drop it here so the
    // window starts (or ends) on the tap rather than up to a TTL later — this
    // instance at least; others expire on their own.
    clearMaintenanceCache();
    const { on: nowOn, allow } = await getSettings();
    return NextResponse.json({ maintenance: nowOn, allowlist: allow });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
