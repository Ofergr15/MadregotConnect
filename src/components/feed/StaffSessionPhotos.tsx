'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui';

// ═════════════════════════════════════════════════════════════════════════════
// THE SESSION'S PHOTOS, FOR STAFF (mockup session-photos-control, 1 and 3)
//
// On a quality day, from 07:00, at the top of a staff member's feed only: the folder
// the evening-before automation made, when it was last checked (every quarter of an
// hour) and what it found. Nothing reaches the club by itself any more: here an
// editor publishes, and chooses how the club hears (push, in the app only, quietly),
// to whom, and whether the Madregot circle says it too. Photos added after publishing
// show as "N חדשות" and are added the same way, without telling anyone again.
// ═════════════════════════════════════════════════════════════════════════════

interface Status {
  date: string; name: string; workout: string | null; link: string; auto: boolean;
  checkedAt: string | null; nextAt: string | null; found: number; previews: string[];
  published: number; publishedId: string | null;
}

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }) : '');
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'עכשיו' : `לפני ${m} דק׳`;
};
const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return `${['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
};

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="mt-1.5 flex rounded-[11px] bg-[#EFEFF4] p-[2px]" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cn('min-h-[34px] flex-1 rounded-[9px] text-12 font-bold', value === v ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>{l}</button>
      ))}
    </div>
  );
}

export function StaffSessionPhotos({ enabled }: { enabled: boolean }) {
  const { data, mutate } = useApi<{ status: Status | null }>(enabled ? '/api/quality-session/photos/status' : null, { refreshInterval: 60_000 });
  const [toAll, setToAll] = useState(true);
  const [notify, setNotify] = useState<'push' | 'inapp' | 'quiet'>('push');
  const [audience, setAudience] = useState<'all' | 'attendees'>('all');
  const [circle, setCircle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = data?.status;
  if (!enabled || !s) return null;

  const fresh = Math.max(0, s.found - s.published);
  const waiting = s.found === 0;
  const subline = [dayLabel(s.date), s.workout].filter(Boolean).join(' · ');

  const publish = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/quality-session/photos/approve', {
        method: 'POST', headers: await bearerHeaders(),
        body: JSON.stringify({ date: s.date, notify: toAll ? notify : 'quiet', audience, circle }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'failed');
      setMsg(s.published ? 'נוספו לכרטיס' : out.told > 0 ? `פורסם · נשלח ל־${out.told}` : 'פורסם');
      await mutate();
    } catch { setMsg('לא הצליח. אפשר לנסות שוב.'); } finally { setBusy(false); }
  };
  const setAuto = async (on: boolean) => {
    await fetch('/api/quality-session/photos/status', { method: 'PATCH', headers: await bearerHeaders(), body: JSON.stringify({ date: s.date, auto: on }) });
    await mutate();
  };

  return (
    <section className="mb-4" dir="rtl">
    {/* Its own title: the second, separate staff card under "שיתוף הדבוקות" (mockups/post-session/v2). */}
    <h2 className="mb-1.5 px-1 text-[13px] font-extrabold text-ink-500">תמונות מהאימון</h2>
    <div className="rounded-[22px] border-[1.5px] border-dashed border-[#9AA0FF] bg-card p-3.5">
      <span className="inline-block rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-extrabold text-brand-600">רק לצוות</span>
      <div className="mt-2 flex items-center gap-2.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF0E0] text-xl">📸</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] text-ink-900">התמונות מאימון האיכות</b>
          <small className="block truncate text-12 text-ink-500">{subline}</small>
        </span>
        {fresh > 0 && <span className="shrink-0 rounded-full bg-[#E3F6EA] px-2.5 py-1 text-12 font-extrabold text-[#12A150]">{fresh} חדשות</span>}
      </div>

      {waiting ? (
        <div className="mt-3 rounded-2xl bg-page px-3 py-2.5 text-13 leading-relaxed text-ink-500">
          <span className="me-1.5 inline-block h-2 w-2 rounded-full bg-[#F5B83D]" />
          התמונות עוד לא עלו — התיקייה מוכנה.{s.checkedAt && <> נבדק {ago(s.checkedAt)}, הבדיקה הבאה ב־{clock(s.nextAt)}.</>}
          <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-1 block font-extrabold text-brand-600">לפתוח את התיקייה בדרייב ‹</a>
        </div>
      ) : (
        <>
          {s.previews.length > 0 && (
            <div className="mt-3 grid h-[150px] grid-cols-[2fr_1fr] grid-rows-2 gap-1 overflow-hidden rounded-2xl">
              {s.previews.slice(0, 3).map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="" referrerPolicy="no-referrer" className={cn('h-full w-full object-cover', i === 0 && 'row-span-2')} />
              ))}
            </div>
          )}
          <p className="mt-2 text-12 text-ink-400">
            {s.found} תמונות בתיקייה{s.published ? ` · ${s.published} כבר בפיד` : ''}{s.checkedAt ? ` · נבדק ${ago(s.checkedAt)}` : ''}
          </p>

          {fresh > 0 && !s.published && (
            <>
              <div className="mt-2 flex items-center justify-between border-t border-page pt-2.5">
                <span><b className="block text-[14px] text-ink-900">לפרסם לכל המועדון</b><small className="text-12 text-ink-400">בראש הפיד, עם לייקים ותגובות</small></span>
                <Switch checked={toAll} onChange={setToAll} activeColor="bg-[#1FA55B]" ariaLabel="לפרסם לכל המועדון" />
              </div>
              {toAll && (
                <>
                  <div className="mt-2 border-t border-page pt-2.5">
                    <b className="block text-[14px] text-ink-900">להודיע</b>
                    <Seg value={notify} options={[['push', 'פוש לטלפון'], ['inapp', 'רק באפליקציה'], ['quiet', 'בשקט']]} onChange={setNotify} />
                  </div>
                  {notify !== 'quiet' && (
                    <div className="mt-2 border-t border-page pt-2.5">
                      <b className="block text-[14px] text-ink-900">למי</b>
                      <Seg value={audience} options={[['all', 'כולם'], ['attendees', 'מי שסימן שמגיע']]} onChange={setAudience} />
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-page pt-2.5">
                    <span><b className="block text-[14px] text-ink-900">גם בעיגול מדרגות</b><small className="text-12 text-ink-400">״התמונות עלו״, להיום</small></span>
                    <Switch checked={circle} onChange={setCircle} activeColor="bg-[#1FA55B]" ariaLabel="גם בעיגול מדרגות" />
                  </div>
                </>
              )}
            </>
          )}

          {fresh > 0 && (toAll || s.published) && (
            <button type="button" disabled={busy} onClick={publish}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-[15px] bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-50">
              {busy ? '…' : s.published ? `להוסיף ${fresh} לכרטיס` : `לפרסם ${Math.min(s.found, 6)} תמונות`}
            </button>
          )}
          {s.published > 0 && fresh === 0 && <p className="mt-2 text-13 font-bold text-[#12A150]">✓ בפיד של כולם</p>}
          <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-1 block py-2 text-center text-13 font-extrabold text-brand-600">לפתוח את התיקייה בדרייב</a>
        </>
      )}

      <div className="mt-1 flex items-center justify-between border-t border-page pt-2.5">
        <span><b className="block text-13 text-ink-900">לפרסם לבד</b><small className="text-12 text-ink-400">בלי לאשר, כמו פעם, עם פוש לכולם</small></span>
        <Switch checked={s.auto} onChange={(v) => void setAuto(v)} activeColor="bg-[#1FA55B]" ariaLabel="לפרסם לבד" />
      </div>
      {msg && <p role="status" className="mt-2 text-center text-13 font-bold text-ink-700">{msg}</p>}
    </div>
    </section>
  );
}
