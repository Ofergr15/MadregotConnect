// Where an academy notification lands when it is tapped.
//
// One builder for every sender (the thread's messages, the mentor's weekly review,
// the test reminders) and for the inbox, which rewrites the rows already sent, so
// the screen that reads these parameters and the code that writes them cannot
// drift. The scheme — read by dashboard/academy/page.tsx:
//
//   ?thread=mine                      the trainee's own conversation, opened in its sheet
//   ?tab=threads&thread=<traineeId>   staff: the threads tab with that trainee's open
//   ?test=mine                        the trainee's test / invitation card, raised
//   ?tab=tests                        staff: the tests tab
//
// Every one of these used to be the bare `/dashboard/academy`, so a push saying
// "Dana answered you" opened a screen with the answer three scrolls away.

export const ACADEMY_PATH = '/dashboard/academy';

/** The conversation a thread notification is about, from the RECIPIENT's side. */
export function academyThreadUrl(opts: { recipientIsStaff: boolean; traineeId: string | null | undefined }): string {
  if (!opts.recipientIsStaff) return `${ACADEMY_PATH}?thread=mine`;
  return opts.traineeId
    ? `${ACADEMY_PATH}?tab=threads&thread=${encodeURIComponent(opts.traineeId)}`
    : `${ACADEMY_PATH}?tab=threads`;
}

/** A test reminder / invitation, from the recipient's side. */
export function academyTestUrl(opts: { recipientIsStaff: boolean }): string {
  return opts.recipientIsStaff ? `${ACADEMY_PATH}?tab=tests` : `${ACADEMY_PATH}?test=mine`;
}

const THREAD_KINDS = new Set(['academy_message', 'academy_feedback']);
const TEST_KINDS = new Set(['academy_test_before', 'academy_test_after']);

/**
 * A notification already stored with the old bare url, rewritten on read.
 *
 * Only an EXACT `/dashboard/academy` is touched: anything more specific was
 * written on purpose and is left alone. For a thread row seen by staff the actor
 * is the best guess at whose thread it was — on a message the trainee wrote, it
 * is the trainee; when the actor is unknown the threads tab still beats the home.
 */
export function upgradeLegacyAcademyUrl(
  kind: string,
  url: string,
  ctx: { viewerIsStaff: boolean; actorAthleteId?: string | null },
): string {
  if (url !== ACADEMY_PATH) return url;
  if (THREAD_KINDS.has(kind)) {
    return academyThreadUrl({ recipientIsStaff: ctx.viewerIsStaff, traineeId: ctx.actorAthleteId ?? null });
  }
  if (TEST_KINDS.has(kind)) return academyTestUrl({ recipientIsStaff: ctx.viewerIsStaff });
  return url;
}

/** What the academy page should do with its query string. Pure, so the page's reading is tested. */
export interface AcademyDeepLink {
  tab: string | null;
  /** `mine` for the trainee's own thread, a trainee id for staff, null for none. */
  thread: string | null;
  /** The trainee asked to see their test card. */
  test: boolean;
}

export function readAcademyDeepLink(params: { get(name: string): string | null }): AcademyDeepLink {
  const thread = (params.get('thread') || '').trim();
  return {
    tab: params.get('tab'),
    thread: thread ? thread : null,
    test: params.get('test') === 'mine',
  };
}
