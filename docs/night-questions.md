# Night questions

## Task 104: "today" in plan-inputs and the run-chat AI clock tool
`/api/academy/plan-inputs` (the `weeksToRace` countdown) and the run-chat AI's "what is the date" tool used the server's UTC date. Between 00:00 and 03:00 Israel time that date is still yesterday. PR 104's second commit switches both to `israelToday()`. That changes behaviour: during that window the countdown and the AI's answer move to Israel's date. Should both follow Israel's calendar?
Safe default chosen: yes, Israel's date, as `israelToday()` already does everywhere else. The change is a separate commit, so it can be reverted alone.
