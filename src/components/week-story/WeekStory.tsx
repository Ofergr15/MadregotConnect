'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { WeekStory as Story } from '@/lib/week-story/server';
import { fmtDuration, fmtPace, highlightOf, qualityVerdict, weekLabel } from '@/lib/week-story/model';
import { EXPORT_H, EXPORT_W, captureSlide, shareImages } from '@/components/birthday/capture';
import { SLIDE_MS, canRecordVideo, recordStory, shareVideo, videoLength } from '@/components/birthday/video';
import { academyBoardUrl } from '@/lib/academy/deep-links';
import { THEMES, THEME_KEYS, hexToHsl, hslToHex, isCustom, partShown, slideShown, themeAccent, themeStops, toggleSlide, togglePart, FIXED_SLIDES, type StoryLayout, type Theme, type WorkoutPick } from '@/lib/week-story/layout';
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

const SLIDE_NAME: Record<string, string> = {
  intro: 'פתיחה', km: 'ק״מ', plan: 'תוכנית', record: 'שיא', workout: 'אימון', pack: 'דבוקה',
  coach: 'מאמן', next: 'שבוע הבא', club: 'מועדון', summary: 'סיכום',
};

/**
 * `editable`: the admin may switch to edit mode ON the story (mockup week-story-v2/v3.html):
 * hide a slide with the eye, hide a part by tapping it, pick the club's workout and
 * background; "סיום" saves the layout for everybody. `own`: the reader is the member
 * whose week it is, so they may switch their workout and background (their own prefs).
 */
