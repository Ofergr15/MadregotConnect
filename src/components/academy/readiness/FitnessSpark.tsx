'use client';

import { SPARK, sparkGeometry } from '@/lib/academy/readiness-board';

// ── The C1 spark (trainee-experience-v2 C1): fitness over 7 weeks, 64 × 30 ──────────────
//
// Oldest on the LEFT, yesterday on the right with a dot (spec G1), so a line that climbs
// toward the dot is a trainee building. Drawn in the band's colour; nothing at all under
// two points (a trainee still being learned), never a flat placeholder.

export function FitnessSpark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const g = sparkGeometry(values);
  if (!g) return <span aria-hidden className="block h-[30px] w-16 shrink-0" />;
  return (
    <svg width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} direction="ltr"
      className="block shrink-0" role="img" aria-label={label}>
      <path d={g.path} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={g.end.x} cy={g.end.y} r={3} fill={color} />
    </svg>
  );
}
