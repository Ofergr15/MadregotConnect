'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiHeaders, useApi } from '@/lib/api';
import { useIsSuperUser, isPreviewing } from '@/lib/impersonation';
import { GROUP_HEX } from '@/lib/utils';
import { ShareSheet } from '@/components/ShareSheet';
import { fetchFeedItemByActivity } from '@/lib/feed-client';
import { withoutHeartRate, type FeedItem } from '@/lib/feed/project';
import { fmtKm, fmtPace, type Pack } from '@/lib/pack-stories/model';
import { readClock } from '@/lib/quality-session/clock';
import {
  fromMinutes, isNew, packRuns, shareTitle, sortRuns,
  type QsClock, type QsLap, type QsRun, type QsSession, type SortKey,
} from '@/lib/quality-session/model';
import './quality-session.css';

// The quality session for Instagram: on a quality morning, ONE runner per pack,
// shared the way that runner would share the run themselves, titled as the pack
// ("דבוקה 1 · 6×1000" — this is what pack 1 ran). Pick on a scatter of km against
// rep pace and a list under it, look at the run lap by lap, then the workout share
// editor opens on that run's own feed item. The super user's alone while it is
// tried out; GET /api/quality-session answers 403 to anyone else. Design:
// ~/.cache/madregot/mockups/quality-session-prototype.html.
//
// `?at=2026-09-29T08:00` makes it that moment (lib/quality-session/clock.ts):
// the day is that day, and a run not finished by then isn't there yet.

