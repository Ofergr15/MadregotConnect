/**
 * Which of a plan's three pace variants belongs to which club group.
 *
 * A published plan stores `{ group1, group2, group3 }` — the same week at three
 * paces. Nothing in the database says which club group is which variant; the rule
 * has always been implicit in the planner's UI, which sorts the groups by
 * marathon goal (fastest first) and hands slot 1 to the fastest.
 *
 * That was fine while the planner was the only thing pushing workouts. It is not
 * fine now that an athlete can push their OWN week from the dashboard
 * (bc77a4a2): a second implementation of this rule that disagreed by one index
 * would put the wrong paces on a real person's watch, which is worse than not
 * offering the button. So the rule lives here, once, and both callers read it.
 */

export type PaceGroupKey = 'group1' | 'group2' | 'group3';

export interface PaceGroupSource {
  id: string;
  /** As `/api/groups` returns it: a string off `pace_profile.marathonGoal`, often ''. */
  marathonGoal?: string | number | null;
}

/**
 * Groups whose goal can't be read sort LAST, behind every real time, and ties
 * among them break by input order — which is `/api/groups`' order, and which
 * `Array.prototype.sort` preserves.
 */
const NO_GOAL = Number.MAX_SAFE_INTEGER;

/**
 * Goal → minutes.
 *
 * `marathonGoal` is free text the coach types into the group editor, and what is
 * actually in production is `"SUB 2:30"`, `"SUB 2:35"`, `"SUB 2:45"`. The
 * planner's original comparator did `parseFloat(marathonGoal)`, which returns
 * NaN on all three — so the sort it looked like it was doing has never done
 * anything, and the real mapping has always been the row order `/api/groups`
 * happened to return (fastest group created first, so it came out right).
 *
 * Reading the H:MM out of the string makes the rule mean what it says. On the
 * three real groups it gives the same answer the row order gives today; the
 * difference is that it keeps giving the right answer if a group is renamed,
 * re-created, or added out of order.
 */
function goalOf(group: PaceGroupSource): number {
  const raw = group.marathonGoal;
  if (raw === null || raw === undefined || raw === '') return NO_GOAL;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NO_GOAL;

  const clock = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (clock) {
    const [, h, m] = clock;
    return Number(h) * 60 + Number(m);
  }
  // A bare number — treat it as hours, the only reading of "3" for a marathon.
  const bare = parseFloat(String(raw));
  return Number.isFinite(bare) ? bare * 60 : NO_GOAL;
}

/**
 * Fastest goal first, unset goals last. Exported because the planner shows the
 * groups in this order and labels them "group N" off the index — the same rule
 * read twice, which is the thing this file exists to prevent.
 */
export function sortByPaceGroup<T extends PaceGroupSource>(groups: T[]): T[] {
  return [...groups].sort((a, b) => goalOf(a) - goalOf(b));
}

/** group id → plan variant, fastest group first. Beyond the third group, everyone shares group3. */
export function paceGroupMap(groups: PaceGroupSource[]): Record<string, PaceGroupKey> {
  const sorted = sortByPaceGroup(groups);
  const map: Record<string, PaceGroupKey> = {};
  sorted.forEach((g, i) => {
    map[g.id] = i === 0 ? 'group1' : i === 1 ? 'group2' : 'group3';
  });
  return map;
}

/**
 * One athlete's variant. An athlete with no group — or one in a group the caller
 * didn't load — gets `group2`, the middle: the planner's long-standing default,
 * and the one whose paces are wrong by the least if the guess is wrong at all.
 */
export function paceGroupKeyFor(
  groups: PaceGroupSource[],
  groupId: string | null | undefined,
): PaceGroupKey {
  if (!groupId) return 'group2';
  return paceGroupMap(groups)[groupId] || 'group2';
}
