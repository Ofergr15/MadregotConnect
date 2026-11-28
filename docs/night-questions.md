# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 88 — group chat message search

- **What does search cover?** Safe default shipped: top-level messages in that one group only. Thread replies and deleted messages are left out. The query must be 2–100 characters, pages are 20 by default (50 at most), and paging uses Stream's cursor. Open: include thread replies (each result would open its thread)?
- **Stream plan:** search uses Stream's server-side message search. If the plan doesn't include it, the endpoint returns 503 "search unavailable" and nothing else breaks.
