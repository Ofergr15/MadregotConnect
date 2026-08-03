/**
 * Server-side JWT verification for photo routes.
 *
 * These are the only routes in the app that do real server-side auth. Everything
 * else uses service-role and trusts caller-supplied identity. Photo routes need
 * real auth because "athletes see only their own photos" must hold against direct
 * curl calls, not just the UI.
 *
 * Pattern: read Authorization: Bearer <token>, validate it via supabase.auth.getUser()
 * (which verifies the JWT signature server-side), then resolve athletes.role + id
 * by email using the service-role client.
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export interface VerifiedUser {
  email: string;
  athleteId: string;
  role: string;
}

const STAFF_ROLES = ['admin', 'coach', 'academy_coach'] as const;

export function isStaff(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Verifies the Authorization: Bearer token in the request and returns the
 * resolved user, or null if authentication fails.
 */
export async function verifyRequest(req: NextRequest): Promise<VerifiedUser | null> {
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7);

    // Validate the JWT against the Supabase anon client — this is what actually
    // checks the signature. The anon client (not service-role) is required here.
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: { user }, error } = await anonClient.auth.getUser(token);
    if (error || !user?.email) return null;

    const email = user.email.toLowerCase();

    // Resolve the athlete record to get our app-level id + role
    const supabase = createServerClient();
    const { data: athlete, error: athleteErr } = await supabase
      .from('athletes')
      .select('id, role')
      .ilike('email', email)
      .maybeSingle();

    if (athleteErr || !athlete) return null;

    return { email, athleteId: athlete.id, role: athlete.role };
  } catch {
    return null;
  }
}