export function WeekStory({ story, onClose, editable = false, own = true }: { story: Story; onClose: () => void; editable?: boolean; own?: boolean }) {
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
  const [layout, setLayout] = useState<StoryLayout>(story.layout);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<Theme>(story.theme);
  const [workout, setWorkout] = useState<WorkoutPick | null>(story.workout);
  const [sheet, setSheet] = useState<null | 'workout' | 'bg' | 'slides'>(null);
  const flash = useCallback((t: string) => { setNotice(t); setTimeout(() => setNotice(null), 2600); }, []);

  // The member's own pick, saved at once; a failed save puts the old one back.
  const saveMine = useCallback(async (change: { workout?: WorkoutPick; theme?: Theme }) => {
    const before = { workout, theme };
    if (change.workout) setWorkout(change.workout);
    if (change.theme) setTheme(change.theme);
    try {
      const r = await fetch('/api/week-story', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...change, weekEnd: story.window.weekEnd }) });
      if (!r.ok) throw new Error();
    } catch { setWorkout(before.workout); setTheme(before.theme); flash('לא הצלחנו לשמור'); }
  }, [workout, theme, story.window.weekEnd, flash]);

  // Edit mode works on a draft; the club's background and workout show as picked.
  const pickClub = (change: Partial<StoryLayout>) => {
    setLayout((l) => ({ ...l, ...change }));
    if (change.theme) setTheme(change.theme);
    if (change.workout) setWorkout(change.workout);
  };
  const finishEdit = async () => {
    try {
      const r = await fetch('/api/admin/stories', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feature: 'weekly', layout }) });
      const j = (await r.json().catch(() => ({}))) as { code?: string };
      if (!r.ok) throw new Error(j.code || 'x');
      setEditing(false); flash('נשמר לכל המועדון');
    } catch (e) { flash((e as Error).message === 'no_layout_column' ? 'צריך להריץ את מיגרציה 170 קודם' : 'לא הצלחנו לשמור'); }
  };
  /** A part of a slide: gone when hidden, and in edit mode a dashed box that hides on a tap. */
  const P = (slide: string, part: string, node: React.ReactNode, cls = '') => {
    const shown = partShown(layout, slide, part);
    if (!editing) return shown ? node : null;
    return (
      <div key={`${slide}-${part}`} className={`wk-part ${cls}${shown ? '' : ' off'}`} role="button" tabIndex={0} aria-pressed={!shown}
        onClick={(e) => { e.stopPropagation(); setLayout((l) => togglePart(l, slide, part)); }}>
        {node}<span className="wk-part-x" aria-hidden>{shown ? '👁' : '🙈'}</span>
      </div>
    );
  };

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
        {P('km', 'hero', <div className="hero rise d1"><b>{km1(s.km)}</b><u>ק״מ</u></div>)}
        {diff != null && Math.abs(diff) >= 0.5 && P('km', 'diff', <span className="wk-pill rise d1">{diff > 0 ? '▲' : '▼'} <bdi>{km1(Math.abs(diff))}</bdi> ק״מ {diff > 0 ? 'יותר' : 'פחות'} משבוע שעבר</span>)}
        {P('km', 'days', <div className="wk-days rise d2">{s.dayKm.map((k, i) => {
          return (
            <div key={i}>
              <span>{k > 0 ? km1(k) : ''}</span>
              {/* A day without a run is empty — never red, whatever the plan said (Ofer, 10-23:
                  "there's red on the day I didn't run; it should show nothing"). */}
              {k > 0 ? <i style={{ height: `${(k / top) * 100}%` }} /> : <i className="z" />}
              {DAY_LETTER[i]}
            </div>
          );
        })}</div>)}
        {P('km', 'line', <p className="lead rise d3"><bdi>{s.runs}</bdi> ריצות · <bdi>{fmtDuration(s.seconds)}</bdi> שעות{fmtPace(s.seconds, s.km) && <> · קצב <bdi dir="ltr">{fmtPace(s.seconds, s.km)}</bdi></>}</p>)}
      </div></>) });

    if (s.planShare != null) {
      const pct = Math.round(Math.min(1, s.planShare) * 100);
      out.push({ key: 'plan', dur: 5000, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="k rise">מול התוכנית</p>
          {s.sessionsPlanned != null && P('plan', 'sessions', <h2 className="rise d1"><bdi>{s.sessionsDone}</bdi> מתוך <bdi>{s.sessionsPlanned}</bdi> אימונים</h2>)}
          {P('plan', 'ring', <div className="wk-ring rise d1" style={{ ['--p' as string]: `${pct * 3.6}deg` }}><div><b><bdi>{Math.round(s.planShare! * 100)}%</bdi></b><small>מהק״מ שתוכנן</small></div></div>)}
          {story.missed.some(Boolean) && P('plan', 'missed',
            <div className="wk-list rise d2">{story.missed.map((m, i) => m ? <div key={i} className="li"><b>{WEEKDAYS[i]}</b><span className="r no">פוספס</span></div> : null)}</div>,
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
          {r.seconds > 0 && P('record', 'hero', <div className="hero rise d1"><b>{clock(r.seconds)}</b></div>)}
          {s.records.length > 1 && <p className="lead rise d2">ועוד {s.records.slice(1).map((x) => x.label).join(', ')}.</p>}
        </div></>) });
    }

    const q = story.quality;
    const lg = story.long;
    // The chips, on the slide: the admin picks the club's default, the member their own.
    const chips = editing && story.workouts.length > 1 && (
      <div className="wk-chips" onClick={(e) => e.stopPropagation()}>
        {q && q.reps.length > 0 && <button type="button" className={workout === 'quality' ? 'on' : ''} onClick={() => pickClub({ workout: 'quality' })}>⚡ איכות · {DAY_LETTER[q.day]} <bdi dir="ltr">{q.label}</bdi></button>}
        {lg && <button type="button" className={workout === 'long' ? 'on' : ''} onClick={() => pickClub({ workout: 'long' })}>🏃 ארוכה · {DAY_LETTER[lg.day]} <bdi>{km1(lg.km)}</bdi> ק״מ</button>}
      </div>
    );
    const swap = !editing && own && story.workouts.length > 1 && (
      <button type="button" className="wk-swap" onClick={(e) => { e.stopPropagation(); setSheet('workout'); }}>🔁 להחליף לאימון אחר</button>
    );
    if (workout === 'quality' && q && q.reps.length) {
      const fast = Math.min(...q.reps, ...q.target), slow = Math.max(...q.reps, ...q.target);
      const h = (p: number) => 35 + (60 * (slow - p)) / Math.max(1, slow - fast);
      out.push({ key: 'workout', dur: 5500, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          {chips}
          {P('workout', 'title', <><p className="eyebrow-s rise">⚡ אימון האיכות · {WEEKDAYS[q.day]}</p>
          <h2 className="rise d1" dir="ltr" style={{ textAlign: 'right' }}>{q.label}</h2></>)}
          {q.target.length > 0 && P('workout', 'pve', <p className="lead rise d1">היעד: <bdi dir="ltr">{pace(Math.min(...q.target))}{Math.max(...q.target) !== Math.min(...q.target) ? `–${pace(Math.max(...q.target))}` : ''}</bdi> לק״מ</p>)}
          {P('workout', 'chart', <div className="wk-reps rise d2">{q.reps.map((p, i) => <div key={i}><i><b style={{ height: `${h(p)}%` }} /></i><span>{pace(p)}</span></div>)}</div>)}
          {P('workout', 'verdict', <span className="wk-pill rise d3">{qualityVerdict(q.vs).ok ? '✓ ' : ''}{qualityVerdict(q.vs).text}</span>)}
        </div>
        {swap}</>) });
    } else if (workout === 'long' && lg) {
      const lo = Math.min(...lg.kms.map((k) => k.lo)), hi = Math.max(...lg.kms.map((k) => k.hi));
      out.push({ key: 'workout', dur: 5500, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          {chips}
          {P('workout', 'title', <><p className="eyebrow-s rise">🏃 הארוכה · {WEEKDAYS[lg.day]}</p>
          <h2 className="rise d1"><bdi>{km1(lg.km)}</bdi> ק״מ</h2></>)}
          {P('workout', 'pve', <p className="lead rise d1">{hi !== lo ? <>התוכנית: מ־<bdi>{pace(hi)}</bdi> עד <bdi>{pace(lo)}</bdi> לק״מ</> : <>התוכנית: <bdi>{pace(lo)}</bdi> לק״מ</>}<br />ריבוע לכל ק״מ</p>)}
          {P('workout', 'chart', <div className="wk-sq rise d2">{lg.kms.map((k, i) => <i key={i} className={k.mark} title={pace(k.p)}><span>{pace(k.p)}</span></i>)}</div>)}
          {P('workout', 'verdict', <span className="wk-pill rise d3"><bdi>{lg.onPlan}</bdi> מתוך <bdi>{lg.kms.length}</bdi> ק״מ בקצב התוכנית</span>)}
        </div>
        {swap}</>) });
    }

    const p = story.pack;
    if (p && !hidePack) {
      const moved = p.lastRank != null ? p.lastRank - p.rank : 0;
      out.push({ key: 'pack', dur: 5500, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="eyebrow-s rise">{p.name ? `${p.name} · ` : ''}השבוע</p>
          {P('pack', 'rank', <h2 className="rise d1">מקום <bdi>{p.rank}</bdi> {MEDAL[p.rank - 1] ?? ''}</h2>)}
          {moved !== 0 && P('pack', 'moved', <span className="wk-pill rise d1">{moved > 0 ? '▲' : '▼'} <bdi>{Math.abs(moved)}</bdi> {Math.abs(moved) === 1 ? 'מקום' : 'מקומות'} משבוע שעבר</span>)}
          {P('pack', 'table', <div className="wk-rank rise d2">{p.top.map((r) => (
            <div key={`${r.name}-${r.km}`} className={r.me ? 'rk me' : 'rk'}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.avatarUrl ? <img className="av" src={r.avatarUrl} alt="" /> : <i className="av" />}
              {r.name}<span className="km"><bdi>{km1(r.km)}</bdi></span>
            </div>
          ))}</div>)}
        </div>
        <button type="button" className="wk-hide" onClick={() => void togglePack()}>לא להציג לי את הדבוקה</button></>) });
    }

    const a = story.academy;
    if (a && (a.comments > 0 || a.score != null)) {
      out.push({ key: 'coach', dur: 5000, node: () => (<>
        <div className="bg plain" />
        <div className="c">
          <p className="eyebrow-s rise">💬 מהמאמן השבוע</p>
          {P('coach', 'title', <h2 className="rise d1">{a.comments > 0 ? `${a.comments} ${a.comments === 1 ? 'משוב' : 'משובים'}` : 'השבוע שלך בלוח'}</h2>)}
          {a.score != null && P('coach', 'score', <span className="wk-pill rise d2">ציון לפי התוכנית · <bdi>{a.score}%</bdi></span>)}
        </div></>) });
    }
    if (a && a.nextSessions > 0) {
      out.push({ key: 'next', dur: 5000, node: () => (<>
        <div className="bg plain warm" />
        <div className="c end">
          <p className="eyebrow-s rise">🗓️ השבוע הבא כבר מוכן</p>
          {P('next', 'title', <h2 className="rise d1"><bdi>{a.nextSessions}</bdi> אימונים{a.nextKm ? <><br />כ־<bdi>{a.nextKm}</bdi> ק״מ</> : null}</h2>)}
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
            {P('club', 'km', <div><b><bdi>{n(c.km)}</bdi></b><small>ק״מ</small></div>)}
            {P('club', 'runners', <div><b><bdi>{c.runners}</bdi></b><small>רצים</small></div>)}
            {c.records > 0 && P('club', 'records', <div><b><bdi>{c.records}</bdi></b><small>שיאים</small></div>)}
            {c.marathons > 0 && P('club', 'marathons', <div><b><bdi>{c.marathons}</bdi></b><small>ריצות באורך מרתון 🏁</small></div>)}
          </div>
        </div></>) });
    }

    const tags = [
      s.records[0] && `🏅 שיא ב־${s.records[0].label}`,
      workout === 'quality' && q && qualityVerdict(q.vs).ok && `⚡ ${q.label} ${qualityVerdict(q.vs).text}`,
      workout === 'long' && lg && `🏃 ארוכה ${km1(lg.km)} ק״מ`,
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
    // Hidden slides are gone for the reader; in edit mode they stay, dimmed, to bring back.
    return editing ? out : out.filter((x) => slideShown(layout, x.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, s, label, hl, hidePack, togglePack, busy, canVideo, video, onClose, router, layout, editing, workout, sheet, own]);

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
    if (at < slides.length - 1 && !busy && !video && !editing && !sheet) timer.current = setTimeout(() => go(1), slides[at].dur);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [at, slides, go, busy, video, editing, sheet]);
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
    <div className={`ys wk th-${theme}${editing ? ' editing' : ''}`} role="dialog" aria-modal="true" aria-label="השבוע שלך" dir="rtl" style={{ ['--fit' as string]: fit, ...themeVars(theme) }}>
      <div className="bars-top">{slides.map((sl, i) => (
        <i key={sl.key} className={i < at ? 'done' : i === at ? 'now' : ''} style={{ ['--dur' as string]: `${sl.dur}ms` }}><b key={i === at ? `run-${at}` : 'x'} /></i>
      ))}</div>
      <div className="top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/wordmark-white.png" alt="מדרגות" />
        {editable && !editing && <button type="button" className="wk-edit-go" onClick={() => setEditing(true)}>✏️ עריכה</button>}
        {own && !editing && <button type="button" className="wk-edit-go" aria-label="רקע" onClick={() => setSheet('bg')}>🎨</button>}
        <button type="button" onClick={onClose} aria-label="סגירה" className="ys-x">✕</button>
      </div>
      {editing && (() => {
        // The slide's own switch, up top beside the logo: the one thing about a slide that must stay obvious.
        const key = slides[at]?.key;
        const fixed = FIXED_SLIDES.includes(key);
        const shown = slideShown(layout, key);
        return <button type="button" className={`wk-eye${shown ? '' : ' off'}`} disabled={fixed} onClick={() => setLayout((l) => toggleSlide(l, key))}>{fixed ? '🔒 תמיד מוצג' : shown ? '👁 השקף מוצג' : '🙈 השקף מוסתר'}</button>;
      })()}
      {slides.map((sl, i) => (
        <section key={sl.key} className={`sl s-${sl.key}${i === at ? ' show' : ''}${editing && !slideShown(layout, sl.key) ? ' hid' : ''}`} aria-hidden={i !== at}>
          {Math.abs(i - at) <= 1 && <SlideBody key={i === at ? `live-${at}` : 'idle'}>{sl.node()}</SlideBody>}
          {editing && !slideShown(layout, sl.key) && <div className="wk-hid" aria-hidden><b>🙈</b>מוסתר</div>}
        </section>
      ))}
      {editing && (
        <div className="wk-editbar">
          <button type="button" onClick={() => setSheet('slides')}>▦ שקפים <small><bdi>{at + 1}</bdi>/<bdi>{slides.length}</bdi></small></button>
          <button type="button" onClick={() => setSheet('bg')}><i className="dot" style={themeVars(layout.theme)} /> רקע</button>
          <button type="button" className="done" onClick={() => void finishEdit()}>סיום</button>
        </div>
      )}
      {sheet === 'slides' && (
        <Sheet title="השקפים" onClose={() => setSheet(null)}>
          <div className="wk-slides">{slides.map((sl, i) => (
            <button key={sl.key} type="button" className={`${i === at ? 'now' : ''}${slideShown(layout, sl.key) ? '' : ' off'}`} onClick={() => { setAt(i); setSheet(null); }}>
              <b><bdi>{i + 1}</bdi></b><span>{SLIDE_NAME[sl.key] ?? sl.key}</span><em>{slideShown(layout, sl.key) ? '👁' : '🙈'}</em>
            </button>
          ))}</div>
        </Sheet>
      )}
      {sheet === 'bg' && (
        <Sheet title="רקע" onClose={() => setSheet(null)}>
          <ThemeGrid value={editing ? layout.theme : theme} onPick={(t) => (editing ? pickClub({ theme: t }) : void saveMine({ theme: t }))} />
        </Sheet>
      )}
      {sheet === 'workout' && (
        <Sheet title="האימון בסטורי" onClose={() => setSheet(null)}>
          <div className="wk-chips">
            {story.quality && <button type="button" className={workout === 'quality' ? 'on' : ''} onClick={() => void saveMine({ workout: 'quality' })}>⚡ איכות · {DAY_LETTER[story.quality.day]} <bdi dir="ltr">{story.quality.label}</bdi></button>}
            {story.long && <button type="button" className={workout === 'long' ? 'on' : ''} onClick={() => void saveMine({ workout: 'long' })}>🏃 ארוכה · {DAY_LETTER[story.long.day]} <bdi>{km1(story.long.km)}</bdi> ק״מ</button>}
          </div>
        </Sheet>
      )}
      {at < slides.length - 1 && <>
        <button type="button" className="tap l" aria-label="הבא" onClick={() => go(1)} />
        <button type="button" className="tap r" aria-label="הקודם" onClick={() => go(-1)} />
      </>}
      {at === slides.length - 1 && <button type="button" className="tap r back" aria-label="הקודם" onClick={() => go(-1)} />}
      {!editing && at < slides.length - 1 && (
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
        <div ref={exportRef} className="ys wk ys-export still" dir="rtl" aria-hidden style={{ width: EXPORT_W, height: EXPORT_H, ['--fit' as string]: EXPORT_H / 820, ...themeVars(theme) }}>
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

/**
 * The background's three stops as CSS variables. --c1..--c4 keep the older rules in the
 * theme, and the accent (the ring's fill, the "me" row, the white buttons' text) is the
 * darkest stop — so a colour of one's own fits every slide like a preset does.
 */
function themeVars(t: Theme): React.CSSProperties {
  const [a, b, c] = themeStops(t);
  const acc = themeAccent(t);
  return { ['--g1' as string]: a, ['--g2' as string]: b, ['--g3' as string]: c, ['--c1' as string]: a, ['--c2' as string]: a, ['--c3' as string]: acc, ['--c4' as string]: b, ['--blue' as string]: acc } as React.CSSProperties;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="wk-sheet" role="dialog" aria-label={title} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <i className="grab" />
        <b className="ttl">{title}</b>
        {children}
        <button type="button" className="ok" onClick={onClose}>סגירה</button>
      </div>
    </div>
  );
}

/**
 * The backgrounds as a 3×3 grid of large moving circles, the ninth "צבע משלך": it turns the
 * sheet into two smooth sliders (hue, lightness) and a live circle; the colour is made
 * readable for white text on its way to the gradient (deriveStops).
 */
function ThemeGrid({ value, onPick }: { value: Theme; onPick: (t: Theme) => void }) {
  const custom = isCustom(value);
  const [own, setOwn] = useState(false);
  const [hsl, setHsl] = useState<[number, number]>(() => { const [h, , l] = custom ? hexToHsl(value) : [330, 0, 0.55]; return [Math.round(h), Math.round(l * 100)]; });
  const hex = hslToHex(hsl[0], 0.75, hsl[1] / 100) as Theme;
  if (own) {
    return (
      <div className="wk-own">
        <div className="sw big" style={themeVars(hex)}><i /></div>
        <label>גוון<input type="range" className="hue" min={0} max={359} value={hsl[0]} onChange={(e) => setHsl([Number(e.target.value), hsl[1]])} /></label>
        <label>בהירות<input type="range" className="lit" min={15} max={90} value={hsl[1]} style={{ ['--h' as string]: hsl[0] }} onChange={(e) => setHsl([hsl[0], Number(e.target.value)])} /></label>
        <div className="row2">
          <button type="button" className="ghost" onClick={() => setOwn(false)}>חזרה</button>
          <button type="button" className="pick" onClick={() => { onPick(hex); setOwn(false); }}>בחירה</button>
        </div>
      </div>
    );
  }
  return (
    <div className="wk-grid">
      {THEME_KEYS.map((k) => (
        <button key={k} type="button" aria-pressed={value === k} className={value === k ? 'on' : ''} onClick={() => onPick(k)}>
          <span className="sw" style={themeVars(k)}><i /></span><small>{THEMES[k].label}</small>
        </button>
      ))}
      <button type="button" aria-pressed={custom} className={custom ? 'on' : ''} onClick={() => setOwn(true)}>
        <span className={`sw${custom ? '' : ' own'}`} style={custom ? themeVars(value) : undefined}><i />{!custom && <b>+</b>}</span><small>צבע משלך</small>
      </button>
    </div>
  );
}

/** Remounted every time its slide comes up, so the entrance animations play again. */
function SlideBody({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
