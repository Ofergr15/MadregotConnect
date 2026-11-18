'use client';

import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { ThreadTranscript, type ThreadMessage } from '@/components/academy/ThreadTranscript';
import { ChatAvatar, ChatList, type ChatPayload } from '@/components/academy/ChatList';
import { useSearchParams } from 'next/navigation';
import type { ChatRow } from '@/lib/academy/chat-list';
import { STAFF_QUICK, STAFF_TRANSCRIPT_CLASS, StaffThreadScreen } from '@/components/academy/AcademyThreadPanel';
import { useOpenThread } from '@/components/academy/AcademyThreads';

// ── Login-free preview of the chat thread (mockup academy-chat/chat.html, 2) ──
// The live thread needs Stream; this renders the same transcript with a fixture.
// Development only. In production the route does not exist.

const T = (d: string, hm: string) => `${d}T${hm}:00+03:00`;
const MESSAGES: ThreadMessage[] = [
  { id: '1', authorId: 'coach-1', authorName: 'מירב', seat: 'coach', text: 'מעולה, ממשיכים ככה בשבוע הבא 💪', at: T('2026-10-19', '19:02') },
  { id: '2', authorId: 'noa', authorName: 'נועה לוי', seat: 'trainee', text: 'תודה!! הרגשתי טוב השבוע', at: T('2026-10-19', '20:15') },
  { id: '3', authorId: 'noa', authorName: 'נועה לוי', seat: 'trainee', text: 'הברך שוב כואבת אחרי האינטרוולים', at: T('2026-10-20', '08:11') },
  { id: '4', authorId: 'noa', authorName: 'נועה לוי', seat: 'trainee', text: 'לרוץ מחר את הקל או לנוח?', at: T('2026-10-20', '08:12') },
  { id: '5', authorId: 'mgr', authorName: 'עופר', seat: 'manager', text: 'נועה, תעדכני אחרי הבדיקה', at: T('2026-10-20', '08:15') },
  { id: '6', authorId: 'coach-1', authorName: 'מירב', seat: 'coach', text: 'איפה בדיוק כואב, מבפנים או מבחוץ?', at: T('2026-10-20', '08:20') },
];

const ME = 'coach-1';
const R = (o: Partial<ChatRow> & { athleteId: string; name: string }): ChatRow => ({
  lastTraineeMessageAt: null, lastStaffMessageAt: null, unreadCount: 0, reason: 'quiet', waitingHours: null,
  quietDays: null, urgency: 0, lastAt: null, lastAuthorId: null, lastText: null, coachNames: ['מירב'], mine: true, ...o,
});
const LIST: ChatPayload = {
  viewerId: ME, viewerGender: 'female',
  rows: [
    R({ athleteId: 'a1', name: 'אורי כהן', reason: 'awaiting_reply', lastAt: T('2026-10-19', '07:30'), lastText: 'השעון לא סנכרן את הריצה', unreadCount: 1 }),
    R({ athleteId: 'n1', name: 'נועה לוי', reason: 'awaiting_reply', lastAt: T('2026-10-20', '08:12'), lastText: 'הברך שוב כואבת אחרי האינטרוולים, לרוץ מחר?', unreadCount: 2 }),
    R({ athleteId: 'd1', name: 'דנה ברק', lastAt: T('2026-10-20', '10:40'), lastText: 'מעולה, ממשיכים ככה בשבוע הבא 💪', lastAuthorId: ME, seenByTrainee: true }),
    R({ athleteId: 'y1', name: 'יובל שרון', lastAt: T('2026-10-19', '09:00'), lastAuthorId: ME }),
    R({ athleteId: 's1', name: 'שחר אבני', reason: 'unread', lastAt: T('2026-10-18', '18:00'), lastText: 'תודה! ראיתי את התוכנית', unreadCount: 1, mine: false }),
    R({ athleteId: 'r1', name: 'רוני גל', reason: 'silent', quietDays: 9, lastAt: T('2026-10-11', '08:00'), lastText: 'איך הרגיש הטסט?', lastAuthorId: ME }),
    R({ athleteId: 'm1', name: 'מאיה פרץ', reason: 'silent', mine: false }),
    R({ athleteId: 'i1', name: 'עידו נחום', reason: 'silent' }),
  ],
};

