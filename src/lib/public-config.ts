/**
 * Public Supabase coordinates for GET /api/config. Reads NEXT_PUBLIC_* only and never the
 * service-role env var; refuses any key whose JWT role is not `anon` (or an `sb_secret_` key).
 */
export type PublicConfig = { supabaseUrl: string; supabaseAnonKey: string; minAppVersion?: string };

function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json?.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

export function isPublicKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return false;
  if (key.startsWith('sb_publishable_')) return true;
  return jwtRole(key) === 'anon';
}

export function buildPublicConfig(env: Record<string, string | undefined>): PublicConfig | null {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !isPublicKey(supabaseAnonKey)) return null;
  const minAppVersion = env.NATIVE_MIN_APP_VERSION?.trim();
  return { supabaseUrl, supabaseAnonKey, ...(minAppVersion ? { minAppVersion } : {}) };
}

