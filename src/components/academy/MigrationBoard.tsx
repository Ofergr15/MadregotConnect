'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { waShareUrl } from '@/lib/academy/manage';
import { MIGRATION_STEPS, type MigrationStep } from '@/lib/academy/migration';
import type { MigrationBoardRow } from '@/lib/academy/migration-server';
import { BarButton, CARD, FlowOverlay, FlowScreen, initials } from './book/ui';
import { Avatar, sendJson } from './completion/shared';

// "מעבר האקדמיה" (migration plan, screen A): everybody moving in from the academy that existed
// before the app, and how far each has got — moved · signed in · watch · test · 4 questions ·
// first week. The stuck first. A reminder for the stuck in one tap (their own step each), the
// invite link again on WhatsApp for whoever has not opened it. The move is over when every row
// has a first week.

interface Board { rows: MigrationBoardRow[]; summary: { done: number; onTheWay: number; stuck: number } }

const STEP_LABEL: Record<MigrationStep, string> = {
  moved: 'הועבר', joined: 'נכנס', watch: 'שעון', test: 'טסט', questions: '4 שאלות', firstWeek: 'שבוע ראשון',
};

function where(r: MigrationBoardRow): { text: string; tone: 'ok' | 'info' | 'warn' | 'mute' } {
  if (r.step === 'done') return { text: 'עם שבוע ראשון ✓', tone: 'ok' };
  if (r.step === 'joined') return { text: 'הוזמן · עוד לא נכנס', tone: r.stuck ? 'warn' : 'mute' };
  if (r.step === 'watch') return { text: 'לא חיבר שעון', tone: r.stuck ? 'warn' : 'mute' };
  if (r.step === 'test') return r.owner === 'coach' ? { text: 'טסט מחכה לאישור המאמן', tone: 'info' } : { text: 'אין עדיין טסט', tone: r.stuck ? 'warn' : 'mute' };
  if (r.step === 'questions') return { text: 'לא ענה על 4 השאלות', tone: r.stuck ? 'warn' : 'mute' };
  return { text: 'מוכן · המאמן בונה שבוע ראשון', tone: 'info' };
}

function Track({ at }: { at: number }) {
  return (
    <div className="mt-2 flex gap-1" aria-hidden>
      {MIGRATION_STEPS.map((s, k) => (
        <span key={s} className={cn('h-1.5 flex-1 rounded-full', k < at ? 'bg-accent-600' : k === at ? 'bg-brand-600' : 'bg-page')} />
      ))}
    </div>
  );
}

export function MigrationBoard({ onClose, onSelect }: { onClose: () => void; onSelect: (athleteId: string) => void }) {
  const { data, error, mutate } = useApi<Board>('/api/academy/migration');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const s = data?.summary;
  const stuckInApp = (data?.rows ?? []).filter((r) => r.stuck && ['watch', 'test', 'questions'].includes(r.step));

  const remind = async () => {
    setBusy(true);
    try {
      const r = await sendJson<{ reminded: number }>('POST', '/api/academy/migration/remind', {});
      setSent(r.reminded);
      await mutate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowOverlay label="מעבר האקדמיה">
      <FlowScreen title="מעבר האקדמיה" leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}>
        <p className="px-1 text-[13px] leading-relaxed text-ink-400">מי שהתאמן אצלנו לפני האפליקציה, ואיפה כל אחד עומד. המעבר נגמר כשלכולם יש שבוע ראשון.</p>
        {!data && !error && <div className="h-[120px] animate-pulse rounded-[22px] bg-white/70" aria-busy="true" />}
        {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">לא הצלחנו לטעון</p>}

        {s && (
          <div className="grid grid-cols-3 gap-2">
            {[['עם שבוע ראשון', s.done, false], ['בדרך', s.onTheWay, false], ['תקועים', s.stuck, true]].map(([label, n, warn]) => (
              <div key={label as string} className={cn('rounded-[18px] p-3 text-center', warn && (n as number) > 0 ? 'bg-band-3/10' : CARD)}>
                <p className={cn('text-[24px] font-black tabular-nums', warn && (n as number) > 0 ? 'text-band-3-ink' : 'text-ink-900')}>{n as number}</p>
                <p className={cn('text-[11px] font-bold', warn && (n as number) > 0 ? 'text-band-3-ink' : 'text-ink-400')}>{label as string}</p>
              </div>
            ))}
          </div>
        )}

        {data && data.rows.length === 0 && (
          <p className={cn(CARD, 'px-4 py-5 text-center text-sm text-ink-400')}>עוד אף אחד לא הועבר. מעבירים מ״הוספה לאקדמיה ← כבר מתאמנים״.</p>
        )}

        {data && data.rows.length > 0 && (
          <>
            <div className="flex justify-between px-1 text-[10.5px] font-bold text-ink-400">
              {MIGRATION_STEPS.map((st) => <span key={st}>{STEP_LABEL[st]}</span>)}
            </div>
            <div className={cn(CARD, 'overflow-hidden divide-y divide-[#EFEFF4]')}>
              {data.rows.map((r) => {
                const w = where(r);
                const firstName = (r.name || '').trim().split(/\s+/)[0];
                return (
                  <div key={r.athleteId} className="px-4 py-3">
                    <button type="button" onClick={() => onSelect(r.athleteId)} className="flex w-full items-center gap-3 text-start">
                      <Avatar text={initials(r.name)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold text-ink-900" dir="auto">{r.name}</span>
                          {r.step !== 'done' && r.daysSinceMove != null && r.owner === 'trainee' && (
                            <span className={cn('shrink-0 text-[11px] font-bold', r.stuck ? 'text-band-3-ink' : 'text-ink-400')}>{r.daysSinceMove} ימים</span>
                          )}
                        </span>
                        <span className={cn('mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                          w.tone === 'ok' ? 'bg-accent-600/10 text-accent-900' : w.tone === 'info' ? 'bg-band-2/15 text-band-2-ink' : w.tone === 'warn' ? 'bg-band-3/10 text-band-3-ink' : 'bg-page text-ink-500')}>
                          {w.text}
                        </span>
                      </span>
                      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                    </button>
                    <Track at={r.at} />
                    {r.inviteUrl && (
                      <a href={waShareUrl(r.phone, `היי ${firstName} 👋 תזכורת קטנה: האקדמיה של מדרגות עוברת לאפליקציה. כניסה בלחיצה, בלי טופס: ${r.inviteUrl}${r.email ? `\n(ההתחברות עם ${r.email})` : ''}`)}
                        target="_blank" rel="noopener noreferrer"
                        className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-pill bg-[#1FA55B]/10 px-3 text-[12.5px] font-extrabold text-[#137A41]">
                        <MessageCircle className="h-4 w-4" />לשלוח שוב את הקישור
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => void remind()} disabled={busy || stuckInApp.length === 0}
              className="flex w-full min-h-[50px] items-center justify-center rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-50">
              {sent != null ? `נשלחה תזכורת ל־${sent}` : stuckInApp.length === 1 ? `להזכיר ל${(stuckInApp[0].name || '').trim().split(/\s+/)[0]}` : stuckInApp.length ? `להזכיר ל־${stuckInApp.length} התקועים` : 'אין תקועים באפליקציה'}
            </button>
            <p className="px-1 text-[12px] leading-relaxed text-ink-400">התזכורת לכל אחד היא על הצעד שלו: לחבר שעון, הטסט, או 4 השאלות. מי שעוד לא נכנס — בוואטסאפ, מהשורה שלו.</p>
          </>
        )}
      </FlowScreen>
    </FlowOverlay>
  );
}
