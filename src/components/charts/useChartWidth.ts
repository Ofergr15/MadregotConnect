'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The chart's rendered width in CSS pixels, used as the SVG's own coordinate width.
 *
 * Every hand-rolled chart in this app measures instead of declaring a viewBox, and the
 * reason is a shipped defect: the activity charts used a fixed 1000-unit viewBox against
 * a fixed pixel height, so `preserveAspectRatio` scaled all 1000 units down to fit — on a
 * 358px phone the plot rendered at 36%, leaving ~140px of dead space above it and drawing
 * the 11px axis labels at about 4px. Measuring makes one SVG unit one pixel, so a stated
 * font size means what it says at every container width.
 *
 * Shared rather than copied because that defect is invisible until someone looks at a
 * phone: a second chart that declares its own viewBox looks correct in code review and
 * wrong on the only device this app runs on.
 */
export function useChartWidth(min = 240, initial = 320) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Narrower than any real container, so the first paint is never wider than the box it
  // lands in — it grows to fit on measure, rather than overflowing first.
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(min, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);

  return { boxRef, width };
}
