'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAthleteId } from '@/lib/use-athlete-id';
import type { BirthdayStory, PhotoSlot } from '@/lib/birthday-year/server';
import {
  AZRIELI_ROUND_M, EVEREST_M, PIZZA_KCAL, TLV_VALENCIA_KM, timesInWords,
} from '@/lib/birthday-year/stats';
import { EXPORT_H, EXPORT_W, captureSlide, shareImages } from './capture';
import { SLIDE_MS, canRecordVideo, recordStory, shareVideo, videoLength } from './video';
import { storyVariant } from '@/lib/birthday-year/variant';
import './year-story.css';

// "השנה שלך" — the birthday story (mockup ~/.cache/madregot/birthday-year/mockup-v4.html).
// Full screen, Instagram-style: a bar per slide, tap the reading-end half for the next one
// and the start half for the previous one, Escape or ✕ to close. Slides with nothing to
// say for this person (no race this year, no climbing, no message) are left out rather
// than shown empty. Data-heavy slides carry no photo (Ofer, 2026-10-18).

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MON_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const BEST_LABEL: Record<string, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', hm: 'חצי מרתון', fm: 'מרתון' };
const MOMENT_TITLE: Record<string, string> = { fm: 'מרתון', hm: 'חצי מרתון', '10k': '10 ק״מ', '5k': '5 ק״מ' };


const PHOTO_SLOTS_ORDER: PhotoSlot[] = ['intro', 'thanks', 'km', 'streak', 'moment', 'long', 'climb', 'poster'];

