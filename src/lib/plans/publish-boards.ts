import type { GroupedWeeklyPlans } from '@/lib/ai/types';

/**
 * The BOARDS a plan publishes: one PNG + machine-text per group per session.
 *
 * Nine sessions is twenty-seven boards, and the review screen's only account of
 * them used to be a "published" badge on whichever group's tab happened to be
 * open — so a plan where ❶ was published and ❷/❸ silently weren't looked
 * finished. Counting is the whole job, and it's here rather than in the screen so
 * the hero's total, a session's "2/3" and the publish button's caption are one
 * number read three times.
 *
 * Order is SESSION-major (Sunday ❶❷❸, then Monday ❶❷❸, …), which is how the dot
 * grid is read: a gap in a triplet is one session that failed for one group.
 */

export interface Board {
  group: 1 | 2 | 3;
  /** Index into that group's `workouts` array — the same index the rail selects. */
  index: number;
  published: boolean;
}

const GROUPS = [1, 2, 3] as const;

export function boardStates(grouped: GroupedWeeklyPlans): Board[] {
  const boards: Board[] = [];
  const count = grouped.group1.workouts.length;
  for (let index = 0; index < count; index++) {
    for (const group of GROUPS) {
      const workout = grouped[`group${group}`].workouts[index];
      boards.push({ group, index, published: !!workout?.clipboardImageUrl });
    }
  }
  return boards;
}

export function boardCounts(grouped: GroupedWeeklyPlans): { published: number; total: number } {
  const boards = boardStates(grouped);
  return { published: boards.filter((b) => b.published).length, total: boards.length };
}

/** How many of one session's three boards exist — 3 means that session is done. */
export function sessionBoardsPublished(grouped: GroupedWeeklyPlans, index: number): number {
  return GROUPS.filter((g) => !!grouped[`group${g}`].workouts[index]?.clipboardImageUrl).length;
}
