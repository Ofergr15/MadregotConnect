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
-- notices. So the pairs below are written out explicitly, and the update only
-- touches a row when its Latin name resolves to EXACTLY ONE athlete. Anything
-- unmatched is deliberately left alone.
--
-- WHAT THIS DOES NOT FIX: only 14 of the 39 names belong to someone with an
-- athletes row. The other 25 are club runners who ran the time trial but were
-- never added to the app. Their results stay unattached, correctly — inventing
-- athlete rows for them is a separate decision, not a data repair.
--
-- Safe to re-run: scoped to `athlete_id is null`, so a second pass changes
-- nothing.

with mapping(hebrew_name, latin_name) as (
  values
    ('עמית לזר',    'Amit Lazar'),
    ('איתי שפיגל',  'Itai Spiegel'),
    ('אלי סופר',    'Eli Soffer'),
    ('יאיר גבאי',   'yair Gabbay'),
    ('אילון כהן',   'Eylon Cohen'),
    ('אייל שלומי',  'eyal shlomi'),
    ('עידו בר און', 'עידו בר-און'),
    ('טרקין אדגו',  'tarkin adago'),
    ('יוסי סבג',    'Yosi Sabag'),
    ('שליו בהלול',  'Shalev Bahalul'),
    ('בן סיטבון',   'Ben Sitbon'),
    ('גיא יוסלזון', 'Guy Joselson'),
    ('סהר עזר',     'Sahar Azar'),
    ('שחר גלזנר',   'Shahar Glazner')
),
-- One athlete per mapped name: prefer an active row, then the newest. That is
-- the same tie-break requireSession and /api/auth/resolve-role already use to
-- pick among duplicate athlete rows, so this attributes the result to whichever
-- row the athlete actually signs in as.
--
-- Only one name needs it today — "Shahar Glazner" exists twice, an active row
-- and an invited duplicate carrying his synthetic Strava address. Same person,
-- so either choice names him correctly and the active one is the row his
-- profile is served from. The rule is applied to every name rather than
-- special-cased, because a second duplicate appearing later should resolve the
-- same way instead of silently doing nothing.
resolved as (
  select m.hebrew_name,
         (array_agg(a.id order by (a.status = 'active') desc, a.created_at desc))[1] as athlete_id
    from mapping m
    join athletes a
      on btrim(a.name) = m.latin_name
   group by m.hebrew_name
)
update benchmark_results b
   set athlete_id = r.athlete_id
  from resolved r
 where btrim(b.athlete_name) = r.hebrew_name
   and b.athlete_id is null;

-- What is left, and why. Expect 25 rows: club runners with no athletes row.
-- If this returns more than 25, a name in the mapping above stopped resolving
-- (someone was renamed or deactivated) and the mapping needs revisiting.
select count(*) as still_unattached
  from benchmark_results
 where athlete_id is null;
