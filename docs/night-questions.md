# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 90 — club records podium (GET /api/club/records/podium)

- **Tie rule.** Safe default shipped: equal whole-second times share a place using competition ranking (1, 1, 3). Within a tie, the earlier date is listed first. Everyone tied for third is on the podium, so it can hold more than three names. Open: should a tie be broken instead (first to run it wins outright)?
- **Implausible manual entries** (outside the same per-distance bounds the entry form uses) are left off the podium and counted in `excluded`, not shown with a flag. Open: show them to staff with a warning instead?
- **Pace-hiding and opted-out runners** never appear on the podium, the same as the records table. The podium is the first three lines of that table.
