/**
 * The native app reaches Supabase only through our own domain, so moving the Supabase
 * project (Tokyo → EU) is a server-side env change, never an app build at cutover.
 * Everything here reads the project from the server's env at call time — no host is
 * hardcoded.
 */

/** The configured project's base URL, no trailing slash; null if unset. */
export function supabaseBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

export const PROGRAM_PLANS_BUCKET = 'program-plans';
export const PROGRAM_PLAN_FOLDERS = ['training-program', 'nutrition-plan'] as const;
const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.pdf$/i;

/** `<folder>/<file>.pdf` if both pieces are a valid program-plans object key, else null. */
export function programPlanKey(folder: string, file: string): string | null {
  if (!(PROGRAM_PLAN_FOLDERS as readonly string[]).includes(folder)) return null;
  if (!FILE_RE.test(file) || file.includes('..')) return null;
  return `${folder}/${file}`;
}

const BUCKET_PATH = `/storage/v1/object/public/${PROGRAM_PLANS_BUCKET}/`;

/**
 * The object key a stored program_weeks URL points at, whatever project host it was
 * written under (rows written before a move still name the old host), or null when the
 * value is not a public program-plans object URL.
 */
export function programPlanKeyFromStored(stored: string | null | undefined): string | null {
  if (!stored) return null;
  // Written since the bucket went private (migration 252): the /api/files link.
  const route = /^\/api\/files\/program-plans\/([^/?#]+)\/([^/?#]+)$/.exec(stored);
  if (route) return programPlanKey(route[1], route[2]);
  let u: URL;
  try {
    u = new URL(stored);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  if (!u.pathname.startsWith(BUCKET_PATH)) return null;
  const rest = u.pathname.slice(BUCKET_PATH.length).split('/');
  if (rest.length !== 2) return null;
  return programPlanKey(rest[0], rest[1]);
}

/**
 * The URL the native app should open for a stored PDF value: our own redirect for a
 * bucket object, the legacy site-relative `/plans/...` value unchanged, null otherwise.
 */
export function nativePdfUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const key = programPlanKeyFromStored(stored);
  if (key) return `/api/native/storage/${PROGRAM_PLANS_BUCKET}/${key}`;
  if (/^\/plans\/(training-program|nutrition-plan)\/[A-Za-z0-9._-]+\.pdf$/i.test(stored) && !stored.includes('..')) {
    return stored;
  }
  return null;
}
