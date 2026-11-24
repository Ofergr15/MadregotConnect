import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { getStreamServerClient } from '@/lib/stream/server';
import { storagePathFromUrl } from '@/lib/account/storage-path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Carry out a member's account deletion request. ADMIN ONLY, and only for a member
 * with a pending `account_deletion_requests` row (migration 193): nothing deletes an
 * account automatically, and no body field can delete one that never asked.
 *
 * GET               → { requests: [{ athleteId, name, createdAt, reason }] }   pending only
 * POST { athleteId } → { ok: true, steps: { database, storage, chat, login } }
 *   400 bad id · 403 not admin · 409 no pending request · 503 193/204 not applied
 *
 * `anonymise_athlete` (migration 204) does everything inside Postgres. What it cannot
 * reach is done here, best-effort and reported per step, because each lives elsewhere:
 * avatar + feed-media + face-crop storage objects, the Stream run-chat user and their
 * messages, and the Supabase auth login. A failed outside step never undoes the DB step.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = ReturnType<typeof createServerClient>;
type Step = 'ok' | 'skipped' | `failed: ${string}`;

async function requireAdmin(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

const unmigrated = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /account_deletion_requests|anonymise_athlete/.test(e.message || ''));

const failed = (e: unknown): Step => `failed: ${((e as Error)?.message || String(e)).slice(0, 200)}`;

async function removeStorage(db: Db, athleteId: string, avatarUrl: string | null, cropUrls: string[]): Promise<Step> {
  try {
    const errors: string[] = [];
    // avatars/<athleteId>.<ext> (api/athletes/avatar) — list rather than guess the ext.
    const avatarPaths = new Set<string>();
    const fromUrl = storagePathFromUrl(avatarUrl, 'avatars');
    if (fromUrl) avatarPaths.add(fromUrl);
    const listed = await db.storage.from('avatars').list('', { search: athleteId });
    for (const f of listed.data || []) if (f.name.startsWith(athleteId)) avatarPaths.add(f.name);
    if (avatarPaths.size) {
      const { error } = await db.storage.from('avatars').remove([...avatarPaths]);
      if (error) errors.push(`avatars: ${error.message}`);
    }
    // feed-media/<athleteId>/<uuid>.<ext> (api/feed/media) — their post photos.
    const media = await db.storage.from('feed-media').list(athleteId, { limit: 1000 });
    const mediaPaths = (media.data || []).map((f) => `${athleteId}/${f.name}`);
    if (mediaPaths.length) {
      const { error } = await db.storage.from('feed-media').remove(mediaPaths);
      if (error) errors.push(`feed-media: ${error.message}`);
    }
    // face-crops/<photoId>/<uuid>.jpg — the crops recognised as this person.
    const cropPaths = cropUrls.map((u) => storagePathFromUrl(u, 'face-crops')).filter((p): p is string => !!p);
    if (cropPaths.length) {
      const { error } = await db.storage.from('face-crops').remove(cropPaths);
      if (error) errors.push(`face-crops: ${error.message}`);
    }
    return errors.length ? `failed: ${errors.join('; ')}` : 'ok';
  } catch (e) {
    return failed(e);
  }
}

async function removeChat(athleteId: string): Promise<Step> {
  if (!process.env.STREAM_API_KEY || !process.env.STREAM_API_SECRET) return 'skipped';
  try {
    // Stream user id = athlete id (api/run-chat/token). Hard delete removes the user
    // and their messages from every channel.
    await getStreamServerClient().deleteUser(athleteId, { mark_messages_deleted: true, hard_delete: true });
    return 'ok';
  } catch (e) {
    // A member who never opened run chat has no Stream user — nothing to delete.
    if (/not found|does not exist|doesn't exist/i.test((e as Error)?.message || '')) return 'skipped';
    return failed(e);
  }
}

async function removeLogin(db: Db, email: string | null): Promise<Step> {
  if (!email) return 'skipped';
  try {
    const wanted = email.toLowerCase();
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return failed(error);
      const users = data?.users || [];
      const hit = users.find((u) => (u.email || '').toLowerCase() === wanted);
      if (hit) {
        const del = await db.auth.admin.deleteUser(hit.id);
        return del.error ? failed(del.error) : 'ok';
      }
      if (users.length < 200) break;
    }
    return 'skipped';
  } catch (e) {
    return failed(e);
  }
}

export async function GET(request: Request) {
  const { denied } = await requireAdmin(request);
  if (denied) return denied;
  const db = createServerClient();
  const { data, error } = await db
    .from('account_deletion_requests')
    .select('athlete_id, reason, created_at, athletes!athlete_id(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (unmigrated(error)) return NextResponse.json({ error: 'not migrated (193)', migrated: false }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    requests: ((data || []) as unknown as { athlete_id: string; reason: string | null; created_at: string; athletes?: { name?: string } | null }[]).map((r) => ({
      athleteId: r.athlete_id,
      name: r.athletes?.name ?? null,
      createdAt: r.created_at,
      reason: r.reason,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAdmin(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const athleteId = body?.athleteId;
    if (typeof athleteId !== 'string' || !UUID_RE.test(athleteId)) {
      return NextResponse.json({ error: 'invalid athleteId' }, { status: 400 });
    }
    const db = createServerClient();

    const pending = await db
      .from('account_deletion_requests')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('status', 'pending')
      .maybeSingle();
    if (unmigrated(pending.error)) return NextResponse.json({ error: 'not migrated (193)', migrated: false }, { status: 503 });
    if (pending.error) return NextResponse.json({ error: pending.error.message }, { status: 500 });
    if (!pending.data) return NextResponse.json({ error: 'no pending deletion request for this member' }, { status: 409 });

    // Read what the outside steps need BEFORE the function blanks it.
    const { data: who } = await db.from('athletes').select('email, avatar_url').eq('id', athleteId).maybeSingle();
    const row = (who as { email?: string | null; avatar_url?: string | null } | null) ?? {};
    const crops = await db.from('detected_faces').select('crop_url').eq('athlete_id', athleteId);
    const cropUrls = ((crops.data as { crop_url?: string | null }[] | null) || []).map((c) => c.crop_url || '').filter(Boolean);

    const { error: rpcError } = await db.rpc('anonymise_athlete', { target: athleteId, admin_id: caller.athleteId });
    if (unmigrated(rpcError)) return NextResponse.json({ error: 'anonymise_athlete missing (193/204)', migrated: false }, { status: 503 });
    if (rpcError) return NextResponse.json({ error: 'anonymise failed', details: rpcError.message }, { status: 500 });

    const [storage, chat, login] = await Promise.all([
      removeStorage(db, athleteId, row.avatar_url ?? null, cropUrls),
      removeChat(athleteId),
      removeLogin(db, row.email ?? null),
    ]);
    return NextResponse.json({ ok: true, steps: { database: 'ok' as Step, storage, chat, login } });
  } catch (err: unknown) {
    console.error('[admin/account-deletion] failed:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
