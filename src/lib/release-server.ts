import type { createServerClient } from '@/lib/supabase/server';
import {
  MAIN_SHA_URL, RELEASE_BRANCH, isSha, notesUrlAt,
  type ApprovalRow, type ReleaseNote,
} from '@/lib/release-notes';

// Server half of the release train (lib/release-notes.ts): what main is right
// now, the notes at a given commit, and the owner's standing approval.

type Db = ReturnType<typeof createServerClient>;

/** main's head commit, or null when GitHub can't be reached. */
export async function mainHead(): Promise<string | null> {
  try {
    const res = await fetch(MAIN_SHA_URL, {
      headers: { Accept: 'application/vnd.github.sha' },
      next: { revalidate: 60 },
    });
    const sha = res.ok ? (await res.text()).trim() : '';
    return isSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** The notes file as it is at `ref`; null when that commit can't be read. */
export async function notesAt(ref: string): Promise<ReleaseNote[] | null> {
  try {
    const res = await fetch(notesUrlAt(ref), { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? (json as ReleaseNote[]) : null;
  } catch {
    return null;
  }
}

export const onProduction = () => process.env.VERCEL_GIT_COMMIT_REF === RELEASE_BRANCH;
export const deployedSha = () => process.env.VERCEL_GIT_COMMIT_SHA ?? null;

let shippedMarkedFor: string | null = null;

/**
 * Once a production deploy is serving, its approval (and any older one it
 * supersedes) is spent, so the 05:00 run never re-ships it and the panel stops
 * showing it as waiting. Once per server instance.
 */
export async function markShipped(db: Db): Promise<void> {
  const sha = deployedSha();
  if (!onProduction() || !sha || shippedMarkedFor === sha) return;
  const { data } = await db.from('release_approvals').select('id').eq('sha', sha).order('id', { ascending: false }).limit(1).maybeSingle();
  if (data) {
    await db.from('release_approvals').update({ shipped_at: new Date().toISOString() })
      .is('shipped_at', null).lte('id', (data as { id: number }).id);
  }
  shippedMarkedFor = sha;
}

/** The approval the next 05:00 run ships, if there is one. */
export async function activeApproval(db: Db): Promise<ApprovalRow | null> {
  const { data, error } = await db.from('release_approvals')
    .select('id, sha, note_ids, approved_at')
    .is('shipped_at', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as ApprovalRow | null) ?? null;
}


