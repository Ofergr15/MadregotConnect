// ── Whose problem is it when a workout does not reach the watch? ─────────────
//
// The mockup's own words about the failed row: **"הוא לא יודע שאין לו אימון"**. That is the
// state today. When a push fails, the coach gets one batch alert and the athlete gets
// nothing at all — so on Monday morning they press Start on a watch with nothing on it, and
// the missed session reads as theirs.
//
// The obvious fix — notify the athlete on every failure — is worse than the silence. Most
// failures are Garmin being Garmin: a rate limit, a 502, a timeout mid-batch. The coach
// retries a few minutes later and it lands. An athlete told "you have no workout" for each
// of those learns that the message means nothing, and the ONE time it means "your watch has
// been disconnected for three days and only you can fix it" they will scroll past it. Three
// notifications per workout is the ceiling the mockup sets, and the reason it gives is
// exactly this: any extra and people turn notifications off, which costs all the value.
//
// So the athlete hears about a failure only when there is something for them to DO. That is
// the whole judgement in this file, and it splits two ways:
//
//   `reconnect` — their Garmin link is gone: no token stored, or Garmin refused the one we
//                 hold. Nobody but the athlete can fix it, the coach retrying will fail
//                 identically forever, and every day of silence is another session lost.
//
//   `ours`      — everything else, INCLUDING anything unrecognised. Garmin was down, we hit
//                 a limit, our own code threw. The coach can see it and retry; the athlete
//                 can do nothing but worry.
//
// Unrecognised messages resolving to `ours` is the deliberate direction of the default. The
// cost of the two mistakes is not symmetric: a missed `reconnect` leaves one athlete in the
// state they are already in today, while a false `reconnect` tells someone their watch is
// broken when it is not — and teaches them to ignore the alert that matters.

export type DeliveryFailureBlame = 'reconnect' | 'ours';

/**
 * The exact string `push-workouts` records when the athlete row has no token at all. Matched
 * as a constant rather than by keyword because it is ours, it does not vary, and it is the
 * single clearest `reconnect` case there is.
 */
export const NO_TOKEN_ERROR = 'No Garmin auth token';

/**
 * Garmin rejecting the credential we hold. `garmin-connect` surfaces transport errors as
 * axios text, so these are matched against the message rather than a status field.
 *
 * 403 is absent on purpose. Garmin returns it both for a dead session and for requests it
 * simply will not serve right now (it is what their bot protection answers with under load),
 * and a shared meaning cannot carry an instruction to go reconnect. It stays `ours`, where
 * an unrecognised failure belongs.
 */
const RECONNECT_PATTERNS: readonly RegExp[] = [
  /\b401\b/,
  /unauthori[sz]ed/i,
  /invalid[_ -]?grant/i,
  /\b(access|refresh|oauth)[_ ]?token\b.*\b(expired|invalid|revoked)\b/i,
  /\b(expired|invalid|revoked)\b.*\b(access|refresh|oauth)[_ ]?token\b/i,
  /re-?authenticat/i,
  /login failed/i,
  /\bnot logged in\b/i,
];

/**
 * Who has to act on this failure.
 *
 * Takes the message rather than the error object: the value that reaches the send site has
 * already been flattened to `error.message` on the way into `PushResult`, and re-deriving a
 * shape from it would be guessing about a library's internals.
 */
export function classifyDeliveryFailure(message: string | null | undefined): DeliveryFailureBlame {
  const text = String(message || '').trim();
  if (!text) return 'ours';
  if (text === NO_TOKEN_ERROR) return 'reconnect';
  return RECONNECT_PATTERNS.some(p => p.test(text)) ? 'reconnect' : 'ours';
}

/**
 * True when this failure is worth telling the athlete about.
 *
 * A named predicate because the send site reads better for it, and because "should the
 * athlete hear about this" is the actual decision — `classifyDeliveryFailure` answering
 * `'ours'` is not a thing anyone notifies about.
 */
export function shouldTellAthlete(message: string | null | undefined): boolean {
  return classifyDeliveryFailure(message) === 'reconnect';
}
