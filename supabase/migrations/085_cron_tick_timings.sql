-- Make cron/tick's own runtime durable, so the 60s maxDuration question can be
-- answered by a query instead of a guess.
--
-- WHY: the tick has maxDuration 60 and a doc comment worrying that the Sunday
-- weekly-recap stage might approach it. v2.39.26 started logging how long each
-- tick takes — and that turned out to be unreadable. `vercel logs` only tails
-- live; there is no history to fetch, and two attempts to capture a tick that
-- way returned zero bytes. So the number exists, is correct, and nobody can see
-- it, which is the same as not having it.
--
-- A tick that dies at the ceiling never reaches markFired, so it re-attempts a
-- partial send on the next few ticks — that is the failure this is meant to catch
-- before athletes get duplicate pushes, and catching it needs a trend, not one
-- live sample.
--
-- WHY HERE: cron_tick_locks (migration 074) already has exactly one row per tick,
-- inserted at the start of the run as the overlap guard, and is already pruned to
-- two days. So the row to hang the timing on exists, the retention policy exists,
-- and the cost is one UPDATE per tick on a primary-key match. A separate metrics
-- table would need both invented from scratch.
--
-- Nullable, with no default: NULL means the tick never got to the end — it timed
-- out, crashed, or is still running. That is the most interesting value in the
-- table and must not be indistinguishable from zero.

alter table cron_tick_locks
  add column if not exists duration_ms integer,
  add column if not exists fired_count integer;

comment on column cron_tick_locks.duration_ms is
  'Wall-clock ms from the start of the tick to just before it returned. NULL means it never finished — timed out, crashed, or still running — which is not the same as 0.';
comment on column cron_tick_locks.fired_count is
  'How many notification stages actually sent on this tick. A slow tick that fired nothing is a different problem from a slow tick that did real work.';

-- Reading this means "the recent ticks, worst first", which is a small scan of a
-- two-day table — but the NULLs are the rows worth finding fastest, and they are
-- rare, so index those specifically.
create index if not exists cron_tick_locks_unfinished_idx
  on cron_tick_locks (tick_at desc)
  where duration_ms is null;
