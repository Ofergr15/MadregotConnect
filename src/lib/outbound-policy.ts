/**
 * PROPOSAL (not wired yet): one decision for "may this environment send to a real person?"
 *
 * Production keeps today's behaviour untouched. Anywhere else (local `next dev`, Vercel previews)
 * outbound delivery is DENIED by default, and only these can be let through:
 *   MC_OUTBOUND=allowlist  + MC_OUTBOUND_ALLOW="a@x.com,b@y.com"  → only those exact addresses
 *   MC_OUTBOUND=all                                                  → everything (explicit opt-out)
 * Any other value, or none, is deny. The production check is on VERCEL_ENV, so a preview can never
 * claim to be production by setting a flag, and the flags are ignored in production entirely.
 */
export type OutboundChannel = 'email' | 'webpush' | 'apns' | 'staff';
export type OutboundDecision = { allowed: true } | { allowed: false; reason: string };
type Env = Record<string, string | undefined>;

export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production';
}

export function outboundAllowed(
  _channel: OutboundChannel,
  recipient: string | null,
  env: Env = process.env,
): OutboundDecision {
  if (isProductionDeployment(env)) return { allowed: true };
  const mode = (env.MC_OUTBOUND || '').trim();
  if (mode === 'all') return { allowed: true };
  if (mode === 'allowlist') {
    const allow = new Set((env.MC_OUTBOUND_ALLOW || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const r = (recipient || '').trim().toLowerCase();
    return r && allow.has(r) ? { allowed: true } : { allowed: false, reason: 'outbound:not-allowlisted' };
  }
  return { allowed: false, reason: 'outbound:non-production-default-deny' };
}
