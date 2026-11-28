/**
 * Push dry run (task 196): the whole send pipeline — maintenance, mute, quiet hours,
 * ghost pruning, badges, the per-device delivery log (migration 171), dead-token
 * pruning — with the last hop replaced. No web push or APNs request leaves the
 * process.
 *
 * Two ways in:
 *  - tests: `setPushDryRun(sim)` with a simulator that answers per device (ok, or a
 *    push-service status). 404/410 then prune exactly as a real dead endpoint would.
 *  - an environment: `PUSH_DRY_RUN=1` (a preview, a load test). Every device "accepts",
 *    so nothing is ever pruned on a simulated answer outside a test.
 *
 * Every delivery row a dry run writes carries `error: 'dry-run…'`, which the push
 * health screen counts as muted (lib/push-deliveries stateOf), never as a push the
 * phone failed to show.
 */
export const DRY_RUN_MARK = 'dry-run';

export type DryRunDevice = { subscriptionId: string; athleteId: string; channel: 'webpush' | 'apns'; body: string };
export type DryRunResult = { ok: true } | { ok: false; status: number };
export type DryRunTransport = (device: DryRunDevice) => DryRunResult | Promise<DryRunResult>;

let override: DryRunTransport | null = null;

/** Tests only. `null` restores the real transport. */
export function setPushDryRun(transport: DryRunTransport | null): void {
  override = transport;
}

export function pushDryRunTransport(): DryRunTransport | null {
  if (override) return override;
  if (process.env.PUSH_DRY_RUN === '1') return () => ({ ok: true });
  return null;
}

/** A push-service status that means "this device is gone", for either channel. */
export function isDeadStatus(status: number): boolean {
  return status === 404 || status === 410;
}
