// ═════════════════════════════════════════════════════════════════════════════
// A PACK'S WEEK — the numbers on the pack page and on the feed's pack strip
// (feed redesign 2026-10-12, modelled on a Strava club page): kilometres together,
// runs, who ran, and a ranking that always shows the viewer's own row.
// ═════════════════════════════════════════════════════════════════════════════

export interface BoardEntry { id: string; name: string; distanceKm: number; runs: number }
export interface PackWeek {
  km: number;
  runs: number;
  ran: number;
  members: number;
  /** Highest first. */
  board: Array<BoardEntry & { rank: number }>;
  /** 1-based, or null when the viewer is not in this pack's board. */
  myRank: number | null;
}

export function packWeek(entries: BoardEntry[], memberIds: string[], me: string | null): PackWeek {
  const inPack = new Set(memberIds);
  const rows = entries.filter((e) => inPack.has(e.id));
  // Members with no run this week still belong on the board, at the bottom.
  for (const id of memberIds) if (!rows.some((r) => r.id === id)) rows.push({ id, name: '', distanceKm: 0, runs: 0 });
  const sorted = [...rows].sort((a, b) => b.distanceKm - a.distanceKm || a.name.localeCompare(b.name));
  const board = sorted.map((e, i) => ({ ...e, rank: i + 1 }));
  const km = Math.round(rows.reduce((a, e) => a + (e.distanceKm || 0), 0) * 10) / 10;
  return {
    km,
    runs: rows.reduce((a, e) => a + (e.runs || 0), 0),
    ran: rows.filter((e) => e.distanceKm > 0).length,
    members: memberIds.length,
    board,
    myRank: me ? (board.find((e) => e.id === me)?.rank ?? null) : null,
  };
}

/** The rows to show: the top `top`, plus the viewer with one above and one below. */
export function boardWindow<T extends { id: string; rank: number }>(board: T[], me: string | null, top = 3): Array<T | 'gap'> {
  const keep = new Set<number>();
  for (let i = 0; i < Math.min(top, board.length); i++) keep.add(i);
  const mi = me ? board.findIndex((e) => e.id === me) : -1;
  if (mi >= 0) for (const i of [mi - 1, mi, mi + 1]) if (i >= 0 && i < board.length) keep.add(i);
  const idx = [...keep].sort((a, b) => a - b);
  const out: Array<T | 'gap'> = [];
  idx.forEach((i, k) => { if (k && i - idx[k - 1] > 1) out.push('gap'); out.push(board[i]); });
  return out;
}
