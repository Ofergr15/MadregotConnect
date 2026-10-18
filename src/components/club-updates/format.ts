const TZ = 'Asia/Jerusalem';
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** 08:41 in Israel. */
export const clock = (at: string) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

/** The Israeli calendar day of a moment, YYYY-MM-DD. */
export const dayOf = (at: string) => new Date(at).toLocaleDateString('en-CA', { timeZone: TZ });

/** "היום · ראשון 18.10" / "אתמול · שבת 17.10" / "חמישי 15.10". */
export function dayLabel(day: string, today: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - d.getTime()) / 86_400_000);
  return diff === 0 ? `היום · ${base}` : diff === 1 ? `אתמול · ${base}` : base;
}
