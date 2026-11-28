# Night questions

## Task 105: pace formatting on edge inputs
The 10 copied `m:ss` formatters now all call `src/lib/pace/format.ts`. For every real pace the output is the same. On two kinds of edge input it changes:
- A pace whose seconds round up to 60 (for example 239.6 s) used to print "3:60" in the split-first copies. It now prints "4:00", which is what share-image, pace-verdict and the Strava client already printed.
- NaN, Infinity or a negative pace used to print "NaN:NaN" or "-2:-28". It now prints "—".

Is that wanted everywhere?
Safe default chosen: yes, because neither old output is a readable pace. The looser input parsers (step-tree, day-session, AI parser, meetups) are deliberately not merged, because each accepts a different input language.
