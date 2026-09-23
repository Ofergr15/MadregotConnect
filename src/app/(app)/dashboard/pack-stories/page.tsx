'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '@/lib/api';
import { useIsSuperUser, getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';
import { GROUP_HEX } from '@/lib/utils';
import {
  PACKS, LAYOUTS, METRICS, METRIC_ORDER,
  initialState, newPack, runsFor, unassigned, dups, ranked, chartRun, slots,
  metricPreview, metricAvailable, sessionLabel, fmtKm, fmtPace,
  type Pack, type PackSession, type StoryState, type MetricKey, type LogoKind, type Variant,
} from '@/lib/pack-stories/model';
import {
  drawStory, renderExport, toPngBlob, LOGO_KINDS, CLUB_BG_SRC, STORY_W, STORY_H,
  type StoryAssets, type StoryScene,
} from '@/lib/pack-stories/render';
import './pack-stories.css';

// Pack stories: one Instagram story per pack after a group session, built from
// the session's own runs. Still being tried out, so it is the super user's
// alone: no nav item (admins get every nav item), a Coach Tools row only the
// super user sees, and GET /api/pack-stories answers 403 to everybody else. Hidden while
// viewing as someone else, so view-as shows what they would see.
//
// The design is the prototype in ~/.cache/madregot/mockups/pack-stories-proto;
// the pure selection rules are lib/pack-stories/model.ts, the canvas is render.ts.

const DAYS_BACK = 8;
const VARIANT_FILE: Record<Variant, string> = { full: 'full', noMap: 'nomap', splits: 'splits' };

/** Today and the days before it, as Israel calendar dates. */
function recentDates(): string[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: DAYS_BACK }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

const loadImage = (src: string) => new Promise<HTMLImageElement | null>(res => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

type Sheet = null | { kind: 'slot'; i: number } | { kind: 'chart' } | { kind: 'export' };

export default function PackStoriesPage() {
  const isSuper = useIsSuperUser();
  const viewMode = getViewMode();
  const previewing = !!viewMode && viewMode !== MAINTENANCE_MODE;
  const allowed = isSuper && !previewing;

  const [dates] = useState(recentDates);
  const [date, setDate] = useState(dates[0]);
  const { data: sess, error, isLoading } = useApi<PackSession>(allowed ? `/api/pack-stories?date=${date}` : null);

  const [S, setS] = useState<StoryState>(initialState);
  const up = (f: (s: StoryState) => void) => setS(prev => { const n = structuredClone(prev); f(n); return n; });

  const [assets, setAssets] = useState<StoryAssets>({ clubBg: null, myBg: null, logos: {} });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      const kinds = (Object.keys(LOGO_KINDS) as LogoKind[]).filter(k => LOGO_KINDS[k].src);
      const [bg, ...logos] = await Promise.all([loadImage(CLUB_BG_SRC), ...kinds.map(k => loadImage(LOGO_KINDS[k].src!))]);
      if (document.fonts?.ready) await document.fonts.ready;
      if (cancelled) return;
      setAssets(a => ({ ...a, clubBg: bg, logos: Object.fromEntries(kinds.map((k, i) => [k, logos[i]]).filter(([, im]) => im)) }));
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [X, setX] = useState<{ variant: Variant; all: boolean }>({ variant: 'full', all: false });
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = (t: string) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  const cvRef = useRef<HTMLCanvasElement>(null);
  const thumbRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const xthRefs = useRef<Partial<Record<Variant, HTMLCanvasElement | null>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const scene: StoryScene | null = sess && ready ? { S, sess, assets } : null;
  const p = S.pack;

  useEffect(() => {
    if (!scene) return;
    if (cvRef.current) drawStory(cvRef.current, scene, p);
    PACKS.forEach((n, i) => { const c = thumbRefs.current[i]; if (c) drawStory(c, scene, n); });
  });

  useEffect(() => {
    if (!scene || sheet?.kind !== 'export') return;
    (Object.entries(xthRefs.current) as Array<[Variant, HTMLCanvasElement | null]>).forEach(([v, cv]) => {
      if (!cv) return;
      const src = renderExport(scene, p, v);
      cv.width = src.width / 3; cv.height = src.height / 3;
      const x = cv.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, cv.width, cv.height);
    });
  });

  // Nothing at all rather than "no access": the super-user answer arrives after the
  // first render, and a flash of a refusal reads like a bug. The API is the real gate.
  if (!allowed) return null;

  const pickDate = (d: string) => {
    setDate(d);
    // Hand assignments and picked runs belong to that day's runs; the look stays.
    up(s => { s.assign = {}; s.packs = { 1: newPack(), 2: newPack(), 3: newPack() }; });
  };

  const header = (
    <>
      <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight" dir="rtl">סטוריז לדבוקות</h1>
      <div className="sec">אימון</div>
      <div className="days">
        {dates.map(d => (
          <button key={d} className={d === date ? 'on' : ''} onClick={() => pickDate(d)}>{sessionLabel(d).replace('אימון ', '')}</button>
        ))}
      </div>
    </>
  );

  if (!sess) {
    return (
      <div className="psx" dir="rtl">
        {header}
        <div className="empty">{error ? 'הטעינה נכשלה.' : isLoading ? 'טוען…' : ''}</div>
      </div>
    );
  }

  const cfg = S.packs[p], rs = runsFor(S, sess, p), sl = slots(S, sess, p), un = unassigned(S, sess), du = dups(S, sess);
  const summ = S.layout === 'summary', fr = chartRun(S, sess, p), max = LAYOUTS[S.layout].max;
  const counts = PACKS.map(n => runsFor(S, sess, n).length);
  const SHOW: Array<[keyof StoryState['show'], string]> = [
    ['pill', summ ? 'דבוקה' : 'דבוקה ותאריך'],
    ...(summ ? [['date', 'תאריך'] as [keyof StoryState['show'], string]] : []),
    ['title', 'כותרות (הכי מהיר…)'],
    ['name', 'שמות הרצים'],
    ...(summ ? [] : [['chartName', 'שם על הגרף'] as [keyof StoryState['show'], string]]),
  ];

  const toggleMetric = (k: MetricKey) => {
    const list = cfg.metrics[S.layout];
    if (!list.includes(k) && list.length >= max) { toast(`נכנסים רק ${max} מספרים — כבו אחד קודם`); return; }
    up(s => {
      const c = s.packs[p], l = c.metrics[s.layout], i = l.indexOf(k);
      if (i >= 0) { l.splice(i, 1); delete c.edits[k]; } else l.push(k);
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const im = await loadImage(URL.createObjectURL(f));
    if (!im) { toast('לא הצלחתי לקרוא את התמונה'); return; }
    setAssets(a => ({ ...a, myBg: im }));
    up(s => { s.bg = 'mine'; });
  };

  // ── export ──
  const exportOpts: Array<{ k: Variant; t: string; d: string }> = [
    { k: 'full', t: `עם ${summ ? 'המפה' : 'הגרף'}`, d: 'הסטורי המלא' },
    { k: 'noMap', t: `בלי ${summ ? 'המפה' : 'הגרף'}`, d: 'המספרים והלוגו על התמונה' },
    { k: 'splits', t: 'רק הספליטים', d: 'הכרטיס התחתון, רקע שקוף' },
  ];
  const noLaps = !chartRun(S, sess, p, 'laps');
  const canCopy = !X.all && typeof window !== 'undefined' && !!navigator.clipboard && 'ClipboardItem' in window;

  const doCopy = async () => {
    if (!scene) return;
    try {
      // The blob goes in as a promise so Safari still counts this as part of the tap.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPngBlob(renderExport(scene, p, X.variant)) })]);
      toast('הועתק — אפשר להדביק באינסטגרם');
    } catch {
      toast('הדפדפן לא איפשר העתקה — השתמשו בשיתוף');
    }
  };

  const doShare = async () => {
    if (!scene) return;
    const files: File[] = [];
    for (const n of X.all ? PACKS : [p]) {
      if (X.variant === 'splits' && !chartRun(S, sess, n, 'laps')) continue;
      const blob = await toPngBlob(renderExport(scene, n, X.variant));
      files.push(new File([blob], `madregot-${sess.date}-pack${n}-${VARIANT_FILE[X.variant]}.png`, { type: 'image/png' }));
    }
    if (!files.length) return;
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files }); return; } catch (err) { if ((err as Error).name === 'AbortError') return; }
    }
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    }
    toast(files.length > 1 ? `${files.length} תמונות נשמרו` : 'התמונה נשמרה');
  };

  // ── sheets ──
  let sheetBody: React.ReactNode = null;
  if (sheet?.kind === 'chart') {
    sheetBody = (
      <>
        <h3>דבוקה {p} · הריצה המוצגת</h3>
        <div className="pick">
          {rs.filter(summ ? r => !!r.route : r => r.laps.length > 0).map(r => (
            <button key={r.id} className={fr && r.id === fr.id ? 'on' : ''} onClick={() => { up(s => { s.packs[p].chartRun = r.id; }); setSheet(null); }}>
              <span>{r.name}</span>
              <span>{summ ? `${fmtPace(r.pace)} · ${fmtKm(r.dist)}` : `${r.laps.length} laps · ${fmtKm(r.dist)}`}</span>
            </button>
          ))}
        </div>
        <div className="src">{summ ? 'המסלול, המרחק, הקצב והזמן בסטורי נלקחים מהריצה הזו.' : 'ברירת מחדל: הריצה עם הכי הרבה הקפות — זו ששמרה את מבנה האימון.'}</div>
        <div className="seg" style={{ marginTop: 14 }}><button className="on" onClick={() => setSheet(null)}>סגירה</button></div>
      </>
    );
  } else if (sheet?.kind === 'slot' && sl[sheet.i]) {
    const s = sl[sheet.i], m = METRICS[s.key], ed = cfg.edits[s.key] || {};
    sheetBody = (
      <SlotEditor
        key={`${p}-${s.key}-${s.run?.id ?? ''}-${ed.value ?? ''}`}
        pack={p} slot={s}
        runners={m.rank ? ranked(s.key, rs).slice(0, 6).map(r => ({ id: r.id, name: r.name, val: m.val!(r) })) : null}
        hasValueEdit={ed.value != null}
        onPick={id => up(st => { const e = { ...(st.packs[p].edits[s.key] || {}), runId: id }; delete e.value; st.packs[p].edits[s.key] = e; })}
        onRestore={() => up(st => { delete st.packs[p].edits[s.key]!.value; })}
        onCancel={() => setSheet(null)}
        onSave={(v, ti) => {
          up(st => {
            const e = { ...(st.packs[p].edits[s.key] || {}) };
            if (v && v !== s.auto) e.value = v; else delete e.value;
            if (ti && ti !== m.title) e.title = ti; else delete e.title;
            st.packs[p].edits[s.key] = e;
          });
          setSheet(null);
        }}
      />
    );
  } else if (sheet?.kind === 'export') {
    sheetBody = (
      <>
        <div className="xhead"><h3>שיתוף והעתקה</h3><button className="xclose" aria-label="סגירה" onClick={() => setSheet(null)}>✕</button></div>
        <div className="seg" style={{ marginTop: 10 }}>
          <button className={!X.all ? 'on' : ''} onClick={() => setX(x => ({ ...x, all: false }))}><i style={{ background: GROUP_HEX[p - 1] }} />דבוקה {p}</button>
          <button className={X.all ? 'on' : ''} onClick={() => setX(x => ({ ...x, all: true }))}>כל השלוש</button>
        </div>
        <div className="xopts">
          {exportOpts.map(o => {
            const dis = o.k === 'splits' && noLaps;
            return (
              <button key={o.k} className={`xopt ${X.variant === o.k ? 'on' : ''}`} disabled={dis} onClick={() => setX(x => ({ ...x, variant: o.k }))}>
                <span className={`xth ${o.k === 'splits' ? 'stk' : ''}`}>
                  <canvas ref={el => { xthRefs.current[o.k] = el; }} />
                  {X.all && <em>×3</em>}
                </span>
                <b>{o.t}</b>
                <small>{dis ? 'אין הקפות בדבוקה הזו' : o.d}</small>
                <span className="rad" />
              </button>
            );
          })}
        </div>
        <div className="xact">
          <button className="btn b2" disabled={!canCopy} onClick={doCopy}>העתקה</button>
          <button className="btn b1" onClick={doShare}>{X.all ? 'שיתוף 3 תמונות' : 'שיתוף / שמירה'}</button>
        </div>
        <div className="src" style={{ textAlign: 'center' }}>
          {X.all ? 'העתקה עובדת על תמונה אחת — לשלוש משתמשים בשיתוף.' : 'אחרי העתקה: בסטורי באינסטגרם לוחצים ארוך ← "הדבקה", והתמונה נכנסת כמדבקה.'}
        </div>
      </>
    );
  }

  return (
    <div className="psx" dir="rtl">
      {header}
      <div className="win">
        ריצות שהתחילו בין
        <input type="time" value={S.from} onChange={e => up(s => { s.from = e.target.value; })} />
        ל-
        <input type="time" value={S.to} onChange={e => up(s => { s.to = e.target.value; })} />
      </div>

      <div className="layout">
        <div className="prev">
          <div className="label">סטורי · דבוקה {p} · {rs.length} רצים</div>
          <div className="canvasBox"><canvas ref={cvRef} width={STORY_W} height={STORY_H} /></div>
          <div className="thumbs">
            {PACKS.map((n, i) => (
              <button key={n} className={n === p ? 'on' : ''} aria-label={`דבוקה ${n}`} onClick={() => up(s => { s.pack = n; })}>
                <canvas ref={el => { thumbRefs.current[i] = el; }} width={STORY_W / 4} height={STORY_H / 4} />
              </button>
            ))}
          </div>
          <div className="foot"><button className="btn b1" onClick={() => setSheet({ kind: 'export' })}>שיתוף והעתקה</button></div>
        </div>

        <div className="ctl">
          <div className="sec">דבוקה · כל אחת = סטורי</div>
          <div className="seg">
            {PACKS.map((n, i) => (
              <button key={n} className={n === p ? 'on' : ''} onClick={() => up(s => { s.pack = n; })}>
                <i style={{ background: GROUP_HEX[n - 1] }} />דבוקה {n} <small>{counts[i]}</small>
              </button>
            ))}
          </div>
          {un.length > 0 && (
            <div className="un">
              <b>{un.length} רצו ולא משובצים לדבוקה</b> — בחרו לאן:
              {un.map(r => (
                <div key={r.id} className="r">
                  <span>{r.name} · <bdi dir="ltr">{fmtKm(r.dist)}</bdi> ק״מ</span>
                  {PACKS.map(n => (
                    <button key={n} style={{ color: GROUP_HEX[n - 1] }} onClick={() => up(s => { s.assign[r.id] = n; })}>{n}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {du.length > 0 && <div className="hint">הוסתרו {du.length} ריצות כפולות (אותה ריצה על שני פרופילים): {du.map(r => r.name).join(', ')}</div>}

          <div className="sec">סוג הסטורי · לכל הסטוריז</div>
          <div className="seg">
            {(Object.keys(LAYOUTS) as Array<keyof typeof LAYOUTS>).map(k => (
              <button key={k} className={S.layout === k ? 'on' : ''} onClick={() => up(s => { s.layout = k; })}>{LAYOUTS[k].name}</button>
            ))}
          </div>

          <div className="sec">מה ייכנס לסטורי</div>
          <div className="chips">
            {METRIC_ORDER.map(k => {
              const on = cfg.metrics[S.layout].includes(k), dis = !metricAvailable(S, sess, p, k);
              return (
                <button key={k} className={`chip ${on ? 'on' : ''} ${dis ? 'off' : ''}`} disabled={dis} onClick={() => toggleMetric(k)}>
                  {METRICS[k].title}<b dir="ltr">{metricPreview(S, sess, p, k)}</b>
                </button>
              );
            })}
            <button className={`chip ${cfg.chart ? 'on' : ''}`} onClick={() => up(s => { s.packs[p].chart = !s.packs[p].chart; })}>
              {summ ? 'מסלול' : 'ניתוח אימון'}
              <b>{summ ? (fr ? 'GPS' : 'אין מסלול') : fr ? `${fr.laps.length} הקפות` : 'אין הקפות'}</b>
            </button>
          </div>
          <div className="hint">נכנסים {max} מספרים + {summ ? 'המסלול' : 'הגרף'}. כבו אחד כדי להחליף. מרחק/קצב/זמן = של הריצה המוצגת.</div>

          <div className="sec">מה רואים על התמונה · לכל הסטוריז</div>
          <div className="chips">
            {SHOW.map(([k, n]) => (
              <button key={k} className={`chip ${S.show[k] ? 'on' : ''}`} onClick={() => up(s => { s.show[k] = !s.show[k]; })}>{S.show[k] ? '✓ ' : ''}{n}</button>
            ))}
          </div>

          <div className="sec">לוגו</div>
          <div className="logos">
            {(Object.keys(LOGO_KINDS) as LogoKind[]).map(k => (
              <button key={k} className={`lgo ${S.logo.kind === k ? 'on' : ''}`} onClick={() => up(s => { s.logo.kind = k; })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {LOGO_KINDS[k].src ? <img src={LOGO_KINDS[k].src} alt="" className={S.logo.color} /> : <span className="nolg">✕</span>}
                <small>{LOGO_KINDS[k].name}</small>
              </button>
            ))}
          </div>
          {S.logo.kind !== 'none' && (
            <div className="seg" style={{ marginTop: 8 }}>
              <button className={S.logo.color === 'white' ? 'on' : ''} onClick={() => up(s => { s.logo.color = 'white'; })}>לבן</button>
              <button className={S.logo.color === 'black' ? 'on' : ''} onClick={() => up(s => { s.logo.color = 'black'; })}>שחור</button>
            </div>
          )}

          <div className="sec">דבוקה {p} · לחיצה = עריכה <a onClick={() => up(s => { s.packs[p] = newPack(); })}>איפוס</a></div>
          {!rs.length && <div className="hint">אין ריצות בדבוקה הזו בחלון הזמן שנבחר.</div>}
          {sl.map((s, i) => (
            <button key={s.key} className={`hl ${s.edited ? 'ed' : ''}`} onClick={() => setSheet({ kind: 'slot', i })}>
              <span className="k">{s.title}</span>
              <span className="n">{s.who}</span>
              <span className="v"><bdi dir="ltr">{s.value} {s.unit}</bdi></span>
              <span className="e">‹</span>
            </button>
          ))}
          <button className={`hl ${cfg.chartRun != null ? 'ed' : ''}`} onClick={() => setSheet({ kind: 'chart' })}>
            <span className="k">הריצה המוצגת</span>
            <span className="n">{fr ? fr.name : '—'}</span>
            <span className="v">{fr ? (summ ? `${fmtKm(fr.dist)} km` : `${fr.laps.length} laps`) : ''}</span>
            <span className="e">‹</span>
          </button>
          <button className={`tg ${S.nextInLine ? 'on' : ''}`} onClick={() => up(s => { s.nextInLine = !s.nextInLine; })}>
            <span>אם אותו רץ זוכה בשניהם — השני עובר לבא בתור</span><i />
          </button>

          <div className="sec">כיתוב</div>
          <input className="inp" placeholder="אפשר להשאיר ריק" value={cfg.caption} onChange={e => { const v = e.target.value; up(s => { s.packs[p].caption = v; }); }} />

          <div className="sec">רקע · לכל הסטוריז</div>
          <div className="seg">
            <button className={S.bg === 'mine' ? 'on' : ''} onClick={() => fileRef.current?.click()}>{assets.myBg ? 'התמונה שלי' : 'תמונה שלי…'}</button>
            <button className={S.bg === 'club' ? 'on' : ''} onClick={() => up(s => { s.bg = 'club'; })}>תמונת המועדון</button>
            <button className={S.bg === 'clear' ? 'on' : ''} onClick={() => up(s => { s.bg = 'clear'; })}>מדבקה שקופה</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        </div>
      </div>

      {/* On <body>, not in the page: the app's content column is transformed, which
          would pin `position: fixed` to the column instead of the screen. */}
      {createPortal(
        <div className="psx" dir="rtl">
          <div className={`dim ${sheet ? 'show' : ''}`} onClick={() => setSheet(null)} />
          <div className={`edit ${sheet ? 'show' : ''}`}>
            <div className="grab" />
            {sheetBody}
          </div>
          <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function SlotEditor({ pack, slot, runners, hasValueEdit, onPick, onRestore, onCancel, onSave }: {
  pack: Pack;
  slot: ReturnType<typeof slots>[number];
  runners: Array<{ id: string; name: string; val: string }> | null;
  hasValueEdit: boolean;
  onPick: (runId: string) => void;
  onRestore: () => void;
  onCancel: () => void;
  onSave: (value: string, title: string) => void;
}) {
  const [value, setValue] = useState(slot.value);
  const [title, setTitle] = useState(slot.title);
  return (
    <>
      <h3>דבוקה {pack} · {slot.title}</h3>
      {runners && (
        <>
          <div className="sec">מי</div>
          <div className="pick">
            {runners.map(r => (
              <button key={r.id} className={slot.run && r.id === slot.run.id ? 'on' : ''} onClick={() => onPick(r.id)}>
                <span>{r.name}</span><span>{r.val}</span>
              </button>
            ))}
          </div>
          <div className="src">מסודר לפי הנתונים מהשעון.</div>
        </>
      )}
      <div className="sec">הערך שיופיע</div>
      <div className="row2">
        <input className="inp" value={value} onChange={e => setValue(e.target.value)} />
        <span style={{ fontSize: 12, color: '#6b7280' }}><bdi dir="ltr">{slot.unit}</bdi></span>
      </div>
      <div className="src">
        מהשעון: <b dir="ltr">{slot.auto}</b>
        {hasValueEdit && <> · <button onClick={onRestore}>החזר לערך מהשעון</button></>}
      </div>
      <div className="sec">כותרת</div>
      <input className="inp" value={title} onChange={e => setTitle(e.target.value)} />
      <div className="seg" style={{ marginTop: 16 }}>
        <button onClick={onCancel}>ביטול</button>
        <button className="on" style={{ background: 'var(--brand)', color: '#fff' }} onClick={() => onSave(value.trim(), title.trim())}>שמירה</button>
      </div>
    </>
  );
}