const REFRESH_MS = 60_000;
const COLOR: Record<0 | Pack, string> = { 0: '#8E8E93', 1: GROUP_HEX[0], 2: GROUP_HEX[1], 3: GROUP_HEX[2] };
const packName = (p: 0 | Pack) => (p ? `דבוקה ${p}` : 'בלי דבוקה');
const first = (n: string) => n.split(' ')[0] || n;
const initials = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
const lapPace = ([m, s]: QsLap) => (m > 0 ? (s / m) * 1000 : 0);
const reps = (r: QsRun) => r.laps.filter(l => l[2] === 'rep');
const fast = (r: QsRun) => r.repPace ?? r.pace;
const clockText = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export default function QualitySessionPage() {
  const isSuper = useIsSuperUser();
  const allowed = isSuper && !isPreviewing();
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
  const { data: sess, error, isLoading } = useApi<QsSession>(
    allowed && date ? `/api/quality-session?date=${date}` : null,
    { refreshInterval: clock?.travelling ? 0 : REFRESH_MS },
  );
  // On another day than the clock's, the whole morning is over.
  const nowMin = clock && date === clock.date ? clock.minutes : 24 * 60;

  const [pack, setPack] = useState<0 | Pack>(1);
  const [sortBy, setSortBy] = useState<SortKey>('km');
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
  const rs = useMemo(() => (sess ? packRuns(sess, pack, nowMin) : []), [sess, pack, nowMin]);
  const sorted = useMemo(() => sortRuns(rs, sortBy), [rs, sortBy]);
  const picked = rs.find(r => r.id === sel[pack]) || null;

  if (!allowed) return null;

  const title = sess?.workout?.name ? <><bdi dir="ltr">{sess.workout.name}</bdi> · {sess.label.replace(/^אימון /, '')}</> : sess?.label;
  const finished = sess ? packs.reduce<number>((n, p) => n + packRuns(sess, p, nowMin).length, 0) : 0;

  const openShare = async () => {
    if (!picked || opening) return;
    setOpening(true);
    try {
      const { item } = await fetchFeedItemByActivity(picked.id);
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
    const nxt = packs.find(p => !next[p] && sess && packRuns(sess, p, nowMin).length);
    toast(nxt != null ? `✓ ${packName(pack)}. עוברים ל${packName(nxt)}.` : '✓ כל הדבוקות');
    if (nxt != null) setPack(nxt);
    setDetail(false);
    top();
  };

  return (
    <div ref={rootRef} className="qsx" dir="rtl">
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {detail && picked ? (
        <Detail run={picked} pack={pack} rs={rs} onBack={() => { setDetail(false); top(); }} onShare={openShare} opening={opening} />
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
            <div className="live"><i />{clock?.travelling ? 'נכון לשעה הזו' : 'מתעדכן'} · {finished} סיימו</div>
          )}
          {isLoading && <div className="note">טוען…</div>}
          {error && <div className="note">לא הצלחתי לטעון את האימון.</div>}
          {sess && (
            <>
              <div className="tabs">
                {packs.map(p => (
                  <button key={p} className={p === pack ? 'on' : ''} style={{ ['--c' as string]: COLOR[p] }} onClick={() => setPack(p)}>
                    <i />{p ? p : 'בלי'} · {packRuns(sess, p, nowMin).length}{done[p] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
              {rs.length === 0 ? (
                <div className="card empty">עוד אין ריצות שהסתיימו ב{packName(pack)}.</div>
              ) : (
                <>
                  <div className="card"><Scatter rs={rs} sel={sel[pack]} onPick={id => setSel(s => ({ ...s, [pack]: id }))} /></div>
                  <div className="sort">
                    <button className={sortBy === 'km' ? 'on k' : ''} onClick={() => setSortBy('km')}>📏 לפי ק״מ</button>
                    <button className={sortBy === 'reps' ? 'on f' : ''} onClick={() => setSortBy('reps')}>⚡ לפי החזרות</button>
                  </div>
                  <div className="card">
                    {sorted.map((r, i) => <Row key={r.id} r={r} i={i} rs={rs} on={sel[pack] === r.id} onPick={() => setSel(s => ({ ...s, [pack]: r.id }))} />)}
                  </div>
                </>
              )}
              <div className="foot">
                <div className="done">
                  {packs.map(p => {
                    const who = packRuns(sess, p, nowMin).find(r => r.id === sel[p]);
                    return <span key={p} className={done[p] ? 'ok' : ''}>{done[p] ? '✓ ' : ''}{packName(p)}{who ? `: ${first(who.name)}` : ''}</span>;
                  })}
                </div>
                <button className="btn" disabled={!picked} onClick={() => { setDetail(true); top(); }}>
                  {picked ? <>לאימון של <bdi dir="ltr">{first(picked.name)}</bdi> ›</> : `בחר רץ ב${packName(pack)}`}
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

function crowns(rs: QsRun[]) {
  const topK = rs.reduce((a, b) => (b.dist > a.dist ? b : a));
  const topF = rs.reduce((a, b) => (fast(b) < fast(a) ? b : a));
  return { topK, topF };
}

function Scatter({ rs, sel, onPick }: { rs: QsRun[]; sel?: string; onPick: (id: string) => void }) {
  const { topK, topF } = crowns(rs);
  const ds = rs.map(r => r.dist), ps = rs.map(fast);
  const [mnD, mxD, mnP, mxP] = [Math.min(...ds), Math.max(...ds), Math.min(...ps), Math.max(...ps)];
  return (
    <div className="sc">
      <span className="corner">↗ גם הרבה וגם מהר</span>
      <span className="ax-x">יותר ק״מ ←</span>
      <span className="ax-y">מהיר יותר בחזרות ←</span>
      {rs.map(r => {
        const x = mxD > mnD ? 8 + (86 * (r.dist - mnD)) / (mxD - mnD) : 50;
        const y = mxP > mnP ? 8 + (84 * (mxP - fast(r))) / (mxP - mnP) : 50;
        const c = r === topK && r === topF ? 'both' : r === topK ? 'km' : r === topF ? 'fs' : '';
        return (
          <button key={r.id} className={`dot ${c} ${sel === r.id ? 'on' : ''}`} style={{ left: `${x}%`, bottom: `${y}%` }} onClick={() => onPick(r.id)}>
            <i>{initials(r.name)}</i><small>{first(r.name)}</small>
          </button>
        );
      })}
    </div>
  );
}

function Row({ r, i, rs, on, onPick }: { r: QsRun; i: number; rs: QsRun[]; on: boolean; onPick: () => void }) {
  const { topK, topF } = crowns(rs);
  const maxD = Math.max(...rs.map(x => x.dist));
  const rp = reps(r).map(lapPace);
  const [mn, mx] = [Math.min(...rp), Math.max(...rp)];
  return (
    <button className={`r ${on ? 'on' : ''}`} onClick={onPick}>
      <span className="rk">{i + 1}</span>
      <div>
        <div className="nm">
          <b dir="ltr">{r.name}</b>
          {r === topK && <span className="crown k">👑 הכי הרבה</span>}
          {r === topF && <span className="crown f">👑 הכי מהר</span>}
          {isNew(r) && <span className="new">חדש</span>}
        </div>
        <div className="ln k"><span className="ic">📏</span><div className="tr"><div style={{ width: `${(100 * r.dist) / maxD}%` }} /></div><span className="val">{fmtKm(r.dist)} <small>ק״מ</small></span></div>
        <div className="ln f">
          <span className="ic">⚡</span>
          {rp.length ? (
            <div className="strip">{rp.map((p, k) => <i key={k} style={{ height: `${45 + (55 * (mx - p)) / (mx - mn || 1)}%` }} />)}</div>
          ) : <div className="tr" />}
          <span className="val">{fmtPace(fast(r))} <small>/ק״מ</small></span>
        </div>
        {rp.length > 0 && <div className="reps-l" dir="ltr">{rp.map(p => fmtPace(p)).join(' · ')}</div>}
      </div>
    </button>
  );
}

function Detail({ run, pack, rs, onBack, onShare, opening }: {
  run: QsRun; pack: 0 | Pack; rs: QsRun[]; onBack: () => void; onShare: () => void; opening: boolean;
}) {
  const byKm = sortRuns(rs, 'km').indexOf(run) + 1;
  const byReps = sortRuns(rs, 'reps').indexOf(run) + 1;
  const laps = run.laps.length ? run.laps : [[run.dist, run.dur, 'easy'] as QsLap];
  const lp = laps.map(lapPace);
  const [mnP, mxP] = [Math.min(...lp), Math.max(...lp)];
  const tot = laps.reduce((a, l) => a + l[1], 0) || 1;
  const rp = reps(run);
  const best = rp.length ? Math.min(...rp.map(lapPace)) : null;
  return (
    <>
      <button className="back" onClick={onBack}>› {packName(pack)}</button>
      <div className="card det">
        <div className="who">
          <div className="av" style={{ background: COLOR[pack] }}>{initials(run.name)}</div>
          <div>
            <b dir="ltr">{run.name}</b>
            <div className="sub">📏 מקום {byKm} · ⚡ מקום {byReps}{rp.length ? ' בחזרות' : ''} · {packName(pack)} · סיים <bdi dir="ltr">{run.end}</bdi></div>
          </div>
        </div>
        <div className="grid">
          <div><b>{fmtKm(run.dist)}</b><span>ק״מ</span></div>
          <div><b>{run.repPace ? fmtPace(run.repPace) : '–'}</b><span>קצב חזרות</span></div>
          <div><b>{fmtPace(run.pace)}</b><span>קצב כללי</span></div>
          <div><b>{clockText(run.dur)}</b><span>זמן</span></div>
        </div>
        <div className="lbl">כל האימון, לפי ההקפות של השעון</div>
        <div className="lc">
          {laps.map((l, k) => (
            <div key={k} className={l[2] === 'rep' ? 'w' : l[2] === 'rest' ? 'rc' : 'e'}
              style={{ flex: (l[1] / tot) * 100, height: `${20 + (80 * (mxP - lp[k])) / (mxP - mnP || 1)}%` }}>
              {l[2] === 'rep' && <span>{fmtPace(lp[k])}</span>}
            </div>
          ))}
        </div>
        <div className="lg"><span><i style={{ background: '#C7C7CC' }} />חימום / שחרור</span><span><i style={{ background: '#F25C05' }} />חזרות</span><span><i style={{ background: '#E5E5EA' }} />מנוחה</span></div>
        {rp.length > 0 ? (
          <table className="rt">
            <tbody>
              <tr className="h"><td>חזרה</td><td>מרחק</td><td>זמן</td><td>קצב</td></tr>
              {rp.map((l, k) => (
                <tr key={k} className={lapPace(l) === best ? 'best' : ''}>
                  <td>{k + 1}</td><td>{l[0] >= 1000 ? `${fmtKm(l[0])} km` : `${l[0]} m`}</td><td>{clockText(l[1])}</td><td>{fmtPace(lapPace(l))} /km</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="note">לא זוהו חזרות בהקפות של השעון.</div>}
      </div>
      <div className="foot">
        <button className="btn" disabled={opening} onClick={onShare}>{opening ? '…' : '📸 לבחור איך לשתף'}</button>
      </div>
    </>
  );
}
