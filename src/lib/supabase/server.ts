import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for use in Server Components and API routes.
 *
 * Uses the service role key for admin operations, bypassing RLS policies.
 * Should only be used in trusted server-side code.
 *
 * IMPORTANT: This client has elevated privileges and can bypass Row Level Security.
 * Only use for admin operations where RLS bypass is intentional.
 *
 * @example
 * ```tsx
 * // In a Server Component
 * import { createServerClient } from '@/lib/supabase/server';
 *
 * export default async function Page() {
 *   const supabase = createServerClient();
 *   const { data } = await supabase.from('coaches').select('*');
 *   return <div>{data?.length} coaches</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // In an API Route
 * import { createServerClient } from '@/lib/supabase/server';
 *
 * export async function POST(request: Request) {
 *   const supabase = createServerClient();
 *   const { data, error } = await supabase.from('athletes').insert({ ... });
 *   return Response.json({ data, error });
 * }
 * ```
 */
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

/**
 * Server-side Supabase client that respects user sessions from cookies.
 *
 * Uses the anon key but reads the user's session from cookies.
 * Respects RLS policies based on the authenticated user.
 *
 * Use this when you want to respect RLS and user permissions in Server Components.
 *
 * @example
 * ```tsx
 * import { createServerClientWithAuth } from '@/lib/supabase/server';
 *
 * export default async function CoachDashboard() {
 *   const supabase = await createServerClientWithAuth();
 *   // This query will only return data the authenticated user can access
 *   const { data } = await supabase.from('athletes').select('*');
 *   return <AthleteList athletes={data} />;
 * }
 * ```
 */
export async function createServerClientWithAuth() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        cookie: cookieStore.toString(),
      },
    },
  });
}
