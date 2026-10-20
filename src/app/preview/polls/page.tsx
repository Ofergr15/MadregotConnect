'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { CloseSetting, DEFAULT_REMINDERS, ReminderSetting, SurveyTemplates, type CloseKind, type RemindersValue } from '@/components/publish/SurveySettings';
import { SurveyResultsView, type SurveyResultsData } from '@/components/content/SurveyResults';
import { israelLocalToIso } from '@/lib/survey-reminders';

// The poll screens on fixed data, for screenshots (mockup polls-proposal, 10-20): the publish
// screen's new settings and the staff results. Development only.

const at = (d: string, t: string) => israelLocalToIso(d, t)!;
const RESULTS: SurveyResultsData = {
  survey: { id: 'x', question: 'ערב סוף עונה — איזה ערב מתאים לכם?', closesAt: at('2026-10-29', '20:00'), createdAt: at('2026-10-20', '18:00'), open: true, audience: 'all', pack: null, multi: false, anonymous: false, postId: 'p' },
  asked: 27, answered: 12,
  options: [
    { option: 'חמישי 6.11', people: [{ id: '1', name: 'Sahar Azar' }, { id: '2', name: 'Ben Sitbon' }, { id: '3', name: 'Asaf Elkeslassy' }, { id: '4', name: 'Ofer Grosfeld' }, { id: '5', name: 'Tarkin Adgo' }, { id: '6', name: 'Roy Roth' }] },
    { option: 'שבת 8.11', people: [{ id: '7', name: 'Amit Lazar' }, { id: '8', name: 'Ido Bar-On' }, { id: '9', name: 'נתנאל וינר' }] },
    { option: 'חמישי 13.11', people: [{ id: '10', name: 'Eyal Shlomi' }, { id: '11', name: 'Yair Gabbay' }] },
    { option: 'לא אוכל להגיע', people: [{ id: '12', name: 'Itai Spiegel' }] },
  ],
  waiting: [
    { pack: '1 · SUB 2:30', people: [{ id: 'a', name: 'Eli Soffer', push: true }, { id: 'b', name: 'Shalev Bahalul', push: true }] },
    { pack: '2 · SUB 2:35', people: [{ id: 'c', name: 'Chen Becher', push: false }, { id: 'd', name: 'Alon Lifshitz', push: true }, { id: 'e', name: 'Yosi Sabag', push: true }] },
    { pack: null, people: [{ id: 'f', name: 'Ori Sade', push: false }, { id: 'g', name: 'Shira Eldar', push: true }] },
  ],
  push: { status: 'sent', sent: 22, at: at('2026-10-20', '18:00') },
  reminders: [
    { id: 'r1', at: at('2026-10-22', '20:00'), state: 'sent', sent: 19, after: 4 },
    { id: 'r2', at: at('2026-10-28', '20:00'), state: 'scheduled', sent: 0, after: null },
    { id: 'r3', at: at('2026-10-29', '19:00'), state: 'scheduled', sent: 0, after: null },
  ],
};

export default function PollsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [close, setClose] = useState<{ kind: CloseKind; date: string; time: string }>({ kind: 'date', date: '2026-10-29', time: '20:00' });
  const [rem, setRem] = useState<RemindersValue>(DEFAULT_REMINDERS);
  const closesAt = close.kind === 'none' ? null : israelLocalToIso(close.date, close.time);
  return (
    <div className="flex flex-wrap items-start gap-6 bg-page p-6" dir="rtl">
      <div data-shot="publish" className="w-[390px] space-y-3">
        <SurveyTemplates onPick={() => {}} />
        <CloseSetting kind={close.kind} date={close.date} time={close.time} onChange={setClose} />
        <ReminderSetting closesAt={closesAt} value={rem} onChange={setRem} />
      </div>
      <div data-shot="results" className="w-[390px]">
        <SurveyResultsView data={RESULTS} busy={null} note={null} confirmClose={false} onAskClose={() => {}} onRemind={() => {}} onClose={() => {}} onCopy={() => {}} />
      </div>
    </div>
  );
}
