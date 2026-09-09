import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { readMaintenance } from '@/lib/maintenance';
import { computeSetupState } from '@/lib/onboarding/setup-tasks';
import {
  entryStage,
  isBlockedByMaintenance,
  isRemoved,
  realEmail,
  sortByFlow,
  type EntryQueueMember,
  type PendingSignupRequest,
} from '@/lib/admin/entry-queue';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/entry-queue — "who is waiting to get in, and what's their state"
//
// Staff only, and it has to be: this is every member's approval state, when they
// last opened the app, whether their watch is connected and how far into setup
// they got — a profile of the whole club in one response. The open GET
// /api/athletes must never grow any of it (see CLAUDE.md).
//
// Assembled here rather than on the client because the two things that decide the
// stage live in different places — `athletes.approved` and the maintenance
// allowlist — and the allowlist is not something to ship to a browser that only
// needs the verdict. `blocked` is the verdict.
//
// Tolerant of unapplied migrations, like every other route here: approved/
// approved_at (registrations), last_seen_at (010) and active_shoe_id all fall
// back rather than failing the request.
// ═════════════════════════════════════════════════════════════════════════════

const SETUP_COLUMNS =
  'garmin_auth, strava_auth, data_source, avatar_url, phone, birth_date, gender, shirt_size, shoe_size, group_id';
const BASE_COLUMNS = `id, name, email, status, created_at, ${SETUP_COLUMNS}`;
const FULL_COLUMNS = `${BASE_COLUMNS}, approved, approved_at, last_seen_at, active_shoe_id`;

/** '42703' = Postgres undefined_column; 'PGRST204' = PostgREST's schema cache. */
function isMissingColumn(code?: string) {
  return code === '42703' || code === 'PGRST204';
}

/**
 * Pending signup requests that no athlete row answers for.
 *
 * Tolerant twice over, like everything that touches this table: no `signup_requests`
 * at all ('42P01', migration 083 unapplied) and no `source` column (089) both mean
 * "nothing to add here", never a failed queue. The queue is the screen an admin
 * opens when somebody can't get in; it does not get to be the thing that's down.
 */
async function readOrphanRequests(
  supabase: ReturnType<typeof createServerClient>,
  athleteEmails: Set<string>,
): Promise<PendingSignupRequest[]> {
  const WITH_SOURCE = 'id, email, source, created_at, group_id, athlete_id';
  const first = await supabase.from('signup_requests').select(WITH_SOURCE).eq('status', 'pending');
  const { data, error } = isMissingColumn(first.error?.code)
    ? await supabase
        .from('signup_requests')
        .select('id, email, created_at, group_id, athlete_id')
        .eq('status', 'pending')
    : first;
  if (error || !data) return [];

  return (data as unknown as Array<Record<string, unknown>>)
    .filter((r) => !r.athlete_id && !athleteEmails.has(String(r.email || '').toLowerCase().trim()))
    .map((r) => ({
      id: r.id as string,
      email: (r.email as string) || '',
      source: (r.source as string) ?? null,
      createdAt: (r.created_at as string) || null,
      groupId: (r.group_id as string) || null,
    }));
}

/** One auth account, keyed by lowercased email: "did they ever try to log in". */
interface AuthFacts {
  createdAt: string | null;
  lastSignInAt: string | null;
}

/**
 * The GoTrue users, by email — the evidence behind the flow's "started logging in".
 *
 * There is no other durable record of a login ATTEMPT. `login_handoffs` (082) is
 * swept within ten minutes by design, and `athletes.last_seen_at` only ever proves
 * the app opened. An `auth.users` row proves an identity was minted, which on this
 * app only happens inside the Strava callback or a claim — so its presence with no
 * `last_seen_at` is exactly the iOS in-app-browser failure, and the member who
 * needs help most.
 *
 * Returns null rather than an empty map when the listing fails, so the panel can
 * say "unknown" on those two steps instead of accusing the whole club of never
 * having tried. Paged to the end: 100 at a time, capped so a runaway user table
 * can't turn this screen into a minute-long request.
 */
