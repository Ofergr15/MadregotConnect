/** A repeat block's sub-steps, split into the one that carries the workout and the rest. */
export interface RepeatSplit<T> {
  /** The work interval — what "6x" is actually 6 of. Null only for an empty block. */
  lead: T | null;
  /** Everything else, in the coach's original order (usually just the recovery). */
  rest: T[];
}

/**
 * Picks the sub-step a repeat block should lead with: the first one that isn't a
 * recovery.
 *
 * A card that has room for one line per block must spend it on "1 km @ 3:45",
 * not on "90 שנ׳ שחרור" — and the recovery is often written first in the source
 * plan. Pyramids (400/800/400) keep every work step; they just appear on the
 * lines below, each with its own pace.
 */
export function splitRepeatSteps<T extends { type?: string }>(subs: T[]): RepeatSplit<T> {
  if (subs.length === 0) return { lead: null, rest: [] };
  const isRecovery = (s: T) => s.type === 'rest' || s.type === 'recovery';
  const leadIdx = subs.findIndex(s => !isRecovery(s));
  const idx = leadIdx === -1 ? 0 : leadIdx;
  return { lead: subs[idx], rest: subs.filter((_, i) => i !== idx) };
}
