# Club management (web) — friction audit

Scope: the coach / admin screens under `src/app/(app)/dashboard/**` (ניהול, אימונים,
חנות, תוכן, בדיקות). Method: read each screen for (1) extra taps, (2) confirmations,
(3) empty states, (4) loading/error states. Night task 51, 2026-11-27.

## Findings

| # | Screen | Kind | Finding | Status |
|---|---|---|---|---|
| 1 | `store/podium/admin` — "נשלח לפודיום" | confirmation | native `confirm()` for an irreversible step; text cut on phones | **fixed** (in-app ConfirmStrip) |
| 2 | `store/podium/admin` — resend notify | confirmation | native `confirm()` | **fixed** |
| 3 | `store/podium/admin` — delete order | confirmation | native `confirm()` | **fixed** |
| 4 | `store/podium/admin` — delete group order | confirmation | native `confirm()` | **fixed** |
| 5 | `store/podium/admin` — delete round | confirmation | native `confirm()` for the most destructive action on the screen | **fixed** |
| 6 | `run-together/[id]` — cancel run | confirmation | native `confirm()` | **fixed** |
| 7 | `tests` — cleanup test accounts | confirmation | native `confirm()` | **fixed** |
| 8 | `day-session` — switch mode with steps | confirmation | native `confirm()` | **fixed** |
| 9 | `birthdays` | empty state | with nothing waiting / this week / later the screen was a header and nothing else | **fixed** ("אין ימי הולדת קרובים") |
| 10 | `club-updates` — writers list | empty state | a search with no match rendered an empty white card | **fixed** |
| 11 | `registrations`, `onboarding-funnel`, `numbers`, `move` | — | thin wrappers around shared components; audited via those components, nothing new | — |
| 12 | `athletes` | taps | no bulk actions (group move one runner at a time) | open — bigger than a night fix |
| 13 | `feedback` (341 lines) | empty state | relies on the queue component's own empty state; fine | — |
| 14 | `entry-queue`, `profile` | confirmation | already two-step in-app (the pattern the fixes above copy) | — |
| 15 | `store/podium/admin` | taps | delete lives inside the edit sheet (open → scroll → delete → confirm = 4 taps) | open — layout change, needs a design call |
| 16 | `practice-attendance` | loading | good skeletons + empty copy | — |

## The pattern now

`src/components/ui/ConfirmStrip.tsx` → `const { ask, confirmUi } = useConfirm();`,
`ask(message, run, confirmLabel?)`, render `{confirmUi}` once in the page root. The
warning text stays visible, "yes" is red and "cancel" is neutral and focused.
`noWindowConfirmInDashboard.test.ts` fails if a dashboard screen calls `confirm(` again.
