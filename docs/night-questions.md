# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 84 — store order status transitions (PATCH /api/admin/store/orders/[id])

- **Which moves count as normal?** Safe default shipped: only forward one step (pending_payment → paid → fulfilled), or cancel before hand-over. Every other move (handed over unpaid, undoing a step, reopening a cancelled order, cancelling after hand-over) is allowed only with a written reason of up to 200 characters, stored on the audit row. Open: should "fulfilled → cancelled" (a refund) be a normal step, and should a reopened cancelled order be blocked outright? **Decided (28.11): both allowed, with a reason** (as shipped).
- **Reason prompt in the web store manager** is a plain `window.prompt` for now. Open: a proper sheet with preset reasons ("paid in cash", "marked by mistake")? **Decided (28.11): in-app bottom sheet, no window.prompt** — chips החזר כספי / טעות בלחיצה / התשלום לא עבר / אחר (free text required for אחר), submit disabled until there is a reason; normal forward steps stay one tap. Open for the owner: the iPhone app must send `reason` on exceptional moves, or only the normal path works there.
