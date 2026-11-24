import { NextResponse } from 'next/server';

/**
 * "How teammates see me" — `?as=member` on the member-profile read routes.
 *
 * The owner (or staff) asks a route for the response a plain, non-staff teammate
 * would get for this athlete. The answer is computed by running the route's normal
 * code with a different VIEWER, not by a second masking path: the viewer returned
 * here is a member with no athlete id, no staff flag and no super-user flag, so
 * every existing self-or-staff decision (`mayActFor`, `seesPending`,
 * `hiddenFromCaller`, `hiddenTestAccountsFor`, the feed's plan verdicts and route
 * trim) falls on the teammate side by itself.
 *
 * Load-bearing rules (pinned by src/__tests__/memberPreview*.test.ts):
 * - It can only REDUCE. The preview viewer has strictly fewer rights than any
 *   verified caller, so no route can see more under it than without it.
 * - It is only honoured for a verified caller previewing THEMSELVES, or for staff.
 *   Anything else that sends `as` — another runner's id, a missing target, an
 *   unknown value — is a 400, never silently the caller's own full view.
 * - Identity is never taken from the params: the caller is whatever the route's
 *   session gate already resolved.
 */
export interface PreviewCaller {
  /** Empty for an unverified caller (resolveVerifiedCaller's denied shape). */
  email?: string;
  athleteId: string | null;
  isStaff: boolean;
  isSuperUser?: boolean;
}

export interface PreviewViewer {
  athleteId: string | null;
  isStaff: boolean;
  isSuperUser: boolean;
  /** True when this viewer is the `?as=member` stand-in, not the caller. */
  preview: boolean;
}

export type PreviewResult =
  | { error: Response; viewer: null }
  | { error: null; viewer: PreviewViewer };

/** The stand-in: a plain member who is not the owner and not staff. */
export const MEMBER_PREVIEW_VIEWER: Readonly<PreviewViewer> = Object.freeze({
  athleteId: null,
  isStaff: false,
  isSuperUser: false,
  preview: true,
});

const bad = (message: string): PreviewResult => ({
  error: NextResponse.json({ error: message }, { status: 400 }),
  viewer: null,
});

export function viewerForPreview(
  caller: PreviewCaller,
  targetId: string | null | undefined,
  params: URLSearchParams,
): PreviewResult {
  const as = params.get('as');
  if (as === null) {
    return {
      error: null,
      viewer: {
        athleteId: caller.athleteId,
        isStaff: caller.isStaff,
        isSuperUser: !!caller.isSuperUser,
        preview: false,
      },
    };
  }
  if (as !== 'member') return bad('Unsupported as= value');
  if (caller.email === '' || (!caller.athleteId && !caller.isStaff && !caller.isSuperUser)) {
    return bad('as=member requires a verified caller');
  }
  if (!targetId) return bad('as=member requires a target athlete');
  const self = !!caller.athleteId && caller.athleteId === targetId;
  if (!self && !caller.isStaff && !caller.isSuperUser) {
    return bad('as=member is only available for your own profile');
  }
  return { error: null, viewer: { ...MEMBER_PREVIEW_VIEWER } };
}
