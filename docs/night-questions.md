# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 108 — unified error responses

- **Do any clients show the raw 500 text to members?** Safe default shipped: 87 500s that returned `error: err.message` (Postgres / SDK text, sometimes table names or ids) now return a fixed `internalErrorBody('…')` string; the real error is still logged server-side. A ratchet test stops the remaining 115 raw-message 500s from growing and fails if any 4xx/5xx body lacks `error`. Open: convert the remaining 115 in a follow-up, or leave them for routes that are staff-only?
