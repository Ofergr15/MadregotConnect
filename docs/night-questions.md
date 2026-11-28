# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 107 — request body validation (src/lib/api/parse-body.ts)

- **Loose or strict schemas?** Safe default shipped: loose. The 20 handlers check field TYPES only (`z.looseObject`, every field optional), unknown keys pass through, and the existing "x required" 400s stay where they were. A wrong type or a non-JSON body is now a 400 `{ error: 'Invalid body', details }` instead of a 500 or a silent coercion. Open: should unknown keys be rejected (strict) once the native app's request shapes are pinned, and should required fields move into the schema?