const n = (v: number) => v.toLocaleString('en-US');
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const dmy = (iso: string) => `${dm(iso)}.${iso.slice(2, 4)}`;
const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const pace = (sec: number, km: number) => { const p = Math.round(sec / km); return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`; };

function Count({ to, dec = 0, run }: { to: number; dec?: number; run: boolean }) {
  const [v, setV] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now() + 300;
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / 1500));
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return <>{dec ? v.toFixed(dec) : n(Math.round(v))}</>;
}

function Bg({ src, kind, pos = '50% 40%' }: { src?: string | null; kind: 'duo' | 'photo' | 'band' | 'plain' | 'soft'; pos?: string }) {
  if (!src || kind === 'plain') return <div className="bg plain" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <div className={`bg ${kind}`} style={{ ['--zoom' as string]: kind === 'soft' ? '1.4' : '1.05', ['--org' as string]: pos }}><img src={src} alt="" style={{ objectPosition: pos }} /></div>;
}

function routePath(pts: Array<{ lat: number; lng: number }>, w: number, h: number) {
  const lat = pts.map((p) => p.lat), lng = pts.map((p) => p.lng);
  const k = Math.cos((((Math.min(...lat) + Math.max(...lat)) / 2) * Math.PI) / 180);
  const sx = (Math.max(...lng) - Math.min(...lng)) * k || 1e-6, sy = Math.max(...lat) - Math.min(...lat) || 1e-6;
  const s = Math.min((w - 12) / sx, (h - 12) / sy);
  const ox = (w - sx * s) / 2, oy = (h - sy * s) / 2;
  const xy = pts.map((p) => [ox + (p.lng - Math.min(...lng)) * k * s, oy + (Math.max(...lat) - p.lat) * s]);
  return { d: 'M' + xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L'), end: xy[xy.length - 1] };
}

interface Slide { key: string; dur: number; node: (live: boolean) => React.ReactNode }

export function YearStory({ story, onClose }: { story: BirthdayStory; onClose: () => void }) {
  const { stats: s, config, name } = story;
  // Spoken to the birthday person when it is theirs, and about them to everybody else
  // (Ofer, 2026-10-18: "השיאים של שליו" when I open it, "השיאים שלך" when he does).
  const myId = useAthleteId();
  const mine = !!myId && myId === story.athleteId;
  const she = story.gender === 'female';
  const ran = mine ? 'רצת' : she ? 'רצה' : 'רץ';
  const yours = mine ? 'שלך' : `של ${name}`;
  // Every story a little different (lib/birthday-year/variant): the same pick for both
  // readers, so the owner and the club see the same story, each in their own voice.
  const variant = useMemo(() => storyVariant(story.athleteId, story.birthday, story.stats), [story]);
  const say = (key: string, options: string[]) => options[variant.pick(key, options.length)];
  // A slide without its own photo takes one of the person's other photos before a club one:
  // a birthday story with somebody else on it reads as a mistake (Ofer, 2026-10-18).
  const photo = useCallback((slot: PhotoSlot) => {
    const mine = Object.values(config.photos || {}).filter(Boolean) as string[];
    if (config.photos?.[slot]) return config.photos[slot]!;
    if (mine.length) return mine[PHOTO_SLOTS_ORDER.indexOf(slot) % mine.length];
    return variant.backgrounds[slot];
  }, [config.photos, variant]);
  const own = (slot: PhotoSlot) => config.photos?.[slot] || null;
  const hasMine = Object.values(config.photos || {}).some(Boolean);

  // Sharing: a still copy of a slide is rendered off screen and captured (capture.ts).
  const [exporting, setExporting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const waitFor = useRef<((n: HTMLDivElement) => void) | null>(null);
  const shareAllRef = useRef<() => Promise<void>>(async () => {});
  const shareAll = () => shareAllRef.current();
  const shareOneRef = useRef<() => Promise<void>>(async () => {});
  // The whole story as one video (video.ts): pictures first, then a real-time recording.
  const [video, setVideo] = useState<{ phase: 'prep' | 'rec'; p: number; slide: number } | null>(null);
  const [videoFile, setVideoFile] = useState<Blob | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  const videoRef = useRef<() => Promise<void>>(async () => {});
  const [canVideo, setCanVideo] = useState(false);
  useEffect(() => { setCanVideo(canRecordVideo()); }, []);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    out.push({ key: 'intro', dur: 5500, node: () => (<>
      <Bg src={photo('intro')} kind={hasMine ? 'photo' : 'duo'} pos="50% 35%" />
      <div className="c end">
        <h1 className="rise d1">מזל טוב<br /><span className="name">{name}!</span> 🎂</h1>
        <p className="lead rise d2">{say('intro', mine
          ? ['הנה השנה שלך בריצה, מיום ההולדת הקודם ועד היום.', 'שנה של ריצה מאז יום ההולדת הקודם — הנה היא.', 'מה עשית מאז יום ההולדת הקודם? הנה.']
          : [`הנה השנה של ${name} בריצה, מיום ההולדת הקודם ועד היום.`, `שנה של ריצה של ${name} מאז יום ההולדת הקודם — הנה היא.`, `מה ${name} ${she ? 'עשתה' : 'עשה'} מאז יום ההולדת הקודם? הנה.`])}</p>
        <p className="hint rise d3">לחיצה שמאלה להמשך ‹</p>
      </div></>) });
    if (config.message) {
      out.push({ key: 'thanks', dur: 12000, node: () => (<>
        <Bg src={photo('thanks')} kind={hasMine ? 'photo' : 'duo'} pos="45% 25%" />
        <div className="c end">
          <p className="eyebrow-s rise">מכל המדרגות</p>
          <h2 className="ded rise slow s1">{name}, תודה.</h2>
          {config.message!.split(/\n+/).map((line, i) => (
            <p key={i} className={`lead ded-b rise slow ${i === 0 ? 's2' : 's3'}`}>{line}</p>
          ))}
          <p className="sig rise slow s4">מזל טוב 🎂 · כל המדרגות</p>
        </div></>) });
    }
    out.push({ key: 'km', dur: 5500, node: (live) => (<>
      <Bg src={photo('km')} kind={hasMine ? 'band' : 'duo'} pos="50% 42%" />
      <div className="c end">
        <p className="k rise">{say('km', mine ? ['השנה רצת', 'בשנה הזו רצת', 'בסך הכול השנה'] : [`השנה ${name} ${ran}`, `בשנה הזו ${name} ${ran}`, 'בסך הכול השנה'])}</p>
        <div className="hero rise d1"><b><Count to={s.km} run={live} /></b><u>ק״מ</u></div>
        {s.km >= TLV_VALENCIA_KM / 2 && (<>
          <div className="trip rise d2"><svg viewBox="0 0 320 90"><path className="arc" d="M300 70 Q160 -30 20 60" fill="none" stroke="#FF5315" strokeWidth={3.5} strokeLinecap="round" strokeDasharray="2 8" /><circle cx="300" cy="70" r="5" fill="#fff" /><circle cx="20" cy="60" r="5" fill="#FF5315" /></svg>
            <div className="tl"><span>תל אביב</span><span>ולנסיה</span></div></div>
          <p className="big2 rise d3">כמו לרוץ מתל אביב לוולנסיה<br />{timesInWords(s.km / TLV_VALENCIA_KM)}.</p>
        </>)}
      </div></>) });
    out.push({ key: 'days', dur: 8000, node: (live) => (<>
      <Bg kind="plain" />
      <div className="c">
        <p className="k rise">{s.restDays <= s.totalDays * 0.2 ? 'כמעט כל יום' : `הימים ש${mine ? '' : `${name} `}${ran}`}</p>
        <div className="hero sm rise d1"><b><Count to={s.runDates.length} run={live} /></b><u>ימים עם ריצה, מתוך {s.totalDays}</u></div>
        <p className="lead rise d1">כל ריבוע הוא יום. {s.restDays} ימי מנוחה בכל השנה.</p>
        <MonthGrid story={story} ranLabel={ran} />
      </div></>) });
    if (s.streak && s.streak.days >= 3) {
      out.push({ key: 'streak', dur: 5500, node: (live) => (<>
        <Bg src={photo('streak')} kind={hasMine ? 'photo' : 'duo'} pos="40% 40%" />
        <div className="c end">
          <div className="ys-ring rise"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" className="tr" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={9} /><circle cx="60" cy="60" r="52" className="prog" fill="none" stroke="#FF5315" strokeWidth={9} strokeLinecap="round" strokeDasharray="326.7" style={{ strokeDashoffset: 326.7 * (1 - s.streak!.days / s.totalDays) }} /></svg><span>🔥</span></div>
          <p className="k rise">{say('streak', [`הרצף הכי ארוך ${yours}`, 'הכי הרבה ימים ברצף', 'יום אחרי יום'])}</p>
          <div className="hero rise d1"><b><Count to={s.streak!.days} run={live} /></b><u>ימים ברצף</u></div>
          <p className="big2 rise d2">מ־<bdi>{dm(s.streak!.from)}</bdi> עד <bdi>{dm(s.streak!.to)}</bdi><br />{mine ? 'לא פספסת' : she ? 'לא פספסה' : 'לא פספס'} אף יום.</p>
        </div></>) });
    }
    const m = s.moment;
    if (m) {
      const r = routePath(m.route, 300, 220);
      out.push({ key: 'moment', dur: 6500, node: () => (<>
        <Bg src={photo('moment')} kind={hasMine ? 'photo' : 'duo'} pos="70% 25%" />
        <div className="c end">
          <p className="eyebrow-s rise">הריצה של השנה</p>
          <h2 className="rise d1">{config.momentTitle || MOMENT_TITLE[m.key]}</h2>
          <div className="hero rise d1"><b dir="ltr">{clock(m.seconds)}</b></div>
          <div className="bline rise d2"><span><bdi>{dmy(m.date)}</bdi></span><span><bdi>{pace(m.seconds, m.km)}</bdi> לק״מ</span><span><bdi>{m.km}</bdi> ק״מ</span></div>
          <svg className="broute rise d2" viewBox="0 0 300 220"><path className="rt" d={r.d} fill="none" stroke="#FF5315" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" /><circle cx={r.end[0]} cy={r.end[1]} r="5" fill="#fff" /></svg>
        </div></>) });
    }
    if (s.bests.length) {
      out.push({ key: 'prs', dur: 6000, node: () => (<>
        <div className="bg plain warm" />
        <div className="c"><p className="k rise">{say('prs', [`השיאים ${yours} השנה`, `הזמנים הכי מהירים ${yours}`, 'השיאים של השנה'])}</p><div className="prs">
          {['5k', '10k', 'hm', 'fm'].map((k, i) => {
            const b = s.bests.find((x) => x.key === k);
            if (!b) return null;
            const isMoment = m && b.activityId === m.activityId;
            return (
              <div key={k} className={`pr rise d${i + 1}${k === 'fm' || (k === 'hm' && !s.bests.some((x) => x.key === 'fm')) ? ' gold' : ''}`}>
                <span>{BEST_LABEL[k]}{isMoment && config.momentTitle ? <em>{config.momentTitle}</em> : null}</span>
                <b dir="ltr">{clock(isMoment ? m!.seconds : b.seconds)}</b><small><bdi>{dm(b.date)}</bdi></small>
              </div>
            );
          })}
        </div></div></>) });
    }
    if (s.longest) {
      const L = s.longest;
      out.push({ key: 'long', dur: 5500, node: (live) => (<>
        <Bg src={photo('long')} kind={hasMine ? 'photo' : 'duo'} pos="45% 20%" />
        <div className="c end">
          <p className="k rise">{say('long', ['הריצה הכי ארוכה', 'הכי רחוק שהגעת', 'הריצה הארוכה של השנה'])}</p>
          <div className="hero rise d1"><b><Count to={L.km} dec={1} run={live} /></b><u>ק״מ</u></div>
          {L.km > 42.2 && <div className="road rise d2"><i /><span className="m" style={{ left: `${(1 - 42.2 / L.km) * 100}%` }}>מרתון · <bdi>42.2</bdi></span></div>}
          <p className="big2 rise d3">{L.km > 42.2 ? `${Math.round(L.km - 42.2)} ק״מ יותר ממרתון.` : L.km > 21.1 ? 'יותר מחצי מרתון.' : 'בריצה אחת.'}</p>
          <p className="tiny rise d3">יום {WEEKDAYS[new Date(`${L.date}T12:00:00Z`).getUTCDay()]}, <bdi>{dmy(L.date)}</bdi></p>
        </div></>) });
    }
    if (s.bestMonth) {
      const best = s.bestMonth;
      const TOP = Math.max(200, Math.ceil(Math.max(...s.months.map((x) => x.km)) / 200) * 200);
      const ticks = Array.from({ length: TOP / 200 + 1 }, (_, i) => i * 200).filter((v, i, a) => a.length <= 6 || i % 2 === 0 || v === TOP);
      out.push({ key: 'rhythm', dur: 6000, node: () => (<>
        <Bg kind="plain" />
        <div className="c"><p className="k rise">ק״מ בכל חודש</p>
          <div className="chart rise d1"><div className="yax">{ticks.map((v) => <div key={v} className="gl" style={{ ['--y' as string]: v / TOP }}><span>{v}</span></div>)}</div>
            <div className="bars">{s.months.map((x, i) => (
              <div key={x.ym} className={`b${x.ym === best.ym ? ' best' : ''}`} style={{ ['--h' as string]: x.km / TOP, ['--i' as string]: i }}>
                {x.ym === best.ym && <span>{x.km}</span>}<i /><small>{MON_SHORT[Number(x.ym.slice(5)) - 1]}</small>
              </div>))}</div></div>
          <div className="duo rise d2">
            <div><small>החודש הכי חזק</small><b>{MONTHS[Number(best.ym.slice(5)) - 1]}</b><em><bdi>{best.km}</bdi> ק״מ</em></div>
            {s.commonHour != null && <div><small>רוב הריצות ב־</small><b dir="ltr">{String(s.commonHour).padStart(2, '0')}:00</b><em>{s.before7 > 0 ? <><bdi>{s.before7}</bdi> ריצות לפני 7 בבוקר</> : null}</em></div>}
          </div></div></>) });
    }
    if (s.elevM >= 1000) {
      out.push({ key: 'climb', dur: 7000, node: (live) => (<>
        <Bg src={photo('climb')} kind={hasMine ? 'band' : 'duo'} pos="78% 30%" />
        <div className="c end"><p className="k rise">{mine ? 'כמה טיפסת השנה' : `כמה ${name} ${she ? 'טיפסה' : 'טיפס'} השנה`}</p>
          <div className="hero rise d1"><b><Count to={s.elevM} run={live} /></b><u>מטר עלייה</u></div>
          {s.elevM >= EVEREST_M / 2 && <div className="cmp rise d2"><svg viewBox="0 0 80 56"><path d="M0 56 L16 36 L22 40 L34 18 L39 22 L48 4 L53 12 L58 9 L80 56 Z" fill="#FF5315" /><path d="M48 4 L53 12 L58 9 L62 18 L44 14 Z" className="snow" fill="#fff" /></svg>
            <div><p>האוורסט · <bdi>{n(EVEREST_M)}</bdi> מ׳</p><b>פי <bdi>{(s.elevM / EVEREST_M).toFixed(1)}</bdi></b></div></div>}
          <div className="cmp rise d3"><svg viewBox="0 0 80 56"><path d="M34 56 V10 L40 3 L46 10 V56 Z" fill="#FF5315" /><path d="M37 16h6M37 24h6M37 32h6M37 40h6M37 48h6" className="win" fill="none" stroke="#060a52" strokeWidth={2} /></svg>
            <div><p>מגדל עזריאלי · <bdi>{AZRIELI_ROUND_M}</bdi> מ׳</p><b>פי <bdi>{Math.round(s.elevM / AZRIELI_ROUND_M)}</bdi></b></div></div>
        </div></>) });
    }
    const tiles: Array<[string, React.ReactNode, string]> = [
      ['⏱️', <bdi key="h">{n(s.hours)}</bdi>, `שעות ריצה${s.hours >= 48 ? ` — ${Math.round(s.hours / 24)} ימים שלמים` : ''}`],
      ['📅', <><bdi>{Math.round(s.km / Math.max(1, s.totalWeeks))}</bdi> ק״מ</>, 'בשבוע, בממוצע'],
      ...(s.doubleDays ? [['✌️', <bdi key="d">{s.doubleDays}</bdi>, 'ימים עם שני אימונים'] as [string, React.ReactNode, string]] : []),
      ...(s.over30 ? [['🛣️', <bdi key="o">{s.over30}</bdi>, 'ריצות של 30 ק״מ ומעלה'] as [string, React.ReactNode, string]] : []),
      ['📏', <><bdi>{s.avgKm}</bdi> ק״מ</>, 'ריצה ממוצעת'],
      ...(s.topWeekday ? [['☀️', <>{WEEKDAYS[s.topWeekday.day]}</>, `היום שהכי הרבה ${ran} בו · ${s.topWeekday.runs}`] as [string, React.ReactNode, string]] : []),
      ['🌳', <bdi key="out">{s.outdoor}</bdi>, 'ריצות בחוץ'],
      ...(s.treadmill ? [['🏠', <bdi key="tm">{s.treadmill}</bdi>, 'ריצות בהליכון'] as [string, React.ReactNode, string]] : []),
    ];
    out.push({ key: 'more', dur: 10000, node: () => (<>
      <Bg kind="plain" />
      <div className="c"><p className="k rise">{say('more', ['ועוד כמה מספרים', 'השנה שלך בעוד מספרים', 'עוד כמה דברים שעשית'])}</p><div className="tiles">
        {tiles.slice(0, 8).map(([icon, value, label], i) => (
          <div key={i} className={`tl2 rise d${Math.min(4, Math.floor(i / 2) + 1)}`}><span>{icon}</span><b>{value}</b><small>{label}</small></div>
        ))}
        {s.calories > 0 && <div className="tl2 wide rise d4"><span>🍕</span><div><b><bdi>{n(s.calories)}</bdi> קלוריות</b><small>בערך {n(Math.round(s.calories / PIZZA_KCAL))} פיצות משפחתיות</small></div></div>}
      </div></div></>) });
    // This person's order: their strongest numbers first (lib/birthday-year/variant).
    const head = out.filter((x) => x.key === 'intro' || x.key === 'thanks');
    const mid = variant.order.map((k) => out.find((x) => x.key === k)).filter((x): x is Slide => !!x);
    const tail = out.filter((x) => x.key === 'more');
    out.length = 0;
    out.push(...head, ...mid, ...tail);
    out.push({ key: 'summary', dur: 20000, node: () => <Poster story={story} photo={photo('poster')} onShareThis={() => void shareOneRef.current()} onShareAll={() => void shareAll()} busy={busy} busyAll={busyAll} onVideo={canVideo ? () => void videoRef.current() : undefined} busyVideo={!!video} /> });
    return out;
  }, [story, s, config, name, photo, busy, busyAll, canVideo, video, mine, ran, yours, she, variant]); // eslint-disable-line react-hooks/exhaustive-deps

  const [at, setAt] = useState(0);
  const [mounted, setMounted] = useState(false);

  /** Render slide `i` still, off screen, and resolve with its node once it is painted. */
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

  const told = (r: 'shared' | 'downloaded' | 'cancelled', many = false) => {
    if (r === 'downloaded') setNotice(many ? 'התמונות נשמרו' : 'התמונה נשמרה');
    if (r !== 'cancelled') setTimeout(() => setNotice(null), 2600);
  };
  const shareOne = async () => {
    setBusy(true); setNotice(null);
    try {
      const node = await renderStill(at);
      const blob = await captureSlide(node);
      told(await shareImages([blob], `madregot-${story.birthday}-${slides[at].key}`));
    } catch {
      setNotice('לא הצלחנו להכין את התמונה');
    } finally {
      setExporting(null); setBusy(false);
    }
  };
  shareOneRef.current = shareOne;
  shareAllRef.current = async () => {
    setBusyAll(true); setNotice(null);
    try {
      const blobs: Blob[] = [];
      for (let i = 0; i < slides.length; i++) blobs.push(await captureSlide(await renderStill(i)));
      told(await shareImages(blobs, `madregot-${story.birthday}`), true);
    } catch {
      setNotice('לא הצלחנו להכין את התמונות');
    } finally {
      setExporting(null); setBusyAll(false);
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
      // Safari opens the share sheet only right after a tap, and the recording took
      // longer than that — so the ready video waits for one more tap.
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
    const r = await shareVideo(videoFile, `madregot-${story.birthday}`);
    if (r === 'downloaded') { setNotice('הסרטון נשמר'); setTimeout(() => setNotice(null), 2600); }
    if (r !== 'cancelled') setVideoFile(null);
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = useCallback((d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);

  useEffect(() => { setMounted(true); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, []);
  // The slides are laid out for a full-height phone (~820px of story). A Safari tab is
  // shorter, so the content scales down to fit rather than running off the bottom.
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const measure = () => setFit(Math.max(0.7, Math.min(1, window.innerHeight / 820)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // The last screen stays: it is where the share buttons are.
    if (at < slides.length - 1 && !busy && !busyAll) timer.current = setTimeout(() => go(1), slides[at].dur);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [at, slides, go, busy, busyAll]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(1);
      if (e.key === 'ArrowRight') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const t = variant.theme;
  const themeVars = { ['--tint' as string]: t.tint, ['--sat' as string]: t.sat, ['--c1' as string]: t.c1, ['--c2' as string]: t.c2, ['--c3' as string]: t.c3, ['--c4' as string]: t.c4, ['--gx' as string]: t.gx } as React.CSSProperties;
  if (!mounted) return null;
  return createPortal(
    <div className="ys" role="dialog" aria-modal="true" aria-label={`השנה של ${name}`} dir="rtl" style={{ ['--fit' as string]: fit, ...themeVars }}>
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
          {Math.abs(i - at) <= 1 && <SlideBody key={i === at ? `live-${at}` : 'idle'} live={i === at}>{sl.node(i === at)}</SlideBody>}
        </section>
      ))}
      {at < slides.length - 1 && <>
        <button type="button" className="tap l" aria-label="הבא" onClick={() => go(1)} />
        <button type="button" className="tap r" aria-label="הקודם" onClick={() => go(-1)} />
      </>}
      {at === slides.length - 1 && <button type="button" className="tap r back" aria-label="הקודם" onClick={() => go(-1)} />}
      {at < slides.length - 1 && (
        <button type="button" className="ys-share" onClick={() => void shareOne()} disabled={busy}>
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
        <div ref={exportRef} className="ys ys-export still" dir="rtl" aria-hidden style={{ width: EXPORT_W, height: EXPORT_H, ['--fit' as string]: EXPORT_H / 820, ...themeVars }}>
          {/* The poster carries its own mark. */}
          {slides[exporting].key !== 'summary' && (
            <div className="top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/wordmark-white.png" alt="" />
            </div>
          )}
          <section className={`sl show s-${slides[exporting].key}`}>{slides[exporting].node(false)}</section>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Remounted every time its slide comes up, so the entrance animations play again. */
function SlideBody({ children }: { live: boolean; children: React.ReactNode }) {
  return <>{children}</>;
}

/** 13 small month calendars, Sunday first: blue = ran, empty = rest, orange = the streak. */
function MonthGrid({ story, ranLabel }: { story: BirthdayStory; ranLabel: string }) {
  const s = story.stats;
  const ran = new Set(s.runDates);
  const cards: React.ReactNode[] = [];
  let [y, mo] = s.from.split('-').map(Number);
  const [ey, em] = s.to.split('-').map(Number);
  let idx = 0;
  while (y < ey || (y === ey && mo <= em)) {
    const first = new Date(Date.UTC(y, mo - 1, 1, 12));
    const days = new Date(Date.UTC(y, mo, 0, 12)).getUTCDate();
    const cells: React.ReactNode[] = Array.from({ length: first.getUTCDay() }, (_, i) => <i key={`l${i}`} className="x" />);
    let r = 0, tot = 0;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso < s.from || iso > s.to) { cells.push(<i key={d} className="x" />); continue; }
      tot++;
      const on = ran.has(iso);
      if (on) r++;
      const st = on && s.streak && iso >= s.streak.from && iso <= s.streak.to && s.streak.days >= 3;
      cells.push(<i key={d} className={st ? 'st' : on ? 'on' : 'off'} />);
    }
    const yy = idx === 0 || (y === ey && mo === em) ? ` ${String(y).slice(2)}` : '';
    cards.push(<div key={`${y}-${mo}`} className="mc" style={{ ['--r' as string]: idx }}><p><b>{MON_SHORT[mo - 1]}{yy}</b><span><bdi>{r}/{tot}</bdi></span></p><div>{cells}</div></div>);
    idx++;
    if (mo === 12) { y++; mo = 1; } else mo++;
  }
  return (
    <div className="cal4 rise d2">
      {cards}
      <div className="mc lg"><p><i className="on" />{ranLabel}</p><p><i className="off" />מנוחה</p>{s.streak && s.streak.days >= 3 && <p><i className="st" />הרצף, {s.streak.days} ימים</p>}</div>
    </div>
  );
}

function Poster({ story, photo, onShareThis, onShareAll, busy, busyAll, onVideo, busyVideo }: {
  story: BirthdayStory; photo: string | null; onShareThis: () => void; onShareAll: () => void; busy: boolean; busyAll: boolean;
  /** The whole story as one video — absent where the browser cannot record one. */
  onVideo?: () => void; busyVideo: boolean;
}) {
  const s = story.stats;
  const fm = s.bests.find((b) => b.key === 'fm');
  const hm = s.bests.find((b) => b.key === 'hm');
  const sec = (b: typeof fm) => (b && s.moment && b.activityId === s.moment.activityId ? s.moment.seconds : b?.seconds ?? 0);
  const grid: Array<[string, string, boolean?]> = [
    [n(s.runs), 'ריצות'], [n(s.runDates.length), 'ימים'],
    ...(s.streak && s.streak.days >= 3 ? [[String(s.streak.days), 'ימים ברצף'] as [string, string]] : []),
    ...(fm ? [[clock(sec(fm)), 'מרתון', true] as [string, string, boolean]] : []),
    ...(hm ? [[clock(sec(hm)), 'חצי מרתון', true] as [string, string, boolean]] : []),
    ...(s.longest ? [[String(s.longest.km), 'ק״מ הכי ארוכה'] as [string, string]] : []),
    [n(s.hours), 'שעות'],
  ].slice(0, 6) as Array<[string, string, boolean?]>;
  return (<>
    <div className="bg plain deep" />
    <div className="c poster-wrap"><div className="poster rise">
      <div className="pph">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo ? <img src={photo} alt="" /> : <div className="pph-empty" />}
        <div className="pphg" />
        <div className="ppt"><p>השנה של</p><h3>{story.name}</h3><span>מ־<bdi>{dmy(s.from)}</bdi> עד <bdi>{dmy(s.to)}</bdi></span></div>
      </div>
      <div className="pbig"><b><bdi>{n(s.km)}</bdi></b><u>ק״מ</u></div>
      <div className="pg">{grid.map(([v, l, ltr]) => <div key={l}><b dir={ltr ? 'ltr' : undefined}>{v}</b><small>{l}</small></div>)}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="pft"><img src="/images/wordmark-white.png" alt="" /><span>🎂 מזל טוב מכל המדרגות</span></div>
    </div>
    <div className="acts rise d2">
      {onVideo && <button type="button" className="v" onClick={onVideo} disabled={busyVideo}>🎬 סרטון לסטורי</button>}
      <button type="button" className="p" onClick={onShareThis} disabled={busy}>{busy ? 'מכין…' : 'שיתוף התמונה הזו לסטורי'}</button>
      <button type="button" onClick={onShareAll} disabled={busyAll}>{busyAll ? 'מכין את כל התמונות…' : 'שמירת כל התמונות'}</button>
    </div></div>
  </>);
}
