/**
 * The x axis of every time chart in the trainee screens (build plan §6, spec G1).
 *
 * Time runs LEFT → RIGHT even in this RTL app: the oldest point is on the far left, today
 * on the right, a projection further right. `i = 0` is the oldest. The SVG that uses this
 * is `direction="ltr"`, and its labels are HTML spans positioned over it, never `<text>`.
 */

/** x of point `i` of `n` across `width`, inside the paddings. A single point sits at `padL`. */
export function xAt(i: number, n: number, width: number, padL = 0, padR = 0): number {
  const span = width - padL - padR;
  return padL + (n <= 1 ? 0 : (i / (n - 1)) * span);
}

/**
 * A smooth path through the points: a cubic per gap with both control points at the gap's
 * horizontal midpoint, so the curve never overshoots a point vertically (the mockup's).
 */
export function smoothPath(points: Array<[number, number]>): string {
  if (!points.length) return '';
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const m = (x0 + x1) / 2;
    d += ` C${f(m)} ${f(y0)} ${f(m)} ${f(y1)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}
