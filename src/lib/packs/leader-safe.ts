// ── What a pack leader may receive ──────────────────────────────────────────
//
// A pack leader (migration 215) is a runner, not staff. Their screens show who came, who
// read the plan and when someone last ran — never a plan verdict / accuracy score, a heart
// rate, or a pain report on a teammate (CLAUDE.md, "Recorded exposure change, 2026-11-24").
// The leader routes are built without those fields; `forLeader` is the belt to that braces:
// every leader response goes through it, so a field added to a shared loader later cannot
// ride out to a leader by accident. Pinned by src/__tests__/packLeaderGate.test.ts.

/** True for a key that carries a verdict, heart rate or pain, in any casing. */
export function isLeaderForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k.includes('verdict') || k.includes('pain') || k.includes('heart') || k.includes('accuracy')) return true;
  // hr, avgHr, maxHR, averageHR, hr_zone, hrZones
  return /(^|_)hr($|_|zone)/.test(k) || /hr$/.test(k) || /^(avg|max|min|average|resting)hr/.test(k);
}

/** A deep copy with every forbidden key removed, at any depth. */
export function forLeader<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => forLeader(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isLeaderForbiddenKey(k)) continue;
      out[k] = forLeader(v);
    }
    return out as T;
  }
  return value;
}
