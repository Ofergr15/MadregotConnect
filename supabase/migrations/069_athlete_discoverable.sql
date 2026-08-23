-- Roadmap #18/#21 — account-level privacy: an athlete can hide themselves
-- from the Member Discovery browse/search list (they still appear normally
-- in the feed, leaderboards, and to teammates who already know them via
-- follow/profile — this only controls the NEW discovery surface, matching
-- its own stated scope: "browse/search for someone you don't already see
-- elsewhere"). Defaults to true (discoverable) so nothing changes for
-- existing accounts until they explicitly opt out.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT true;
