/**
 * Latest-wins for autosave echoes.
 *
 * Both characterization parents (TraineeSetup, CandidateFunnel) replace the form's `value` with
 * the PUT's echo. If two saves were ever in flight and the earlier one answered last, applying
 * every echo would put the older answers back on screen. A ticket per save, and only the most
 * recent ticket may apply its echo.
 */
export interface LatestEcho {
  /** Call when a save starts; keep the ticket. */
  begin(): number;
  /** True only for the most recently begun save. */
  isLatest(ticket: number): boolean;
}

export function latestEcho(): LatestEcho {
  let seq = 0;
  return {
    begin: () => ++seq,
    isLatest: (ticket) => ticket === seq,
  };
}
