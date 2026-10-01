'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiHeaders, useApi } from '@/lib/api';
import { isPreviewing } from '@/lib/impersonation';
import { GROUP_HEX } from '@/lib/utils';
import { ShareSheet } from '@/components/ShareSheet';
import { fetchFeedItemByActivity } from '@/lib/feed-client';
import { withoutHeartRate, type FeedItem } from '@/lib/feed/project';
import { fmtPace, type Pack } from '@/lib/pack-stories/model';
import { readClock } from '@/lib/quality-session/clock';
import { useQualitySessionAccess } from '@/lib/quality-session/use-access';
import {
  fromMinutes, isNew, packRuns, runnersOf, shareTitle,
  type QsClock, type QsRunner, type QsSession, type SortKey,
} from '@/lib/quality-session/model';
import {
  mainSet, paceOver, parseParts, partLabel, repUnit, targetFor, PART_NAME,
  type Parsed, type Part, type PlanRep, type SetTarget,
} from '@/lib/quality-session/parts';
import './quality-session.css';

// The quality session for Instagram: on a quality morning, ONE runner per pack,
// shared the way that runner would share the run themselves, titled as the pack
// ("דבוקה 1 · 6×1000" — this is what pack 1 ran). Pick on a scatter of km against
// the main set's pace and a list under it (one row per runner), look at the run
// part by part against the plan, then the workout share editor opens on that
// run's own feed item. The super user's, and whoever has the "אינסטגרם" switch on
// the roles screen (lib/quality-session/access.ts); GET /api/quality-session
// answers 403 to anyone else. Design:
// ~/.cache/madregot/mockups/quality-session-v2.html.
//
// `?at=2026-09-29T08:00` makes it that moment (lib/quality-session/clock.ts):
// the day is that day, and a run not finished by then isn't there yet.

const REFRESH_MS = 60_000;
const COLOR: Record<0 | Pack, string> = { 0: '#8E8E93', 1: GROUP_HEX[0], 2: GROUP_HEX[1], 3: GROUP_HEX[2] };
const packName = (p: 0 | Pack) => (p ? `דבוקה ${p}` : 'בלי דבוקה');
const first = (n: string) => n.split(' ')[0] || n;
const initials = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
const km1 = (m: number) => (m / 1000).toFixed(1);
const clockText = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** A runner as the screen reads them: the parts of their main run, its main set, and what the plan asked of it. */
interface Seen {
  runner: QsRunner;
  parsed: Parsed;
  main: Part | null;
  /** The main set's pace, the scatter's height; null without a set. */
  key: number | null;
  tgt: SetTarget | null;
  /** One pace for the whole set from the plan (the 4 × 45″ descending ones averaged). */
  tgtPace: number | null;
  plan: PlanRep[] | undefined;
  /** The pack's plan had a fartlek (fast km, float km) and this run has none. */
  noFart: boolean;
}

function see(runner: QsRunner, plan: PlanRep[] | undefined): Seen {
  const parsed = parseParts(runner.run.laps);
  const main = mainSet(parsed.parts);
  const tgt = main ? targetFor(main, plan) : null;
  const planFart = !!plan?.some(x => x.unit === 'distance' && Math.abs(x.value - 1000) <= 60 && x.float != null);
  return {
    runner, parsed, main, plan, key: main ? main.p : null, tgt, tgtPace: tgt?.paces.length ? mean(tgt.paces) : null,
    noFart: planFart && !parsed.parts.some(p => p.unit === 'fart'),
  };
}

function vsTarget(d: number) {
  if (Math.abs(d) < 1 || (d > 0 && d <= 3)) return { t: 'ביעד', ok: true };
  return d < 0 ? { t: `${Math.round(-d)}″ מהר מהיעד`, ok: true } : { t: `${Math.round(d)}″ לאט מהיעד`, ok: false };
}

