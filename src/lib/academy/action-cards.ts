// Action cards (P2 item 16): the admin academy home and the coach tools used to show a
// number with a label ("מחכה לך · 65", "מחכים שנאשר 3") and leave the reader to work out
// what to do. Each card now says what to do (a verb title), one plain sentence with the
// count inside it, and one button into the existing screen for that task.
//
// This file decides WHICH cards and in WHAT ORDER; the copy lives in messages/*.json
// under "actionCards" (`<kind>Title`, `<kind>Text`, `<kind>Cta`), with every number
// wrapped in <n>…</n> so the screen can isolate it with <bdi>.

export type ActionKind = 'pain' | 'reply' | 'approve' | 'remind' | 'tests' | 'assign';

export interface ActionCounts {
  /** Runners who reported pain. */
  pain?: number;
  /** Feedback or messages waiting for a reply. */
  reply?: number;
  /** People waiting for an approval. */
  approve?: number;
  /** Approved, and still not inside the app. */
  remind?: number;
  /** Test submissions waiting for approval. */
  tests?: number;
  /** Trainees without a coach. */
  unassigned?: number;
  /** Registrants still on their way in (context on the assign card only). */
  inFunnel?: number;
}

export interface ActionCard {
  kind: ActionKind;
  count: number;
  /** A second number the sentence carries (replies on the pain card, the funnel on assign). */
  extra: number;
  /** The edge colour: red for a person hurting, orange for a waiting decision, brand otherwise. */
  tone: 'red' | 'orange' | 'brand';
}

const n = (x: number | undefined) => (Number.isFinite(x) && (x as number) > 0 ? Math.floor(x as number) : 0);

/**
 * Most urgent first: pain (with the replies folded in), or replies alone; then approvals,
 * then the reminder to the approved who never came in, then tests, then assigning a coach.
 * A count of 0 is no card.
 */
export function buildActionCards(c: ActionCounts): ActionCard[] {
  const out: ActionCard[] = [];
  const pain = n(c.pain), reply = n(c.reply);
  if (pain) out.push({ kind: 'pain', count: pain, extra: reply, tone: 'red' });
  else if (reply) out.push({ kind: 'reply', count: reply, extra: 0, tone: 'red' });
  if (n(c.approve)) out.push({ kind: 'approve', count: n(c.approve), extra: 0, tone: 'orange' });
  if (n(c.remind)) out.push({ kind: 'remind', count: n(c.remind), extra: 0, tone: 'brand' });
  if (n(c.tests)) out.push({ kind: 'tests', count: n(c.tests), extra: 0, tone: 'orange' });
  if (n(c.unassigned)) out.push({ kind: 'assign', count: n(c.unassigned), extra: n(c.inFunnel), tone: 'brand' });
  return out;
}

/** The message keys of one card, under the "actionCards" namespace. */
export const actionCardKeys = (kind: ActionKind) => ({
  title: `${kind}Title` as `${ActionKind}Title`,
  text: `${kind}Text` as `${ActionKind}Text`,
  cta: `${kind}Cta` as `${ActionKind}Cta`,
});
