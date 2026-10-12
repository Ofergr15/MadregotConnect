// ═════════════════════════════════════════════════════════════════════════════
// WHO IS COMING, PER PACK — the feed's "next session" card (feed redesign
// 2026-10-12): one row per pack with the faces, yours first, and one tap to join.
//
// A row's pack is the label the member picked ("דבוקה 2"); a bare "yes" from a
// notification button has no label, so it counts in the member's own pack.
// ═════════════════════════════════════════════════════════════════════════════

export interface LineupRow {
  athlete_id: string;
  attending: boolean;
  group_label: string | null;
  name: string | null;
  avatar_url: string | null;
  /** The member's own pack index (0..2) from their group, or -1. */
  home: number;
}
export interface LineupFace { id: string; name: string; avatarUrl: string | null }
export interface LineupPack { index: number; count: number; faces: LineupFace[] }
export interface Lineup { total: number; packs: LineupPack[]; mine: { attending: boolean; index: number } | null }

/** "דבוקה 2" / "2" → 1. Anything else → null. */
export function packIndexFromLabel(label: string | null | undefined): number | null {
  const m = (label || '').match(/([123])\s*$/);
  return m ? Number(m[1]) - 1 : null;
}

export const packLabel = (index: number) => `דבוקה ${index + 1}`;

export function buildLineup(rows: LineupRow[], me: string | null, maxFaces = 5): Lineup {
  const packs: LineupPack[] = [0, 1, 2].map((index) => ({ index, count: 0, faces: [] }));
  let mine: Lineup['mine'] = null;
  let total = 0;
  for (const r of rows) {
    const idx = packIndexFromLabel(r.group_label) ?? (r.home >= 0 ? r.home : null);
    if (r.athlete_id === me) mine = { attending: r.attending, index: r.attending ? (idx ?? -1) : -1 };
    if (!r.attending) continue;
    total++;
    if (idx == null || !packs[idx]) continue;
    const p = packs[idx];
    p.count++;
    // The viewer first in their own pack: it is the moment the design is about.
    const face = { id: r.athlete_id, name: r.name || '', avatarUrl: r.avatar_url };
    if (r.athlete_id === me) p.faces.unshift(face);
    else if (p.faces.length < maxFaces) p.faces.push(face);
  }
  for (const p of packs) if (p.faces.length > maxFaces) p.faces.length = maxFaces;
  return { total, packs, mine };
}