async function readAuthFacts(
  supabase: ReturnType<typeof createServerClient>,
): Promise<Map<string, AuthFacts> | null> {
  const byEmail = new Map<string, AuthFacts>();
  try {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return null;
      const users = data?.users || [];
      for (const u of users) {
        const key = String(u.email || '').toLowerCase().trim();
        if (!key) continue;
        // Keep the earliest account and the latest sign-in across duplicates: a
        // member who has both a real-email row and a Strava shell is one person,
        // and "when did they first try" is the earlier of the two.
        const prev = byEmail.get(key);
        byEmail.set(key, {
          createdAt:
            prev?.createdAt && u.created_at
              ? (prev.createdAt < u.created_at ? prev.createdAt : u.created_at)
              : prev?.createdAt || u.created_at || null,
          lastSignInAt:
            prev?.lastSignInAt && u.last_sign_in_at
              ? (prev.lastSignInAt > u.last_sign_in_at ? prev.lastSignInAt : u.last_sign_in_at)
              : prev?.lastSignInAt || u.last_sign_in_at || null,
        });
      }
      if (users.length < 100) break;
    }
    return byEmail;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const state = await readMaintenance();

    let { data: rows, error } = await supabase.from('athletes').select(FULL_COLUMNS);
    if (isMissingColumn(error?.code)) {
      ({ data: rows, error } = await supabase.from('athletes').select(BASE_COLUMNS));
    }
    if (error) throw error;

    const athletes = (rows || []) as Array<Record<string, unknown>>;

    // Group names and push counts in one round trip each, not one per member.
    const { data: groups } = await supabase.from('groups').select('id, name');
    const groupName = new Map((groups || []).map((g: { id: string; name: string }) => [g.id, g.name]));

    const { data: subs } = await supabase.from('push_subscriptions').select('athlete_id');
    const pushed = new Set((subs || []).map((s: { athlete_id: string }) => s.athlete_id));

    // The login evidence. Null = we couldn't look; see readAuthFacts.
    const authFacts = await readAuthFacts(supabase);

    const members: EntryQueueMember[] = athletes.map((a) => {
      const id = a.id as string;
      const email = (a.email as string) || null;
      const group = a.group_id ? groupName.get(a.group_id as string) || null : null;
      const setup = computeSetupState({
        hasGarminAuth: !!a.garmin_auth,
        hasStravaAuth: !!a.strava_auth,
        dataSource: (a.data_source as string) || null,
        avatarUrl: (a.avatar_url as string) || null,
        phone: (a.phone as string) || null,
        birthDate: (a.birth_date as string) || null,
        gender: (a.gender as string) || null,
        shirtSize: (a.shirt_size as string) || null,
        shoeSize: (a.shoe_size as string) || null,
        pushSubscriptions: pushed.has(id) ? 1 : 0,
        groupName: group,
        hasActiveShoe: !!a.active_shoe_id,
      });
      // `approved` defaults TRUE when the column isn't there: the club predates the
      // approval gate, and reading a missing column as "nobody is approved" would
      // paint all 28 members as pending.
      const approved = a.approved === undefined ? true : a.approved !== false;
      const blocked = isBlockedByMaintenance({ id, email }, state);
      const lastSeenAt = (a.last_seen_at as string) || null;
      const hasWatch = !!a.garmin_auth || !!a.strava_auth;
      const hasPush = pushed.has(id);
      // The auth row is matched on the RAW address, synthetic included: the Strava
      // shell's `strava_<id>@strava.madregot.local` is the email its GoTrue user
      // carries, so stripping it first would lose the login of every Strava member.
      const auth = authFacts?.get(String(a.email || '').toLowerCase().trim()) || null;
      return {
        id,
        name: (a.name as string) || realEmail(email) || '—',
        // Stripped, not shown: the synthetic address is not one anybody can be
        // reached at, and printing it invites an admin to type it somewhere.
        email: realEmail(email),
        groupName: group,
        approved,
        approvedAt: (a.approved_at as string) || null,
        lastSeenAt,
        createdAt: (a.created_at as string) || null,
        blocked,
        hasGarmin: !!a.garmin_auth,
        hasStrava: !!a.strava_auth,
        hasPush,
        setupDone: setup.doneCount,
        setupTotal: setup.totalCount,
        stage: entryStage({ approved, blocked, lastSeenAt, hasWatch, hasPush }),
        authAccountAt: auth?.createdAt || null,
        lastSignInAt: auth?.lastSignInAt || null,
        loginKnown: authFacts !== null,
        // Named, not just counted: "3 מתוך 5" sends the coach to the profile to
        // find out which 3, and the answer was already in this response.
        setupMissing: setup.tasks.filter((t) => !t.done).map((t) => t.key),
        // Sent, not filtered out: the panel keeps them out of the flow but needs the
        // rows to offer "put them back", which is the whole reason the removal is
        // soft. A removal nobody can find again is a delete with extra steps.
        removed: isRemoved(a as { status?: string | null }),
      };
    });

    // ── the applicants who have no athlete row yet ───────────────────────────
    // Two things make a pending signup_request invisible above: no athlete_id, and
    // no athlete carrying the same address. Those are the /register applicants, and
    // they are the only rows the retired בקשות הרשמה tab held on its own. Backfilled
    // rows (source='club-backfill', 23 of the 24 pending in production) always have
    // an athlete_id, so they are already members up there and are NOT repeated here.
    const orphanRequests = await readOrphanRequests(
      supabase,
      new Set(
        athletes
          .map((a) => String(a.email || '').toLowerCase().trim())
          .filter(Boolean),
      ),
    );

    return NextResponse.json({
      maintenance: state.on,
      // For the group picker on an orphan's card: approving one writes a דבוקה, and
      // the names have to come from somewhere the browser is allowed to read.
      groups: (groups || []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })),
      orphanRequests,
      // The panel's actions all need approver rights. `canApprove` off the verified
      // session, never an email literal — login is Strava-only, so a check against
      // APPROVER_EMAILS can never match anybody.
      canApprove: caller.canApprove,
      // Ending a membership is admin-only, unlike every other action here — see the
      // header of the remove route. The client hides the button on this; the route
      // enforces it, because a hidden button is not a permission.
      canRemove: caller.isSuperUser || caller.role === 'admin',
      // Furthest-behind first: the flow's own order, so the top of the list is
      // the club's oldest failure rather than its newest signup.
      members: sortByFlow(members),
    });
  } catch (err) {
    console.error('Failed to build the entry queue:', err);
    return NextResponse.json({ error: 'Failed to build the entry queue' }, { status: 500 });
  }
}
