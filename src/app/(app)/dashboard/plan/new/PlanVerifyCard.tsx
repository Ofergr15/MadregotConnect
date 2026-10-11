'use client';

// "בדיקה מול הקובץ" on the plan screen: the saved week checked against its own
// program PDF, number by number, per day and pace group (lib/plans/verify). A
// day is proven, an approximation (a range saved as one value, minutes only in
// a note, a pace the parse filled in), or different. Advisory for now — it
// reports and does not block publishing. Design:
// ~/.cache/madregot/planner-flow/v3.html.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import type { DayResult, Diff, Group, Level, VerifyReport } from '@/lib/plans/verify/compare';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const LEVEL: Record<Level, { label: string; dot: string; chip: string }> = {
  proven: { label: 'מוכח', dot: 'bg-[#16a34a]', chip: 'bg-[#16a34a]/10 text-[#14532d]' },
  approx: { label: 'קירוב', dot: 'bg-[#f59e0b]', chip: 'bg-[#f59e0b]/15 text-[#78350f]' },
  differs: { label: 'שונה', dot: 'bg-accent-red', chip: 'bg-accent-red/10 text-accent-red-ink' },
  unchecked: { label: 'לא נבדק', dot: 'bg-ink-300', chip: 'bg-page text-ink-500' },
};
const KIND: Record<Diff['kind'], string> = {
  note: 'רק בהערה: השעון לא יספור ולא יתריע',
  approx: 'טווח בקובץ, ערך אחד בתוכנית',
  inferred: 'התוכנית השלימה ערך שלא כתוב בקובץ',
  missing: 'בקובץ, ולא בתוכנית',
  extra: 'בתוכנית, ולא בקובץ',
  changed: 'שונה מהקובץ',
};

interface Data { report: VerifyReport; planSavedAt: string }

function dayLine(d: DayResult): string {
  if (d.level === 'unchecked') return d.reason === 'no_text_layer' ? 'בקובץ אין שכבת טקסט — צריך לבדוק ידנית' : 'היום לא נמצא בקובץ';
  const g = d.groups[1];
  if (d.level === 'proven') return `${g.matched} מתוך ${g.total} מספרים · ${d.pages.length > 1 ? `עמודים ${d.pages.join('–')}` : `עמוד ${d.pages[0]}`}`;
  return KIND[g.diffs[0]?.kind ?? 'changed'];
}

/** The diffs of one day, once if all three groups agree, per group otherwise. */
function DayDiffs({ d }: { d: DayResult }) {
  const sig = (g: Group) => JSON.stringify(d.groups[g].diffs.map((x) => [x.kind, x.plan, x.file.map((f) => f.text)]));
  const allSame = sig(1) === sig(2) && sig(2) === sig(3);
  const groups: Group[] = allSame ? [1] : [1, 2, 3];
  return (
    <div className="mt-2 space-y-2">
      {groups.map((g) => d.groups[g].diffs.length > 0 && (
        <div key={g} className="space-y-1.5">
          {!allSame && <p className="text-2xs font-bold text-ink-500">דבוקה {g}</p>}
          {d.groups[g].diffs.map((x, i) => (
            <div key={i} className="rounded-xl bg-page px-3 py-2">
              <p className="text-2xs font-bold text-ink-500">{KIND[x.kind]}</p>
              {x.file.length > 0 && (
                <p className="mt-0.5 text-13 text-ink-700" dir="auto"><span className="font-bold">בקובץ: </span>{x.file.map((f) => f.text).join(' · ')}</p>
              )}
              <p className="text-13 text-ink-700" dir="auto"><span className="font-bold">בתוכנית: </span>{x.plan}</p>
            </div>
          ))}
        </div>
      ))}
      {allSame && <p className="text-2xs text-ink-400">אותו דבר בכל שלוש הדבוקות</p>}
    </div>
  );
}

export function PlanVerifyCard({ week, enabled, version }: { week: string; enabled: boolean; version: unknown }) {
  const { data, error, isLoading } = useApi<Data>(enabled ? `/api/plans/verify?week=${week}&v=${encodeURIComponent(String(version))}` : null, { revalidateOnFocus: false });
  const [open, setOpen] = useState<number | null>(null);
  if (!enabled) return null;
  if (error) {
    // 404: no program PDF for the week (typed in by hand) or no saved plan — nothing to check.
    if ((error as { status?: number }).status === 404) return null;
    return <div className="mb-4 rounded-2xl bg-card p-3 text-xs text-ink-500 shadow-sm">לא הצלחתי לבדוק מול הקובץ כרגע.</div>;
  }
  if (isLoading || !data) {
    return <div className="mb-4 rounded-2xl bg-card p-3 text-xs text-ink-500 shadow-sm">בודק את התוכנית מול הקובץ…</div>;
  }
  const days = data.report.days;
  const count = (l: Level) => days.filter((d) => d.level === l).length;
  const proven = count('proven'), approx = count('approx'), differs = count('differs'), unchecked = count('unchecked');

  return (
    <div className="mb-4 rounded-2xl bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-ink-700">🔎 בדיקה מול הקובץ</h3>
        <span className="text-2xs text-ink-400">ניסיוני · לא חוסם פרסום</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        כל מספר בתוכנית מול הקובץ עצמו, בלי בינה מלאכותית. ירוק = זהה לקובץ, אין מה לבדוק.
      </p>
      <div className="mt-2 flex h-2 gap-[3px] overflow-hidden rounded-full" aria-hidden>
        {proven > 0 && <span className="rounded-full bg-[#16a34a]" style={{ flex: proven }} />}
        {approx > 0 && <span className="rounded-full bg-[#f59e0b]" style={{ flex: approx }} />}
        {differs > 0 && <span className="rounded-full bg-accent-red" style={{ flex: differs }} />}
        {unchecked > 0 && <span className="rounded-full bg-ink-300" style={{ flex: unchecked }} />}
      </div>
      <p className="mt-1.5 text-2xs font-bold text-ink-500">
        {proven} מוכחים{approx ? ` · ${approx} קירוב` : ''}{differs ? ` · ${differs} שונים` : ''}{unchecked ? ` · ${unchecked} לא נבדקו` : ''}
      </p>

      <ul className="mt-2 divide-y divide-page">
        {days.map((d) => {
          const lv = LEVEL[d.level];
          const canOpen = d.level !== 'proven' && d.level !== 'unchecked';
          return (
            <li key={d.dayOfWeek}>
              <button
                type="button"
                onClick={() => canOpen && setOpen(open === d.dayOfWeek ? null : d.dayOfWeek)}
                aria-expanded={canOpen ? open === d.dayOfWeek : undefined}
                className={cn('flex min-h-[48px] w-full items-center gap-2.5 py-1.5 text-start', !canOpen && 'cursor-default')}
              >
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-black text-white', lv.dot)}>{SHORT[d.dayOfWeek]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-13 font-bold text-ink-700">{DAYS[d.dayOfWeek]}</span>
                  <span className="block truncate text-2xs text-ink-500">{dayLine(d)}</span>
                </span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-extrabold', lv.chip)}>{lv.label}</span>
              </button>
              {open === d.dayOfWeek && <div className="pb-2"><DayDiffs d={d} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
