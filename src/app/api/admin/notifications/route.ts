import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isStaffRole } from '@/lib/constants';
import { CATEGORIES, mergeWithDefaults, isKindMuted, type SavedPrefs } from '@/lib/notifications/prefs';
import {
  ROUTABLE_ROLES,
  ROUTED_KINDS,
  ROUTED_KIND_KEYS,
  routingMatrix,
  type RoutableRole,
} from '@/lib/notifications/routing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The notifications control surface — Control Room → התראות.
 *
 * GET → two answers on one screen, in one request:
 *   1. ROUTING: for each management alert, which roles receive it AND the actual
 *      people that resolves to right now, each with how many devices they have.
 *      Roles are abstract; "יאיר גבאי · 0 מכשירים" is the answer to "why didn't he
 *      get it", and no screen in the app could say it before.
 *   2. PEOPLE: every member with their eight category switches as they are
 *      EFFECTIVELY set (merged with the role defaults, so a coach who never
 *      opened Settings shows the quiet social channel they actually have).
 *
 * PUT → { kind, role, enabled } — one cell of the routing grid.
 *
 * ── WHY ADMIN-ONLY, WHERE MOST ADMIN ROUTES ARE STAFF-GATED ──────────────────
 * The read exposes every member's notification preferences and device count, and
 * the write decides who hears that an athlete reported PAIN. The club has two
 * coach accounts, one of which is a `Test Coach` fixture row. Staff-gating the
 * write would let either of them silence a channel for everyone.
 *
 * Per-person preferences are NOT written here: PUT /api/athletes/notification-prefs
 * already does exactly that, self-or-staff, with the merge logic and the
 * migration-038 degradation in one place. The screen calls it directly.
 */

/** Postgres: relation does not exist — migration 099 not pasted in yet. */
const UNDEFINED_TABLE = '42P01';

async function requireAdmin(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && caller.role !== 'admin') {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

interface AthleteRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  notification_prefs?: SavedPrefs | null;
}

export async function GET(request: Request) {
  try {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const [matrix, athletesResult, subsResult] = await Promise.all([
      routingMatrix(),
      supabase.from('athletes').select('id, name, email, role, notification_prefs').order('name'),
      // One row per registered device. Counted rather than listed: the endpoint
      // itself is a credential and must never leave the server.
      supabase.from('push_subscriptions').select('athlete_id'),
    ]);
    if (athletesResult.error) throw athletesResult.error;

    const devices = new Map<string, number>();
    for (const s of (subsResult.data || []) as Array<{ athlete_id: string }>) {
      devices.set(s.athlete_id, (devices.get(s.athlete_id) ?? 0) + 1);
    }

    const athletes = (athletesResult.data || []) as AthleteRow[];
    const byRole = new Map<string, AthleteRow[]>();
    for (const a of athletes) {
      const role = a.role || 'runner';
      const bucket = byRole.get(role);
      if (bucket) bucket.push(a);
      else byRole.set(role, [a]);
    }

    const kinds = ROUTED_KINDS.map((k) => {
      const row = matrix?.[k.kind] ?? {};
      const roles = Object.fromEntries(
        ROUTABLE_ROLES.map((r) => [r, row[r] === true]),
      ) as Record<RoutableRole, boolean>;
      const recipients = ROUTABLE_ROLES.filter((r) => roles[r])
        .flatMap((r) => byRole.get(r) || [])
        .map((a) => ({
          id: a.id,
          name: a.name || a.email || '',
          role: a.role || 'runner',
          devices: devices.get(a.id) ?? 0,
          // On the list, but has turned this channel off for themselves. Routing
          // is the club's decision and prefs are the person's — a screen that
          // showed only the first would keep promising a delivery that the send
          // path (filterByCategory) already drops.
          muted: isKindMuted(k.kind, a.notification_prefs as Record<string, boolean> | null, isStaffRole(a.role)),
        }));
      return { ...k, roles, recipients };
    });

    return NextResponse.json({
      // false → the screen says "paste in migration 099" and disables the grid.
      // The kinds above are still listed and still correct: an unrouted kind goes
      // to the admins, which is what the fallback does.
      migrated: matrix !== null,
      roles: ROUTABLE_ROLES.map((r) => ({ role: r, people: (byRole.get(r) || []).length })),
      kinds,
      categories: CATEGORIES,
      people: athletes.map((a) => {
        // Categories only. `notification_prefs` also carries the athlete's
        // notification `language` (see notifications/locale.ts), and mergeWithDefaults
        // passes it straight through — a screen that iterated the object would render
        // "language: he" as a ninth channel with a switch that writes nonsense.
        const merged = mergeWithDefaults(a.notification_prefs as SavedPrefs | undefined, isStaffRole(a.role));
        return {
          id: a.id,
          name: a.name || a.email || '',
          role: a.role || 'runner',
          devices: devices.get(a.id) ?? 0,
          prefs: Object.fromEntries(CATEGORIES.map((c) => [c, merged[c]])),
        };
      }),
    });
  } catch (error) {
    console.error('Failed to load notification routing:', error);
    return NextResponse.json({ error: 'Failed to load notification routing' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      role?: string;
      enabled?: boolean;
    };
    // Both values are validated against the app's own lists rather than written
    // through: this table decides who receives a private pain report, so an
    // arbitrary `role` in the body must not be able to create a routing row that
    // no screen shows and nobody would find again.
    if (
      !body.kind || !ROUTED_KIND_KEYS.has(body.kind)
      || !body.role || !(ROUTABLE_ROLES as readonly string[]).includes(body.role)
      || typeof body.enabled !== 'boolean'
    ) {
      return NextResponse.json({ error: 'kind, role and enabled are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('notification_routing')
      .upsert(
        { kind: body.kind, role: body.role, enabled: body.enabled, updated_at: new Date().toISOString() },
        { onConflict: 'kind,role' },
      );
    if (error) {
      if (error.code === UNDEFINED_TABLE) {
        return NextResponse.json(
          { error: 'migration-missing', detail: 'supabase/migrations/099_notification_routing.sql' },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, kind: body.kind, role: body.role, enabled: body.enabled });
  } catch (error) {
    console.error('Failed to update notification routing:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