/** 55 messages over a week, for the long-thread check (brief 1.4). */
const LONG: ThreadMessage[] = Array.from({ length: 55 }, (_, i) => ({
  id: `l${i}`,
  authorId: i % 3 ? 'noa' : 'coach-1',
  authorName: i % 3 ? 'נועה לוי' : 'מירב',
  seat: i % 3 ? 'trainee' : 'coach',
  text: i % 4 ? `הודעה מספר ${i + 1}` : `הודעה ארוכה יותר מספר ${i + 1}, כדי שהבועה תשבור שורה ותראה כמו שיחה אמיתית`,
  at: T(`2026-10-${String(14 + Math.floor(i / 8)).padStart(2, '0')}`, `${String(8 + (i % 8)).padStart(2, '0')}:0${i % 10}`),
}) as ThreadMessage);

/**
 * The staff chat screen as the live one draws it: inbox row → full-screen thread, the
 * same shell, class and back handling as AcademyThreads / AcademyThreadPanel, with the
 * fixture in place of Stream. `?screen=staff` (2 messages) or `?screen=staff&long=1`.
 */
function StaffPreview({ long }: { long: boolean }) {
  const { openId, open, onBack } = useOpenThread(null);
  if (!openId) {
    return (
      <div className="mx-auto max-w-[430px] p-4" dir="rtl">
        <button type="button" data-testid="open-thread" onClick={() => open('noa')} className="min-h-[44px] w-full rounded-xl bg-white px-4 text-start">נועה לוי</button>
      </div>
    );
  }
  return (
    <StaffThreadScreen name="נועה לוי" athleteId="noa" onBack={onBack}>
      <ThreadTranscript messages={long ? LONG : MESSAGES.slice(0, 2)} viewerSeat="coach" viewerId="coach-1"
        onSend={() => {}} quickReplies={STAFF_QUICK} layout="sheet" className={STAFF_TRANSCRIPT_CLASS} />
    </StaffThreadScreen>
  );
}

/** The trainee's conversation sheet (TraineeBoard), 88dvh from the bottom. `?screen=trainee`. */
function TraineePreview() {
  return (
    <div className="fixed inset-x-0 bottom-0 flex h-[88dvh] flex-col rounded-t-[20px] bg-white" dir="rtl" data-testid="trainee-sheet">
      <div className="shrink-0 p-3 text-center font-bold">השרשור שלי</div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-3">
        <ThreadTranscript messages={MESSAGES} viewerSeat="trainee" viewerId="noa" onSend={() => {}} layout="sheet" className="min-h-0 flex-1" />
      </div>
    </div>
  );
}

export default function Page() {
  const params = useSearchParams();
  const screen = params.get('screen');
  if (process.env.NODE_ENV === 'production') notFound();
  if (screen === 'staff') return <StaffPreview long={params.get('long') === '1'} />;
  if (screen === 'trainee') return <TraineePreview />;
  if (screen === 'list') return <div className="mx-auto max-w-[430px] p-4"><ChatList data={LIST} /></div>;
  return (
    <div className="mx-auto max-w-[430px] p-4" dir="rtl">
      <div className="-mx-1 mb-2 flex items-center gap-2.5 border-b border-page pb-2">
        <span className="grid h-11 w-11 place-items-center text-brand-600"><ChevronRight className="h-6 w-6" /></span>
        <ChatAvatar row={{ athleteId: 'noa', name: 'נועה לוי' }} size={38} />
        <b className="flex-1 text-[16px] text-ink-900">נועה לוי</b>
      </div>
      <ThreadTranscript messages={MESSAGES} viewerSeat="coach" viewerId="coach-1" seenAt={T('2026-10-20', '08:25')}
        onSend={() => {}} quickReplies={['איך הרגיש האימון?', 'ראיתי את הריצה 👏', 'מעולה, ממשיכים ככה 💪', 'בוא נדבר על השבוע']} />
    </div>
  );
}
