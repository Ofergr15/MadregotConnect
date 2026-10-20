'use client';

import { CalendarDays, ClipboardList, Sun, MessageCircle, CheckSquare, BarChart3, History, BookOpen } from 'lucide-react';
import { useApi } from '@/lib/api';
import { InsetRow, InsetSection } from '@/components/ui';

// ═════════════════════════════════════════════════════════════════════════════
// אימונים — the admin's training tab (2026-10-20, mockups/admin-ia.html): the week's
// work in one place, by what you do — this week (build and publish, open the week,
// tomorrow's text) and follow-up (feedback, attendance, volume, past plans). Each
// row opens the existing screen; nothing here is a second copy of one. A count
// shows only on what waits for you.
// ═════════════════════════════════════════════════════════════════════════════

interface Attention { pain: number; wantsReply: number; people: number; total: number }

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="rounded-full bg-accent-red px-2 text-[13px] font-bold leading-[20px] text-white tabular-nums">{n}</span> : null;
}

export default function TrainingPage() {
  const { data: att } = useApi<Attention>('/api/staff/attention');
  const waiting = att ? att.pain + att.wantsReply : 0;
  return (
    <div className="pb-8" dir="rtl">
      <h1 className="px-1 pb-4 text-[32px] font-black tracking-tight text-ink-700">אימונים</h1>
      <InsetSection header="השבוע">
        <InsetRow icon={ClipboardList} iconBg="bg-brand-600" label="בניית התוכנית ופרסום" sublabel="מדביקים כמו שכותבים — ה-AI מסדר, ומפרסמים לאפליקציה ולשעונים בבת אחת" href="/dashboard/plan/new" />
        <InsetRow icon={CalendarDays} iconBg="bg-brand-600" label="פתיחת השבוע" sublabel="האימונים הקבועים, הודעה וסקר — במסך אחד" href="/dashboard/week" />
        <InsetRow icon={Sun} iconBg="bg-[#ff9500]" label="אימון מחר" sublabel="שעה, מקום, ונוסח לוואטסאפ" href="/dashboard/day-session" />
      </InsetSection>
      <InsetSection header="מעקב">
        <InsetRow icon={MessageCircle} iconBg="bg-accent-red" label="משוב אחרי אימון"
          sublabel={att ? (att.pain ? `${att.pain} עם כאב מחכים לך` : waiting ? `${waiting} מחכים לתשובה` : 'אין משוב שמחכה') : ' '}
          href="/dashboard/workout-feedback" trailing={<Count n={waiting} />} />
        <InsetRow icon={CheckSquare} iconBg="bg-accent-900" label="נוכחות" sublabel="מי באמת רץ עם הקבוצה" href="/dashboard/practice-attendance" />
        <InsetRow icon={BarChart3} iconBg="bg-[#5ac8fa]" label="נפח הקבוצה" sublabel="ק״מ שבועי לכל רץ" href="/dashboard/team-volume" />
        <InsetRow icon={History} iconBg="bg-ink-400" label="תוכניות קודמות" sublabel="כל מה שנשלח, ושליחה מחדש" href="/dashboard/history" />
        <InsetRow icon={BookOpen} iconBg="bg-ink-400" label="ספריית האימונים" sublabel="האימונים הקבועים של המועדון" href="/dashboard/practice" />
      </InsetSection>
    </div>
  );
}
