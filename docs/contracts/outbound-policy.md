# Proposal: default-deny outbound sends outside production

Status: **proposal, unwired.** `src/lib/outbound-policy.ts` + `src/__tests__/outboundPolicy.test.ts` exist on the
branch; no sender calls them yet. Nothing changes in production by design (`VERCEL_ENV === 'production'` → allowed).

Rule outside production: deny unless `MC_OUTBOUND=allowlist` (+ `MC_OUTBOUND_ALLOW` exact addresses) or
`MC_OUTBOUND=all`. A typo is deny.

Patch guidance for the coordinator (one guard per chokepoint, no call-site edits):
1. Email: in `src/lib/email/send.ts`, before the `cfg.hasKey` check (~line 174), call
   `outboundAllowed('email', recipient)` per recipient and drop the denied ones, logging them as
   `skipped: <reason>` like `synthetic-address` (`send.ts:155`). Empty list → `skipped`.
2. Web push: in `sendPushDetailed` (`src/lib/push.ts`), filter subscriptions through
   `outboundAllowed('webpush', athleteEmail)`; needs the athlete email joined, or deny all when not production
   and mode ≠ all.
3. APNs: in `sendPushNative` (`src/lib/push-native.ts`), same as web push.
4. Staff push: covered by 2–3, since `notifyStaff` ends in the same senders.
Rollout: wire 1 first (it is where fixed real addresses live), with a test asserting `APPROVER_EMAILS` is denied
when not production. Local Mac server: set nothing → no real mail; set `MC_OUTBOUND=allowlist` and
`MC_OUTBOUND_ALLOW=<the QA address>` to receive the test login code.
