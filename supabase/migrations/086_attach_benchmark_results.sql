-- Attach the 2000m time-trial results to the athletes who ran them.
--
-- WHAT IS WRONG: benchmark_results holds 43 rows, and 39 of them have
-- athlete_id NULL. All 39 are status='approved' and share one created_at
-- (2026-07-14 11:34:01.481221+00), so they arrived as a single bulk import of a
-- club 2000m time trial. Every one carries the runner's name in `athlete_name`
-- and nothing in `athlete_id`, which means they are attached to nobody: they
-- cannot appear on a profile, in a personal-best, or in any leaderboard that
-- joins on athlete_id. Thirty-nine approved race results, invisible.
--
-- WHY NAME MATCHING DOESN'T JUST WORK: the import wrote Hebrew names, while the
-- athletes table stores the same people transliterated into Latin — "עמית לזר"
-- against "Amit Lazar", "איתי שפיגל" against "Itai Spiegel". An exact join on
-- name matches zero of the 39. Even the two Hebrew-on-both-sides cases differ:
-- "עידו בר און" against "עידו בר-און", one hyphen apart.
--
-- WHY THE MAPPING IS SPELLED OUT BY HAND: fuzzy or phonetic matching across
-- scripts would silently attach one runner's time to another, and a wrong
-- personal best is worse than a missing one — it is wrong in a way nobody
-- notices. So the 14 name pairs were written out by hand, and each was only
-- accepted when its Latin name resolved to EXACTLY ONE athlete. Anything
-- unmatched is deliberately left alone.
--
-- WHAT THIS DOES NOT FIX: only 14 of the 39 names belong to someone with an
-- athletes row. The other 25 are club runners who ran the time trial but were
-- never added to the app. Their results stay unattached, correctly — inventing
-- athlete rows for them is a separate decision, not a data repair.
--
-- Safe to re-run: scoped to `athlete_id is null`, so a second pass changes
-- nothing.

-- WHY THIS IS SPELLED OUT AS IDS RATHER THAN NAMES: the first version of this
-- migration carried the Hebrew names as SQL literals, and pasting it into the
-- Supabase SQL editor failed with `42601 syntax error at or near`. The editor's
-- bidirectional text handling reorders the quote and comma that follow an RTL
-- string, so a mapping table of Hebrew literals cannot be pasted reliably no
-- matter how correct the bytes on disk are. The pairs below were resolved by
-- running the same active-first-then-newest tie-break against production, and
-- every one of the 14 matched exactly one athlete. Only Shahar Glazner needed
-- the tie-break (an active row and an invited duplicate holding his synthetic
-- Strava address, the same person); it took the active row.
--
-- The cost of this form is that it is a one-time script rather than a rule: it
-- is pinned to specific benchmark_results ids, so it repairs today's 39 orphans
-- and nothing a future import creates. That is the right trade here, because the
-- real fix for future imports is to resolve the athlete at import time.

update benchmark_results b
   set athlete_id = m.athlete_id::uuid
  from (values
  ('528bb026-88a6-43b6-8368-cd3e3e344684', '4d3d0b13-2d1f-4e2b-ace6-ecbdbf99b45d'),
  ('609aa7f2-5262-422d-b91a-40885560c902', 'd1720752-8428-4f3a-ab0a-ee6599246300'),
  ('5e9a49b3-58d0-4505-949e-af96dac244cf', '08f657a1-d216-4bec-8a91-a49da643cea5'),
  ('985fcb88-4a54-4ae8-8da3-632ce3043275', 'b872d490-a6c3-46fb-9860-b2394359503d'),
  ('71ae06cc-0a91-479f-a09a-45ef99648d63', '2d20dd3c-6a11-4f97-8fcc-f53e159c51fa'),
  ('ffce06c2-5678-416a-90d5-39d3a67ee309', 'bcc2f219-a702-4ab0-addc-ab895e9f1d7b'),
  ('98387546-58d5-4fec-9d0b-a1d033c0f6bd', '9b2f764b-607e-4474-b99d-224cd9784560'),
  ('6b4f05ac-1cb5-4995-81b7-fdee250fd9d0', 'a6e8d610-5e48-4f05-b1a4-f7410db93911'),
  ('1230b424-3974-4547-813a-afa103f26677', '468dc4ff-1e45-4782-bc20-45e75be856a0'),
  ('4a86ef53-acb4-4ee6-a79f-6e5f9b933730', 'ed97be1c-ba4f-44d5-a03e-f9494d9cd257'),
  ('6aa3ce52-d44a-49fa-aad1-f392ed3203e2', '6875efb3-9c52-4593-b46a-7c4b23b8d439'),
  ('118ca85e-faf7-4273-a391-daef223d086d', 'e1f25ece-25f1-4515-8fee-c208dc3c6307'),
  ('bd2788a4-dd64-4cd9-98b0-39f193bacc92', 'feeac531-9661-4713-ad76-a9003818abee'),
  ('2dee9ba0-50f1-4af9-88f7-4903fc6aefc0', '07ddc9ba-a0bd-41b3-a409-8f0e5b429b87')
  ) as m(id, athlete_id)
 where b.id = m.id::uuid
   and b.athlete_id is null;

-- What is left, and why. Expect 25 rows: club runners with no athletes row.
select count(*) as still_unattached
  from benchmark_results
 where athlete_id is null;
