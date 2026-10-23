/** The Saturday this week ends on (today when it is Saturday), as YYYY-MM-DD. */
export function comingSaturday(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
