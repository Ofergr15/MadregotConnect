'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { WeekStory as Story } from '@/lib/week-story/server';
import { fmtDuration, fmtPace, highlightOf, qualityVerdict, weekLabel } from '@/lib/week-story/model';
import { EXPORT_H, EXPORT_W, captureSlide, shareImages } from '@/components/birthday/capture';
import { SLIDE_MS, canRecordVideo, recordStory, shareVideo, videoLength } from '@/components/birthday/video';
import { academyBoardUrl } from '@/lib/academy/deep-links';
import '@/components/birthday/year-story.css';
import './week-story.css';

// "השבוע שלך" — the weekly story (mockup ~/.cache/madregot/weekly-summary/weekly-story.html),
// the birthday story's player with a week's slides: opening, km by day, against the plan,
// a record, the quality session, the pack, the club, and the poster to share. A slide with
// nothing to say this week is left out. Academy trainees get the coach's week and next
// week instead of the pack. Open Saturday 12:00 → Sunday 20:00 (lib/week-story/model.ts).

const DAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MEDAL = ['🥇', '🥈', '🥉'];
const km1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const n = (v: number) => v.toLocaleString('en-US');
const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

interface Slide { key: string; dur: number; node: () => React.ReactNode }

export function WeekStory({ story, onClose }: { story: Story; onClose: () => void }) {
  const router = useRouter();
  const s = story.numbers;
  const label = weekLabel(story.window);
  const hl = highlightOf(s, story.biggestInWeeks);
  const [hidePack, setHidePack] = useState(story.hidePack);
  const [exporting, setExporting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const waitFor = useRef<((n: HTMLDivElement) => void) | null>(null);
  const [video, setVideo] = useState<{ phase: 'prep' | 'rec'; p: number; slide: number } | null>(null);
  const [videoFile, setVideoFile] = useState<Blob | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  const videoRef = useRef<() => Promise<void>>(async () => {});
  const shareOneRef = useRef<() => Promise<void>>(async () => {});
  const [canVideo, setCanVideo] = useState(false);
  useEffect(() => { setCanVideo(canRecordVideo()); }, []);

  const togglePack = useCallback(async () => {
    const next = !hidePack;
    setHidePack(next);
    try {
      const r = await fetch('/api/week-story', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hidePack: next }) });
      if (!r.ok) throw new Error();
      setNotice(next ? 'שקף הדבוקה לא יופיע יותר' : 'שקף הדבוקה חזר');
    } catch { setHidePack(!next); setNotice('לא הצלחנו לשמור'); }
    setTimeout(() => setNotice(null), 2600);
  }, [hidePack]);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const opening = [`${s.runs} ריצות`];
    if (s.planShare != null) opening.push(`${Math.round(s.planShare * 100)}% מהתוכנית`);
    if (s.records.length) opening.push('שיא חדש');
    out.push({ key: 'intro', dur: 4500, node: () => (<>
      <div className="bg plain" />
      <div className="c end">
        <p className="eyebrow-s rise">השבוע שלך · <bdi>{label}</bdi></p>
        <h1 className="rise d1">שבוע טוב,<br /><span className="name">{story.name}</span> 👋</h1>
        <p className="lead rise d2">{opening.join(', ')}.<br />הנה השבוע שלך.</p>
        <p className="hint rise d3">לחיצה שמאלה להמשך ‹</p>
      </div></>) });

    const top = Math.max(...s.dayKm, 1);
    const diff = s.lastWeekKm != null ? s.km - s.lastWeekKm : null;
    out.push({ key: 'km', dur: 5500, node: () => (<>
      <div className="bg plain" />
      <div className="c">
        <p className="k rise">רצת השבוע</p>
        <div className="hero rise d1"><b>{km1(s.km)}</b><u>ק״מ</u></div>
        {diff != null && Math.abs(diff) >= 0.5 && <span className="wk-pill rise d1">{diff > 0 ? '▲' : '▼'} <bdi>{km1(Math.abs(diff))}</bdi> ק״מ {diff > 0 ? 'יותר' : 'פחות'} משבוע שעבר</span>}
        <div className="wk-days rise d2">{s.dayKm.map((k, i) => {
          return (
            <div key={i}>
              <span>{k > 0 ? km1(k) : ''}</span>
              {/* A day without a run is empty — never red, whatever the plan said (Ofer, 10-23:
                  "there's red on the day I didn't run; it should show nothing"). */}
              {k > 0 ? <i style={{ height: `${(k / top) * 100}%` }} /> : <i className="z" />}
              {DAY_LETTER[i]}
            </div>
          );
        })}</div>
        <p className="lead rise d3"><bdi>{s.runs}</bdi> ריצות · <bdi>{fmtDuration(s.seconds)}</bdi> שעות{fmtPace(s.seconds, s.km) && <> · קצב <bdi dir="ltr">{fmtPace(s.seconds, s.km)}</bdi></>}</p>
      </div></>) });

    if (s.planShare != null) {
      const pct = Math.round(Math.min(1, s.planShare) * 100);
      out.push({ key: 'plan', dur: 5000, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="k rise">מול התוכנית</p>
          {s.sessionsPlanned != null && <h2 className="rise d1"><bdi>{s.sessionsDone}</bdi> מתוך <bdi>{s.sessionsPlanned}</bdi> אימונים</h2>}
          <div className="wk-ring rise d1" style={{ ['--p' as string]: `${pct * 3.6}deg` }}><div><b><bdi>{Math.round(s.planShare! * 100)}%</bdi></b><small>מהק״מ שתוכנן</small></div></div>
          {story.missed.some(Boolean) && (
            <div className="wk-list rise d2">{story.missed.map((m, i) => m ? <div key={i} className="li"><b>{WEEKDAYS[i]}</b><span className="r no">פוספס</span></div> : null)}</div>
          )}
        </div></>) });
    }

    if (s.records.length) {
      const r = s.records[0];
      out.push({ key: 'record', dur: 5000, node: () => (<>
        <div className="bg plain warm" />
        <div className="c">
          <p className="eyebrow-s rise">🏅 שיא חדש</p>
          <h2 className="rise d1">{r.label}</h2>
          {r.seconds > 0 && <div className="hero rise d1"><b>{clock(r.seconds)}</b></div>}
          {s.records.length > 1 && <p className="lead rise d2">ועוד {s.records.slice(1).map((x) => x.label).join(', ')}.</p>}
        </div></>) });
    }

    const q = story.quality;
    if (q && q.reps.length) {
      const fast = Math.min(...q.reps, ...q.target), slow = Math.max(...q.reps, ...q.target);
      const h = (p: number) => 35 + (60 * (slow - p)) / Math.max(1, slow - fast);
      out.push({ key: 'quality', dur: 5500, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="eyebrow-s rise">⚡ אימון האיכות · {WEEKDAYS[q.day]}</p>
          <h2 className="rise d1" dir="ltr" style={{ textAlign: 'right' }}>{q.label}</h2>
          {q.target.length > 0 && <p className="lead rise d1">היעד: <bdi dir="ltr">{pace(Math.min(...q.target))}{Math.max(...q.target) !== Math.min(...q.target) ? `–${pace(Math.max(...q.target))}` : ''}</bdi> לק״מ</p>}
          <div className="wk-reps rise d2">{q.reps.map((p, i) => <div key={i}><i><b style={{ height: `${h(p)}%` }} /></i><span>{pace(p)}</span></div>)}</div>
          <span className="wk-pill rise d3">{qualityVerdict(q.vs).ok ? '✓ ' : ''}{qualityVerdict(q.vs).text}</span>
        </div></>) });
    }

    const p = story.pack;
    if (p && !hidePack) {
      const moved = p.lastRank != null ? p.lastRank - p.rank : 0;
      out.push({ key: 'pack', dur: 5500, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="eyebrow-s rise">{p.name ? `${p.name} · ` : ''}השבוע</p>
          <h2 className="rise d1">מקום <bdi>{p.rank}</bdi> {MEDAL[p.rank - 1] ?? ''}</h2>
          {moved !== 0 && <span className="wk-pill rise d1">{moved > 0 ? '▲' : '▼'} <bdi>{Math.abs(moved)}</bdi> {Math.abs(moved) === 1 ? 'מקום' : 'מקומות'} משבוע שעבר</span>}
          <div className="wk-rank rise d2">{p.top.map((r) => (
            <div key={`${r.name}-${r.km}`} className={r.me ? 'rk me' : 'rk'}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.avatarUrl ? <img className="av" src={r.avatarUrl} alt="" /> : <i className="av" />}
              {r.name}<span className="km"><bdi>{km1(r.km)}</bdi></span>
            </div>
          ))}</div>
        </div>
        <button type="button" className="wk-hide" onClick={() => void togglePack()}>לא להציג לי את הדבוקה</button></>) });
    }

    const a = story.academy;
    if (a && (a.comments > 0 || a.score != null)) {
      out.push({ key: 'coach', dur: 5000, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="eyebrow-s rise">💬 מהמאמן השבוע</p>
          <h2 className="rise d1">{a.comments > 0 ? `${a.comments} ${a.comments === 1 ? 'משוב' : 'משובים'}` : 'השבוע שלך בלוח'}</h2>
          {a.score != null && <span className="wk-pill rise d2">ציון לפי התוכנית · <bdi>{a.score}%</bdi></span>}
        </div></>) });
    }
    if (a && a.nextSessions > 0) {
      out.push({ key: 'next', dur: 5000, node: () => (<>
        <div className="bg plain warm" />
        <div className="c end">
          <p className="eyebrow-s rise">🗓️ השבוע הבא כבר מוכן</p>
          <h2 className="rise d1"><bdi>{a.nextSessions}</bdi> אימונים{a.nextKm ? <><br />כ־<bdi>{a.nextKm}</bdi> ק״מ</> : null}</h2>
        </div>
        <button type="button" className="wk-go" onClick={() => { onClose(); router.push(academyBoardUrl()); }}>ללוח של השבוע ‹</button></>) });
    }

    const c = story.club;
    if (c && c.runners > 1) {
      out.push({ key: 'club', dur: 5000, node: () => (<>
        <div className="bg plain" />
        <div className="c end">
          <p className="eyebrow-s rise">כל המדרגות · השבוע</p>
          <h2 className="rise d1">רצנו יחד</h2>
          <div className="wk-club rise d2">
            <div><b><bdi>{n(c.km)}</bdi></b><small>ק״מ</small></div>
            <div><b><bdi>{c.runners}</bdi></b><small>רצים</small></div>
            {c.records > 0 && <div><b><bdi>{c.records}</bdi></b><small>שיאים</small></div>}
            {c.marathons > 0 && <div><b><bdi>{c.marathons}</bdi></b><small>ריצות באורך מרתון 🏁</small></div>}
          </div>
        </div></>) });
    }

    const tags = [
      s.records[0] && `🏅 שיא ב־${s.records[0].label}`,
      q && qualityVerdict(q.vs).ok && `⚡ ${q.label} ${qualityVerdict(q.vs).text}`,
      p && !hidePack && p.rank <= 3 && `${MEDAL[p.rank - 1]} מקום ${p.rank}`,
    ].filter(Boolean) as string[];
    out.push({ key: 'summary', dur: 20000, node: () => (<>
      <div className="bg plain deep" />
      <div className="c wk-poster-wrap">
        <div className="wk-poster rise">
          <div className="pt"><small>השבוע של</small><b>{story.name}</b><span><bdi>{label}</bdi></span></div>
          <div className="pk"><bdi>{km1(s.km)}</bdi><u>ק״מ</u></div>
          <div className="pg">
            <div><b>{s.runs}</b><small>ריצות</small></div>
            {s.planShare != null ? <div><b><bdi>{Math.round(s.planShare * 100)}%</bdi></b><small>מהתוכנית</small></div> : <div><b><bdi>{fmtDuration(s.seconds)}</bdi></b><small>שעות</small></div>}
            {fmtPace(s.seconds, s.km) && <div><b dir="ltr">{fmtPace(s.seconds, s.km)}</b><small>קצב</small></div>}
          </div>
          <p className="hl">{tags.length ? tags.join(' · ') : hl.text}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="pft"><img src="/images/wordmark-white.png" alt="" /></div>
        </div>
        <div className="acts rise d2">
          {canVideo && <button type="button" className="v" onClick={() => void videoRef.current()} disabled={!!video}>🎬 סרטון לסטורי</button>}
          <button type="button" className="p" onClick={() => void shareOneRef.current()} disabled={busy}>{busy ? 'מכין…' : 'שיתוף התמונה לסטורי'}</button>
          {p && hidePack && <button type="button" onClick={() => void togglePack()}>להחזיר את שקף הדבוקה</button>}
        </div>
      </div></>) });
    return out;
  }, [story, s, label, hl, hidePack, togglePack, busy, canVideo, video, onClose, router]);

  const [at, setAt] = useState(0);
  const [mounted, setMounted] = useState(false);
  // Hiding the pack removes its slide under the reader: stay within the row.
  useEffect(() => { setAt((i) => Math.min(i, slides.length - 1)); }, [slides.length]);

  const renderStill = useCallback((i: number) => new Promise<HTMLDivElement>((resolve) => {
    waitFor.current = resolve;
    setExporting(i);
  }), []);
  useEffect(() => {
    if (exporting == null || !exportRef.current || !waitFor.current) return;
    const node = exportRef.current;
    const done = waitFor.current;
    waitFor.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => done(node)));
  }, [exporting]);

  const base = `madregot-week-${story.window.weekEnd}`;
  shareOneRef.current = async () => {
    setBusy(true); setNotice(null);
    try {
      const r = await shareImages([await captureSlide(await renderStill(at))], `${base}-${slides[at].key}`);
      if (r === 'downloaded') { setNotice('התמונה נשמרה'); setTimeout(() => setNotice(null), 2600); }
    } catch {
      setNotice('לא הצלחנו להכין את התמונה');
    } finally {
      setExporting(null); setBusy(false);
    }
  };
  videoRef.current = async () => {
    const ac = new AbortController();
    videoAbort.current = ac;
    setNotice(null); setVideoFile(null);
    setVideo({ phase: 'prep', p: 0, slide: 1 });
    const pictures: ImageBitmap[] = [];
    try {
      for (let i = 0; i < slides.length; i++) {
        if (ac.signal.aborted) return;
        setVideo({ phase: 'prep', p: i / slides.length, slide: i + 1 });
        pictures.push(await createImageBitmap(await captureSlide(await renderStill(i))));
      }
      setExporting(null);
      const total = videoLength(pictures.length);
      const blob = await recordStory(pictures, {
        signal: ac.signal,
        onProgress: (p) => setVideo({ phase: 'rec', p, slide: Math.min(pictures.length, Math.floor((p * total) / SLIDE_MS) + 1) }),
      });
      // Safari opens the share sheet only right after a tap: the ready video waits for one.
      setVideoFile(blob);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNotice('לא הצלחנו להכין את הסרטון');
    } finally {
      pictures.forEach((b) => b.close());
      setExporting(null); setVideo(null); videoAbort.current = null;
    }
  };
  const sendVideo = async () => {
    if (!videoFile) return;
    const r = await shareVideo(videoFile, base);
    if (r === 'downloaded') { setNotice('הסרטון נשמר'); setTimeout(() => setNotice(null), 2600); }
    if (r !== 'cancelled') setVideoFile(null);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = useCallback((d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);
  useEffect(() => { setMounted(true); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, []);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const measure = () => setFit(Math.max(0.7, Math.min(1, window.innerHeight / 820)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (at < slides.length - 1 && !busy && !video) timer.current = setTimeout(() => go(1), slides[at].dur);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [at, slides, go, busy, video]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(1);
      if (e.key === 'ArrowRight') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="ys wk" role="dialog" aria-modal="true" aria-label="השבוע שלך" dir="rtl" style={{ ['--fit' as string]: fit }}>
      <div className="bars-top">{slides.map((sl, i) => (
        <i key={sl.key} className={i < at ? 'done' : i === at ? 'now' : ''} style={{ ['--dur' as string]: `${sl.dur}ms` }}><b key={i === at ? `run-${at}` : 'x'} /></i>
      ))}</div>
      <div className="top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/wordmark-white.png" alt="מדרגות" />
        <button type="button" onClick={onClose} aria-label="סגירה" className="ys-x">✕</button>
      </div>
      {slides.map((sl, i) => (
        <section key={sl.key} className={`sl s-${sl.key}${i === at ? ' show' : ''}`} aria-hidden={i !== at}>
          {Math.abs(i - at) <= 1 && <SlideBody key={i === at ? `live-${at}` : 'idle'}>{sl.node()}</SlideBody>}
        </section>
      ))}
      {at < slides.length - 1 && <>
        <button type="button" className="tap l" aria-label="הבא" onClick={() => go(1)} />
        <button type="button" className="tap r" aria-label="הקודם" onClick={() => go(-1)} />
      </>}
      {at === slides.length - 1 && <button type="button" className="tap r back" aria-label="הקודם" onClick={() => go(-1)} />}
      {at < slides.length - 1 && (
        <button type="button" className="ys-share" onClick={() => void shareOneRef.current()} disabled={busy}>
          {busy ? 'מכין…' : <><svg viewBox="0 0 24 24" aria-hidden><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>שיתוף לסטורי</>}
        </button>
      )}
      {notice && <p className="ys-notice" role="status">{notice}</p>}
      {(video || videoFile) && (
        <div className="ys-video" role="status">
          {video ? (<>
            <b>מכין את הסרטון…</b>
            <div className="bar"><i style={{ width: `${Math.round((video.phase === 'prep' ? video.p * 0.25 : 0.25 + video.p * 0.75) * 100)}%` }} /></div>
            <small>{video.phase === 'prep' ? 'מכין את השקפים' : <>שקף <bdi>{video.slide}</bdi> מתוך <bdi>{slides.length}</bdi></>}<br />כדאי להשאיר את המסך פתוח</small>
            <button type="button" className="ghost" onClick={() => videoAbort.current?.abort()}>ביטול</button>
          </>) : (<>
            <b>🎬 הסרטון מוכן</b>
            <small>לאינסטגרם ← סטורי, לוואטסאפ, או שמירה לגלריה</small>
            <button type="button" className="go" onClick={() => void sendVideo()}>שיתוף הסרטון</button>
            <button type="button" className="ghost" onClick={() => setVideoFile(null)}>סגירה</button>
          </>)}
        </div>
      )}
      {exporting != null && (
        <div ref={exportRef} className="ys wk ys-export still" dir="rtl" aria-hidden style={{ width: EXPORT_W, height: EXPORT_H, ['--fit' as string]: EXPORT_H / 820 }}>
          {slides[exporting].key !== 'summary' && (
            <div className="top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/wordmark-white.png" alt="" />
            </div>
          )}
          <section className={`sl show s-${slides[exporting].key}`}>{slides[exporting].node()}</section>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Remounted every time its slide comes up, so the entrance animations play again. */
function SlideBody({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
