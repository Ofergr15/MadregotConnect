import { NextResponse } from 'next/server';

/**
 * Retired. This route used to be an unauthenticated identity oracle: it took
 * `{ email }` with no password, no token and no verification of any kind, and
 * answered with `{ id, name, email, group_id, status }` for any active member.
 * That is a membership-enumeration endpoint — probe an address, learn whether
 * that person is in the club and get their internal ids — and it was live in
 * production (verified: a POST to www.madregot.app answered 404 for a
 * non-member and 400 "Email is required" for an empty body).
 *
 * The ids are the part that matters. Eleven routes still take an athlete id
 * from the query string, so handing out `id` and `group_id` to an anonymous
 * caller is the first half of an IDOR. `docs/feed-plan.md` recorded it as a
 * "known unrelated hole, not fixed here".
 *
 * Nothing calls it — the athlete portal has signed in through Supabase Auth
 * since c73b675, and a repo-wide search for "athlete-login" finds only that
 * doc note. It answers 410 rather than being deleted so a stale PWA cache or
 * an old bookmark gets a definite "this is gone" instead of a Next.js 404 that
 * looks like a deploy glitch; the file is safe to delete outright later.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been removed. Sign in with your email and password.' },
    { status: 410 },
  );
}
