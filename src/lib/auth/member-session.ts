import { createClient } from '@supabase/supabase-js';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

export interface SignInMember {
  id: string;
  email: string;
  name: string | null;
  group_id?: string | null;
  status?: string | null;
  role?: string | null;
  is_academy?: boolean | null;
}

/**
 * Mint the session for an APPROVED member — the one shape both ways in share:
 * the 6-digit email code and the pending applicant's one-time grant on approval
 * (/api/public/signup/status). Approved-but-'invited' flips to 'active': signing
 * in IS joining, the same flip /api/athletes/connect makes.
 */
export async function mintMemberSession(supabase: Db, member: SignInMember) {
  if (member.status === 'invited') await supabase.from('athletes').update({ status: 'active' }).eq('id', member.id);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const auth = await createSyntheticSession(admin, member.email, { athlete_id: member.id, name: member.name });
  if (auth.error || !auth.session) return { ok: false as const, error: auth.error || 'no-session' };
  return {
    ok: true as const,
    body: {
      ok: true,
      email: member.email,
      name: member.name,
      athleteId: member.id,
      groupId: member.group_id ?? null,
      role: member.role ?? null,
      isAcademy: !!member.is_academy,
      session: auth.session,
    },
  };
}
