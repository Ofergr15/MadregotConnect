export type PaceLevel = 'fast' | 'medium' | 'slow';

// The bucket boundaries a group's fast/medium/slow badge is derived from.
// Kept in one place — GET /api/groups used to compute this correctly but then
// immediately overwrite it with whatever level was already stored, while PUT
// only recomputed level when the caller explicitly sent one; editing just the
// pace offset left the stored level stale forever after.
export function paceLevelFromOffset(offsetSeconds: number): PaceLevel {
  if (offsetSeconds <= 0) return 'fast';
  if (offsetSeconds <= 15) return 'medium';
  return 'slow';
}
