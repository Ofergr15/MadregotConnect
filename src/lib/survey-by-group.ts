/**
 * A poll's results per pack (task 154): for each pack, how many were asked, how many
 * answered, and the count per option, so the staff screen can show "pack 1 is coming,
 * pack 3 is not" without opening every name.
 *
 * Counts only, never names, so the breakdown is the same for an anonymous poll (164).
 * A runner counts in the pack they are in NOW. Someone who answered but is not in the
 * audience any more (moved pack, audience edited) still counts, under their current pack.
 * With more than one answer allowed (161) a person adds to several options, but counts
 * once in `answered`. Packs come in lane order, "no pack" last; a pack nobody was asked
 * from and nobody answered from is left out.
 */
import { resolveGroup } from '@/lib/utils';

export interface SurveyGroupRow {
  groupId: string | null;
  name: string | null;
  lane: number | null;
  hex: string;
  asked: number;
  answered: number;
  /** Per option index, people in this pack who picked it. */
  counts: number[];
  /** answered / asked, 0–100 rounded; null when nobody in this pack was asked. */
  responsePct: number | null;
}

export function surveyByGroup(p: {
  optionCount: number;
  asked: string[];
  responses: Array<{ athlete_id: string; option_index: number }>;
  groupOf: (athleteId: string) => string | null;
  groups: Array<{ id: string; name: string | null }>;
}): SurveyGroupRow[] {
  const known = new Map(p.groups.map((g) => [g.id, g.name]));
  const key = (id: string) => {
    const g = p.groupOf(id);
    return g && known.has(g) ? g : null;
  };
  const rows = new Map<string | null, SurveyGroupRow & { who: Set<string> }>();
  const row = (gid: string | null) => {
    let r = rows.get(gid);
    if (!r) {
      const name = gid ? known.get(gid) ?? null : null;
      const g = resolveGroup(name);
      r = { groupId: gid, name, lane: gid && g.index >= 0 ? g.index + 1 : null, hex: g.hex, asked: 0, answered: 0, counts: Array(p.optionCount).fill(0), responsePct: null, who: new Set() };
      rows.set(gid, r);
    }
    return r;
  };
  for (const id of new Set(p.asked)) row(key(id)).asked += 1;
  const seen = new Set<string>();
  for (const r of p.responses) {
    if (r.option_index < 0 || r.option_index >= p.optionCount) continue;
    const dedupe = `${r.athlete_id}:${r.option_index}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const g = row(key(r.athlete_id));
    g.counts[r.option_index] += 1;
    g.who.add(r.athlete_id);
  }
  return [...rows.values()]
    .map(({ who, ...r }) => ({ ...r, answered: who.size, responsePct: r.asked ? Math.round((Math.min(who.size, r.asked) / r.asked) * 100) : null }))
    .sort((a, b) => {
      if (a.groupId === null) return 1;
      if (b.groupId === null) return -1;
      const la = a.lane ?? 99, lb = b.lane ?? 99;
      return la !== lb ? la - lb : (a.name ?? '').localeCompare(b.name ?? '', 'he', { numeric: true });
    });
}