export default function QualitySessionPage() {
  const allowed = useQualitySessionAccess() && !isPreviewing();
  const [clock, setClock] = useState<QsClock | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    setClock(readClock());
    setAsked(new URLSearchParams(window.location.search).get('date'));
  }, []);
  // The real clock moves on its own; a travelled one stays at the moment asked for.
  useEffect(() => {
    if (!clock || clock.travelling) return;
    const t = setInterval(() => setClock(readClock()), REFRESH_MS);
    return () => clearInterval(t);
  }, [clock]);

  const date = (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null) || clock?.date || null;
  const { data: sess, error } = useApi<QsSession>(
    allowed && date ? `/api/quality-session?date=${date}` : null,
    { refreshInterval: clock?.travelling ? 0 : REFRESH_MS },
  );
  // On another day than the clock's, the whole morning is over.
  const nowMin = clock && date === clock.date ? clock.minutes : 24 * 60;

  const [pack, setPack] = useState<0 | Pack>(1);
  const [sortBy, setSortBy] = useState<SortKey>('reps');
  const [zoom, setZoom] = useState(true);
  const [sel, setSel] = useState<Partial<Record<0 | Pack, string>>>({});
  const [done, setDone] = useState<Partial<Record<0 | Pack, boolean>>>({});
  const [detail, setDetail] = useState(false);
  const [shareItem, setShareItem] = useState<FeedItem | null>(null);
  const [opening, setOpening] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = (t: string) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const top = () => rootRef.current?.scrollIntoView({ block: 'start' });

  const packs = useMemo(() => {
    if (!sess) return [] as Array<0 | Pack>;
    const ps: Array<0 | Pack> = [1, 2, 3];
    return packRuns(sess, 0, nowMin).length ? [...ps, 0 as const] : ps;
  }, [sess, nowMin]);
  const byPack = useMemo(() => {
    const out: Partial<Record<0 | Pack, Seen[]>> = {};
    if (sess) for (const p of [0, 1, 2, 3] as Array<0 | Pack>) out[p] = runnersOf(packRuns(sess, p, nowMin)).map(r => see(r, p ? sess.plan[p] : undefined));
    return out;
  }, [sess, nowMin]);
  const seen = useMemo(() => byPack[pack] || [], [byPack, pack]);
  const sorted = useMemo(() => seen.slice().sort(sortBy === 'km'
    ? (a, b) => b.runner.run.dist - a.runner.run.dist
    : (a, b) => (a.key ?? Infinity) - (b.key ?? Infinity) || b.runner.run.dist - a.runner.run.dist), [seen, sortBy]);
  const picked = seen.find(s => s.runner.run.id === sel[pack]) || null;

  if (!allowed) return null;

  const title = sess?.workout?.name ? <><bdi dir="ltr">{sess.workout.name}</bdi> · {sess.label.replace(/^אימון /, '')}</> : sess?.label;
  const runners = packs.reduce<number>((n, p) => n + (byPack[p]?.length || 0), 0);

  const openShare = async () => {
    if (!picked || opening) return;
    setOpening(true);
    try {
      const { item } = await fetchFeedItemByActivity(picked.runner.run.id);
      if (!item?.activity) throw new Error('no activity');
      // The runner's own card, heart rate out as on the pack stories, the title the pack's.
      const bare = withoutHeartRate(item);
      setShareItem({ ...bare, activity: { ...bare.activity!, activityName: shareTitle(pack, sess?.workout ?? null) } });
    } catch {
      toast('לא הצלחתי לפתוח את הריצה הזו');
    } finally {
      setOpening(false);
    }
  };
  // The 7:30 push, sent to his own phone now, opening at the moment the screen is at.
  const sendPush = async () => {
    if (!date || pushing) return;
    setPushing(true);
    try {
      const at = clock?.travelling ? `${clock.date}T${fromMinutes(clock.minutes)}` : undefined;
      const res = await fetch('/api/quality-session', {
        method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ date, at }),
      });
      toast(res.ok ? '🔔 נשלחה לטלפון שלך' : res.status === 404 ? 'זה לא יום של אימון איכות' : 'לא הצלחתי לשלוח');
    } catch {
      toast('לא הצלחתי לשלוח');
    } finally {
      setPushing(false);
    }
  };
  const closeShare = () => {
    setShareItem(null);
    const next = { ...done, [pack]: true };
    setDone(next);
    const nxt = packs.find(p => !next[p] && byPack[p]?.length);
    toast(nxt != null ? `✓ ${packName(pack)}. עוברים ל${packName(nxt)}.` : '✓ כל הדבוקות');
    if (nxt != null) setPack(nxt);
    setDetail(false);
    top();
  };
  const pick = (id: string) => setSel(s => ({ ...s, [pack]: id }));

  return (
    <div ref={rootRef} className="qsx" dir="rtl">
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {detail && picked ? (
        <Detail s={picked} pack={pack} onBack={() => { setDetail(false); top(); }} onShare={openShare} opening={opening} />
      ) : (
        <>
          <Link href="/feed" className="back">› פיד</Link>
          <h1 className="ttl">{title || 'אימון האיכות'}</h1>
          {clock?.travelling && (
            <div className="travel">
              ⏱ כאילו השעה <bdi dir="ltr">{fromMinutes(clock.minutes)}</bdi> ב-<bdi dir="ltr">{clock.date.split('-').reverse().slice(0, 2).join('.')}</bdi>
              <a href="?at=off">לחזור לעכשיו</a>
            </div>
          )}
          {sess?.workout && (
            <button className="try" disabled={pushing} onClick={sendPush}>
              🔔 {pushing ? 'שולח…' : 'לשלוח לי את ההתראה של 7:30'}
            </button>
          )}
          {sess && !sess.workout && <div className="note">לפי התוכנית זה לא יום של אימון איכות. אפשר עדיין לבחור ולשתף.</div>}
          {sess && (
            <div className="live"><i />{clock?.travelling ? 'נכון לשעה הזו' : 'מתעדכן'} · {runners} רצים סיימו</div>
          )}
          {/* Only before the first answer: a refresh keeps the morning on screen. */}
          {!sess && !error && <div className="note">טוען…</div>}
          {error && !sess && <div className="note">לא הצלחתי לטעון את האימון.</div>}
          {sess && (
            <>
              <div className="tabs">
                {packs.map(p => (
                  <button key={p} className={p === pack ? 'on' : ''} style={{ ['--c' as string]: COLOR[p] }} onClick={() => setPack(p)}>
                    <i />{p ? p : 'בלי'} · {byPack[p]?.length || 0}{done[p] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
              {seen.length === 0 ? (
                <div className="card empty">עוד אין ריצות שהסתיימו ב{packName(pack)}.</div>
              ) : (
                <>
                  <Scatter seen={seen} pack={pack} zoom={zoom} setZoom={setZoom} sel={sel[pack]} onPick={pick} />
                  <div className="sort">
                    <button className={sortBy === 'reps' ? 'on f' : ''} onClick={() => setSortBy('reps')}>⚡ לפי הקצב</button>
                    <button className={sortBy === 'km' ? 'on k' : ''} onClick={() => setSortBy('km')}>📏 לפי ק״מ</button>
                  </div>
                  <div className="card rows">
                    {sorted.map((s, i) => <Row key={s.runner.run.id} s={s} i={i} seen={seen} on={sel[pack] === s.runner.run.id} onPick={() => pick(s.runner.run.id)} />)}
                  </div>
                </>
              )}
              <div className="foot">
                <div className="done">
                  {packs.map(p => {
                    const who = byPack[p]?.find(s => s.runner.run.id === sel[p]);
                    return <span key={p} className={done[p] ? 'ok' : ''}>{done[p] ? '✓ ' : ''}{packName(p)}{who ? `: ${first(who.runner.run.name)}` : ''}</span>;
                  })}
                </div>
                <button className="btn" disabled={!picked} onClick={() => { setDetail(true); top(); }}>
                  {picked ? <>לאימון של <bdi dir="ltr">{first(picked.runner.run.name)}</bdi> ›</> : `בחר רץ ב${packName(pack)}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {shareItem && <ShareSheet subject={{ kind: 'workout', item: shareItem }} onClose={closeShare} />}
    </div>
  );
}

function crowns(seen: Seen[]) {
  const topK = seen.reduce((a, b) => (b.runner.run.dist > a.runner.run.dist ? b : a));
  const keyed = seen.filter(s => s.key != null);
  const topF = keyed.length ? keyed.reduce((a, b) => ((b.key as number) < (a.key as number) ? b : a)) : null;
  return { topK, topF };
}

/** The pack's line on the scatter: what the plan asked of the main set, as most of the pack ran it. */
function packTarget(seen: Seen[]): number | null {
  const ts = seen.map(s => s.tgtPace).filter((t): t is number => t != null).sort((a, b) => a - b);
  return ts.length ? ts[ts.length >> 1] : null;
}

// The scatter, in an assumed box: names are placed only where they fit, and that is decided in pixels.
const SC_W = 330, SC_H = 280;

function Scatter({ seen, pack, zoom, setZoom, sel, onPick }: {
  seen: Seen[]; pack: 0 | Pack; zoom: boolean; setZoom: (z: boolean) => void; sel?: string; onPick: (id: string) => void;
}) {
  const pts = seen.filter(s => s.key != null);
  if (!pts.length) return <div className="card empty">אין עדיין ריצות עם סט חזרות ב{packName(pack)}.</div>;
  const xs = pts.map(s => s.runner.run.dist / 1000).sort((a, b) => a - b);
  const ys = pts.map(s => s.key as number).sort((a, b) => a - b);
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
  // Zoomed on the crowd: the far ones are pinned to the edge, dashed.
  let [x0, x1] = zoom ? [q(xs, 0.15), q(xs, 0.9)] : [xs[0], xs[xs.length - 1]];
  let [y0, y1] = zoom ? [q(ys, 0.1), q(ys, 0.85)] : [ys[0], ys[ys.length - 1]];
  const tgt = packTarget(seen);
  if (tgt != null) { y0 = Math.min(y0, tgt); y1 = Math.max(y1, tgt); }
  const px = (x1 - x0) * 0.12 || 1, py = (y1 - y0) * 0.15 || 5;
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = (v: number) => Math.min(Math.max((v - x0) / (x1 - x0), 0), 1);
  const Y = (v: number) => Math.min(Math.max((y1 - v) / (y1 - y0), 0), 1);
  const at = (s: Seen) => ({ x: X(s.runner.run.dist / 1000), y: Y(s.key as number) });
  // Drawn inside a margin, so a dot pinned to an edge stays off the axis and its numbers.
  const pct = (v: number) => `${5 + v * 90}%`;
  const isOut = ({ x, y }: { x: number; y: number }) => x === 0 || x === 1 || y === 0 || y === 1;
  const hidden = pts.filter(s => isOut(at(s))).length;

  const yStep = y1 - y0 > 60 ? 15 : 5, xStep = x1 - x0 > 8 ? 2 : 1;
  const yTicks: number[] = [], xTicks: number[] = [];
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) yTicks.push(v);
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1; v += xStep) xTicks.push(v);

  // Names where they fit, the picked one first and always.
  const placed: number[][] = [];
  const names: Array<{ s: Seen; x: number; y: number }> = [];
  for (const s of pts.slice().sort((a, b) => Number(b.runner.run.id === sel) - Number(a.runner.run.id === sel))) {
    const p = at(s), x = (0.05 + p.x * 0.9) * SC_W, y = (0.95 - p.y * 0.9) * SC_H + 20;
    const w = first(s.runner.run.name).length * 6.5 + 8;
    const box = [x - w / 2, y, x + w / 2, y + 14];
    const hit = placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))
      || pts.some(o => o !== s && Math.abs((0.05 + at(o).x * 0.9) * SC_W - x) < 18 + w / 2 && Math.abs((0.95 - at(o).y * 0.9) * SC_H - (y + 7)) < 16);
    if (hit && s.runner.run.id !== sel) continue;
    placed.push(box);
    names.push({ s, x: p.x, y });
  }

  return (
    <div className="card">
      <div className="zoom">
        <button className={zoom ? 'on' : ''} onClick={() => setZoom(true)}>🔍 זום</button>
        <button className={zoom ? '' : 'on'} onClick={() => setZoom(false)}>הכול</button>
        <span>{zoom && hidden ? `${hidden} בשוליים` : `${pts.length} רצים`}</span>
      </div>
      <div className="axy">↑ מהיר יותר בסט המרכזי</div>
      <div className="sc" style={{ height: SC_H }}>
        {yTicks.map(v => (
          <span key={`y${v}`}>
            <div className="grid" style={{ bottom: pct(Y(v)) }} />
            <span className="gl" style={{ bottom: pct(Y(v)) }}>{fmtPace(v)}</span>
          </span>
        ))}
        {xTicks.map(v => <span key={`x${v}`} className="xl" style={{ left: pct(X(v)) }}>{v}</span>)}
        {tgt != null && <div className="tgt" style={{ bottom: pct(Y(tgt)) }}><span>יעד {fmtPace(tgt)}</span></div>}
        {pts.map(s => {
          const p = at(s);
          return (
            <button key={s.runner.run.id} className={`dot ${sel === s.runner.run.id ? 'on' : ''} ${isOut(p) ? 'out' : ''}`}
              style={{ ['--c' as string]: COLOR[s.runner.run.pack], left: pct(p.x), bottom: pct(p.y) }}
              onClick={() => onPick(s.runner.run.id)} aria-label={s.runner.run.name}>
              {initials(s.runner.run.name)}
            </button>
          );
        })}
        {names.map(({ s, x, y }) => <span key={`n${s.runner.run.id}`} className="nm" style={{ left: pct(x), top: y }}>{first(s.runner.run.name)}</span>)}
      </div>
      <div className="axx">יותר ק״מ →</div>
    </div>
  );
}

function Row({ s, i, seen, on, onPick }: { s: Seen; i: number; seen: Seen[]; on: boolean; onPick: () => void }) {
  const { topK, topF } = crowns(seen);
  const r = s.runner.run;
  const sets = s.parsed.parts.filter(p => p.kind === 'set');
  return (
    <button className={`r ${on ? 'on' : ''}`} onClick={onPick}>
      <div className="top">
        <span className="rk">{i + 1}</span>
        <b className="n" dir="ltr">{r.name}</b>
        {s === topF && <span className="crown f">👑 הכי מהר</span>}
        {s === topK && <span className="crown k">👑 הכי הרבה</span>}
        {isNew(r) && <span className="new">חדש</span>}
        <span className="km">{km1(r.dist)} ק״מ</span>
      </div>
      <div className="parts">
        {sets.map((p, k) => <span key={k} className={`chip ${p === s.main ? 'main' : ''}`}>{partLabel(p)}</span>)}
        {!sets.length ? <span className="chip miss">{s.noFart ? 'בלי הפארטלק' : r.laps.length > 1 ? 'בלי סט חזרות' : 'בלי הקפות'}</span>
          : s.noFart && <span className="chip miss">בלי הפארטלק</span>}
      </div>
      {s.main && <MainBars s={s} />}
    </button>
  );
}

function MainBars({ s }: { s: Seen }) {
  const main = s.main as Part;
  const fart = main.unit === 'fart';
  const reps = main.reps.map(l => l.p);
  const t = s.tgtPace;
  const ref = t ?? main.p;
  let lo = Math.min(...reps, ref) - 4, hi = Math.max(...reps, ref) + 4;
  if (hi - lo < 30) { const c = (hi + lo) / 2; lo = c - 15; hi = c + 15; }
  const H = (p: number) => 18 + ((hi - p) / (hi - lo)) * 82;
  const fl = fart ? paceOver(main.floats) : null;
  const vs = t != null ? vsTarget(main.p - t) : null;
  return (
    <>
      <div className="bars">
        {reps.map((p, k) => <u key={k} className={p > ref + 8 ? 'slow' : ''} style={{ height: `${H(p)}%` }} />)}
        {t != null && <div className="tl" style={{ bottom: `${H(t)}%` }} />}
      </div>
      <div className="vs">
        <span>{fart ? 'מהיר' : 'ממוצע'} <b>{fmtPace(main.p)}</b>{vs && <> <span className={vs.ok ? 'ok' : 'bad'}>({vs.t})</span></>}</span>
        {fl != null && <span>משוחרר <b>{fmtPace(fl)}</b></span>}
        <span>{s.tgt ? `${main.reps.length}/${s.tgt.planned}` : main.reps.length} {fart ? 'ק״מ מהירים' : 'חזרות'}</span>
      </div>
    </>
  );
}

/** "10×1k", "4×45″", "חימום": a part's name in the strip, where space is short. */
function shortLabel(p: Part) {
  if (p.kind !== 'set') return PART_NAME[p.kind];
  return `${p.reps.length}×${p.unit === 'fart' ? '1k' : repUnit(p).replace(' מ׳', 'm').replace(' ק״מ', 'k')}`;
}
// The strip's width, assumed, to decide which labels fit.
const STRIP_W = 330;

function Detail({ s, pack, onBack, onShare, opening }: {
  s: Seen; pack: 0 | Pack; onBack: () => void; onShare: () => void; opening: boolean;
}) {
  const [part, setPart] = useState<number | null>(null);
  const run = s.runner.run;
  const P = s.parsed.parts;
  const tot = P.reduce((a, p) => a + p.s, 0) || 1;
  const fl = P.map(p => Math.max(p.s / tot, 0.05)), flSum = fl.reduce((a, x) => a + x, 0);
  const show = part == null ? P.map((_, k) => k) : [part];
  const mainLbl = !s.main ? 'קצב בסט המרכזי' : s.main.unit === 'fart' ? 'קצב בק״מים המהירים' : `קצב ב-${partLabel(s.main)}`;
  return (
    <>
      <button className="back" onClick={onBack}>› {packName(pack)}</button>
      <div className="hd">
        <div className="av" style={{ background: COLOR[pack] }}>{initials(run.name)}</div>
        <div>
          <b dir="ltr">{run.name}</b>
          <div className="sub">{packName(pack)} · סיים <bdi dir="ltr">{run.end}</bdi></div>
        </div>
      </div>
      <div className="kp">
        <div><b>{(run.dist / 1000).toFixed(2)}</b><span>ק״מ</span></div>
        <div><b>{s.key != null ? fmtPace(s.key) : '–'}</b><span>{mainLbl}</span></div>
        <div><b>{clockText(run.dur)}</b><span>זמן · קצב כולל <bdi dir="ltr">{fmtPace(run.pace)}</bdi></span></div>
      </div>
      {P.length ? (
        <>
          <div className="pstrip">
            {P.map((p, k) => {
              const t = shortLabel(p), w = (fl[k] / flSum) * STRIP_W;
              return (
                <button key={k} className={`${p.kind === 'set' ? `s${p === s.main ? ' main' : ''}` : 'w'} ${part === k ? 'on' : ''}`}
                  style={{ flex: fl[k] }} onClick={() => setPart(part === k ? null : k)} aria-label={partLabel(p)}>
                  <span dir="ltr">{t.length * 6.2 + 6 < w ? t : ''}</span>
                </button>
              );
            })}
          </div>
          <div className="stripl">
            {part == null ? 'נוגעים בחלק כדי לראות רק אותו' : <button onClick={() => setPart(null)}>כל החלקים</button>}
          </div>
          {show.map(k => <PartCard key={k} s={s} p={P[k]} />)}
        </>
      ) : <div className="note">אין הקפות בריצה הזו, אז אי אפשר לחלק אותה לחלקים.</div>}
      <div className="foot">
        <button className="btn" disabled={opening} onClick={onShare}>{opening ? '…' : '📸 לבחור איך לשתף'}</button>
      </div>
    </>
  );
}

function PartCard({ s, p }: { s: Seen; p: Part }) {
  if (p.kind !== 'set') {
    return (
      <div className="card part">
        <h3>{PART_NAME[p.kind]} <small>{km1(p.m)} ק״מ</small></h3>
        <div className="sum"><span>קצב <b>{fmtPace(p.p)}</b></span><span>זמן <b>{clockText(p.s)}</b></span></div>
      </div>
    );
  }
  const fart = p.unit === 'fart';
  const tgt = p === s.main ? s.tgt : targetFor(p, s.plan);
  // A column per rep; in a fartlek, the float after each fast km is written under it.
  const cols: Array<{ p: number; after?: number }> = [];
  if (fart) {
    for (const l of s.parsed.laps.slice(p.from, p.to + 1)) {
      const role = s.parsed.role[l.i];
      if (role === 'F') cols.push({ p: l.p });
      else if (role === 'f' && cols.length) cols[cols.length - 1].after = l.p;
    }
  } else for (const l of p.reps) cols.push({ p: l.p });
  const best = Math.min(...cols.map(c => c.p));
  const paces = tgt?.paces || [];
  const one = paces.length > 0 && paces.every(x => x === paces[0]) ? paces[0] : null;
  const all = [...cols.map(c => c.p), ...(one != null ? [one] : [])];
  let lo = Math.min(...all) - 6, hi = Math.max(...all) + 6;
  if (hi - lo < 40) { const c = (hi + lo) / 2; lo = c - 20; hi = c + 20; }
  const H = (v: number) => 12 + ((hi - v) / (hi - lo)) * 70;
  const fl = fart ? paceOver(p.floats) : null;
  const sub = fart ? 'ק״מ מהיר, ק״מ משוחרר' : p.rest ? `עם ${clockText(p.rest / Math.max(1, p.reps.length))} הליכה` : '';
  return (
    <div className="card part">
      <h3>{partLabel(p)} {sub && <small>{sub}</small>}</h3>
      <div className="sum">
        <span>{fart ? 'מהיר' : 'ממוצע'} <b>{fmtPace(p.p)}</b></span>
        {fl != null && <span>משוחרר <b>{fmtPace(fl)}</b></span>}
        {paces.length > 1 && one == null && <span>בתוכנית: <bdi dir="ltr">{paces.map(fmtPace).join(' → ')}</bdi></span>}
        {tgt && <span>{p.reps.length}/{tgt.planned} {fart ? 'ק״מ מהירים' : 'חזרות'}</span>}
      </div>
      <div className="pb">
        {cols.map((c, k) => (
          <div key={k} className="c">
            <em>{fmtPace(c.p)}</em>
            <u className={c.p === best ? 'best' : ''} style={{ height: `${H(c.p)}%` }} />
            <s>{c.after != null ? fmtPace(c.after) : k + 1}</s>
          </div>
        ))}
        {one != null && <div className="tl" style={{ bottom: `${H(one)}%` }}><span>יעד {fmtPace(one)}</span></div>}
      </div>
      {fart
        ? <div className="leg"><span><i />הק״מ המהיר</span><span className="mute">מתחת: הק״מ המשוחרר שאחריו{tgt?.float ? <> (יעד <bdi dir="ltr">{fmtPace(tgt.float)}</bdi>)</> : null}</span></div>
        : <div style={{ height: 16 }} />}
    </div>
  );
}
