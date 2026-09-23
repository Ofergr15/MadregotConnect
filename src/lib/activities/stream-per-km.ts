/**
 * A per-sample channel of the Garmin trace, averaged over each kilometre the
 * splits already drew (#74).
 *
 * Power and performance condition exist only in the trace (`activity_streams`),
 * not in the laps the splits are binned from. So the bins come from the splits:
 * split i covers the trace from the cumulative distance before it to the one
 * after it, and the last split runs to the end of the trace — it is the one that
 * absorbed the short trailing stretch (see `kmSplitsFromLaps`), and the watch's
 * trace distance never matches the lap total to the metre anyway.
 *
 * Samples are ~1 Hz, so a sample mean is a time mean. Null samples (and zero
 * power, a dropped pod) are skipped; a kilometre with none left is null.
 */

export function perKmFromStream(
  splits: Array<{ distance: number }>,
  d: number[],
  values: Array<number | null> | undefined,
  { skipZero = false } = {},
): Array<number | null> {
  if (!values || values.length !== d.length || splits.length === 0) return splits.map(() => null);
  const ends: number[] = [];
  let run = 0;
  for (const s of splits) { run += s.distance; ends.push(run); }
  ends[ends.length - 1] = Infinity;

  const sums = splits.map(() => 0);
  const counts = splits.map(() => 0);
  let bin = 0;
  for (let i = 0; i < d.length; i++) {
    while (bin < ends.length - 1 && d[i] >= ends[bin]) bin += 1;
    const v = values[i];
    if (v == null || (skipZero && v === 0)) continue;
    sums[bin] += v;
    counts[bin] += 1;
  }
  return sums.map((sum, i) => (counts[i] ? Math.round(sum / counts[i]) : null));
}
