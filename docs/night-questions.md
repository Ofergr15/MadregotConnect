# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 92 — RSVP reminder (GET /api/events/[id]/rsvp-reminder)

- **Should the reminder actually send a push, and to whom?** Safe default shipped: data only (dry run). Staff see who hasn't answered and the push copy they would get; nothing is sent, and the endpoint 404s until `event_rsvp_reminder` is turned on. Open: send on a staff tap, or on a schedule (e.g. 2 days before)? Everyone active, or only the event's group?
- **Is a cancel an answer?** Default: yes — a cancelled registration means "not coming" and is not nagged.
