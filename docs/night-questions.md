# Night questions

## Task 106: coach-space Insights pack colours
On the coach-space "Insights" charts, packs A/B/C had their own palette: A orange #C2410C, B blue #1525FF, C green #0B6E4F. That is the reverse of the club's group colours (group 1 green, group 2 sky blue, group 3 orange). The charts now use `GROUP_HEX` from resolveGroup, so A is green, B is sky blue and C is orange, matching every other screen. This is the one visible change in this PR.
Safe default chosen: follow CLAUDE.md, where group colours come only from resolveGroup. To restore the old palette, revert `src/components/coach-space/Insights.tsx`.
