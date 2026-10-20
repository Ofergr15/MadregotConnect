'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { readWorkbook } from '@/lib/xlsx/read';
import { coachForNick, coachNicks, parseAcademyWorkbook, type ParsedImport } from '@/lib/academy/sheet-import';
import type { BoardRow, ImportBand, ImportCoach, PreviewNeed } from '@/lib/academy/sheet-import-server';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, SectionLabel, initials } from './book/ui';
import { Avatar, sendJson } from './completion/shared';

// "מעבר לאפליקציה" (mockups/roles-1019/academy-import.html): the academy's own spreadsheet into
// the app, with nobody told anything until the manager chooses. Three screens:
//   1. the file — read HERE, in the browser; only the fields the app uses are sent on
//   2. what's in it — ready, what needs a decision, the coaches' nicknames → coaches
//   3. who's invited — choose, send, and where each one is; the stuck on top
// Nothing is sent at import. An invitation is the existing move-in invite, per person, with
// the coach preset; the trainee confirms the details the file had and is in.

interface Board { coaches: ImportCoach[]; bands: ImportBand[]; rows: BoardRow[] }
interface Preview { needs: PreviewNeed[]; ready: string[]; coaches: ImportCoach[]; bands: ImportBand[] }

const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const STAGE_TEXT: Record<BoardRow['stage'], string> = {
  not_invited: 'לא הוזמן', invited: 'הוזמן', confirmed: 'אישר פרטים', in_app: 'באפליקציה',
};

function Row({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  const cls = cn('flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-start', className);
  return onClick ? <button type="button" onClick={onClick} className={cls}>{children}</button> : <div className={cls}>{children}</div>;
}

function Box({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', on ? 'border-[#7C3AED] bg-[#7C3AED] text-white' : 'border-ink-300')}>
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={cn('min-h-[36px] shrink-0 rounded-full px-3 text-[13px] font-extrabold', on ? 'bg-[#7C3AED] text-white' : 'bg-[#F1EAFE] text-[#6D28D9]')}>
      {label}
    </button>
  );
}

export function AcademyImportFlow({ onClose }: { onClose: () => void }) {
  const { data: board, error: boardError, mutate } = useApi<Board>('/api/academy/import');
  const [screen, setScreen] = useState<'auto' | 'upload' | 'preview' | 'board'>('auto');
  const current = screen === 'auto' ? (board ? (board.rows.length ? 'board' : 'upload') : null) : screen;

  return (
    <FlowOverlay label="מעבר לאפליקציה">
      {current === 'upload' && <UploadScreen onClose={onClose} hasBoard={!!board?.rows.length} onBoard={() => setScreen('board')}
        onParsed={() => setScreen('preview')} />}
      {current === 'preview' && <PreviewScreen onBack={() => setScreen('upload')} onDone={async () => { await mutate(); setScreen('board'); }} />}
      {current === 'board' && board && <BoardScreen board={board} onClose={onClose} onUpload={() => setScreen('upload')} reload={async () => { await mutate(); }} />}
      {current === null && (
        <FlowScreen title="מעבר לאפליקציה" leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}>
          {boardError ? <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">לא הצלחנו לטעון</p>
            : <div className="h-[140px] animate-pulse rounded-[22px] bg-white/70" aria-busy="true" />}
        </FlowScreen>
      )}
    </FlowOverlay>
  );
}

// The parsed file lives in this module between screens 1 and 2: it is never stored anywhere.
let parsedFile: { name: string; parsed: ParsedImport } | null = null;

function UploadScreen({ onClose, onParsed, hasBoard, onBoard }: { onClose: () => void; onParsed: () => void; hasBoard: boolean; onBoard: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const parsed = parseAcademyWorkbook(readWorkbook(new Uint8Array(await file.arrayBuffer())));
      if (!parsed.rows.length) { setError('לא מצאנו בקובץ מתאמנים — צריך את הלשונית "Form Responses 1".'); return; }
      parsedFile = { name: file.name, parsed };
      onParsed();
    } catch {
      setError('הקובץ לא נקרא. צריך קובץ ‎.xlsx‎ (ב־Google Sheets: קובץ ← הורדה ← Microsoft Excel).');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <FlowScreen title="ייבוא מהקובץ" leading={<BarButton onClick={hasBoard ? onBoard : onClose}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}>
      <div className={cn(CARD, 'p-5')}>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#F1EAFE] text-[#7C3AED]"><FileSpreadsheet className="h-6 w-6" /></span>
        <h2 className="mt-3 text-[20px] font-black text-ink-900">הקובץ של האקדמיה</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-500">
          הטופס שהמתאמנים מילאו, והלשונית ״מדדים וקצבים״. הקובץ נקרא כאן, במכשיר — לא עולה לשרת. נשמרים רק הפרטים שהאפליקציה צריכה;
          בדיקות דם, אינסטגרם ומצב משפחתי לא נשמרים.
        </p>
        <p className="mt-2 text-[14px] font-bold text-ink-700">אף אחד לא מקבל מייל בשלב הזה.</p>
      </div>
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
      {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}
      <PrimaryButton busy={busy} onClick={() => input.current?.click()}>בחירת קובץ</PrimaryButton>
    </FlowScreen>
  );
}

function PreviewScreen({ onBack, onDone }: { onBack: () => void; onDone: () => Promise<void> }) {
  const file = parsedFile;
  const rows = useMemo(() => file?.parsed.rows ?? [], [file]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coachMap, setCoachMap] = useState<Record<string, string | null>>({});
  const [link, setLink] = useState<Record<string, boolean>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!rows.length) return;
    void sendJson<Preview>('POST', '/api/academy/import', { action: 'preview', rows })
      .then((p) => {
        setPreview(p);
        const map: Record<string, string | null> = {};
        for (const { nick } of coachNicks(rows)) map[nick] = coachForNick(nick, p.coaches);
        setCoachMap(map);
        const l: Record<string, boolean> = {};
        for (const n of p.needs) if (n.kind === 'in_app' || n.kind === 'club_member') l[n.key] = !!n.member;
        setLink(l);
      })
      .catch(() => setError('לא הצלחנו לבדוק את הקובץ מול האפליקציה'));
  }, [rows]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const needs = preview?.needs ?? [];
  const of = (kind: PreviewNeed['kind']) => needs.filter((n) => n.kind === kind);
  const nicks = coachNicks(rows);
  const coachName = (id: string | null) => preview?.coaches.find((c) => c.id === id)?.name ?? null;

  // What the commit will do with each row: a club member is linked (moved in as one) or left
  // out — never a second account; an account still waiting for its form is left out; a person
  // already on the funnel is left out unless the manager asks.
  const skip = needs.filter((n) =>
    ((n.kind === 'in_app' || n.kind === 'club_member') && (!n.member || !link[n.key])) ||
    (n.kind === 'has_card' && !include[n.key])).map((n) => n.key);
  const links = Object.fromEntries(needs.filter((n) => link[n.key] && n.athleteId).map((n) => [n.key, n.athleteId!]));
  const importing = rows.length - skip.length;

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      await sendJson('POST', '/api/academy/import', { action: 'commit', rows, coachMap, links, skip });
      parsedFile = null;
      await onDone();
    } catch {
      setError('הייבוא נכשל');
    } finally {
      setBusy(false);
    }
  };

  if (!file) {
    return (
      <FlowScreen title="ייבוא מהקובץ" leading={<BarButton onClick={onBack}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}>
        <p className="px-1 text-sm text-ink-400">צריך לבחור את הקובץ שוב.</p>
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      title="מה בקובץ"
      leading={<BarButton onClick={onBack}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}
      footer={preview && (
        <PrimaryButton busy={busy} onClick={() => void commit()}>
          ייבוא <bdi dir="ltr">{importing}</bdi> — בלי לשלוח כלום
        </PrimaryButton>
      )}
    >
      <div className={cn(CARD, 'p-4')}>
        <p className="truncate text-[13px] text-ink-400" dir="ltr">{file.name}</p>
        <h2 className="mt-1 text-[22px] font-black text-ink-900"><bdi dir="ltr">{rows.length}</bdi> מתאמנים בקובץ</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-500">אף אחד עוד לא מקבל מייל. קודם בודקים, אחר כך בוחרים למי לשלוח.</p>
        {file.parsed.withResults > 0 && (
          <p className="mt-1.5 text-[13px] font-bold text-[#6D28D9]">ל־<bdi dir="ltr">{file.parsed.withResults}</bdi> יש תוצאות מ״מדדים וקצבים״ — הן יחכו למאמן בבסיס הקצב.</p>
        )}
      </div>
      {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}
      {!preview && !error && <div className="h-[160px] animate-pulse rounded-[22px] bg-white/70" aria-busy="true" />}

      {preview && (
        <>
          <SectionLabel>מוכנים</SectionLabel>
          <div className={cn(CARD, 'overflow-hidden')}>
            <Row>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-600/10 text-accent-900"><Check className="h-5 w-5" strokeWidth={3} /></span>
              <span className="min-w-0 flex-1">
                <b className="block text-[16px] font-bold text-ink-900"><bdi dir="ltr">{preview.ready.length}</bdi> מוכנים להזמנה</b>
                <span className="block text-[13.5px] text-ink-500">שם, מייל ומאמן — הכול קיים</span>
              </span>
            </Row>
          </div>

          {(of('no_email').length + of('in_app').length + of('club_member').length + of('has_card').length + file.parsed.merged.length) > 0 && (
            <>
              <SectionLabel>צריך החלטה שלך</SectionLabel>
              <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
                {of('no_email').length > 0 && (
                  <Row>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#F59E0B]" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[16px] font-bold text-ink-900"><bdi dir="ltr">{of('no_email').length}</bdi> בלי מייל</b>
                      <span className="block text-[13.5px] leading-snug text-ink-500">{of('no_email').map((n) => byKey.get(n.key)?.name).join(', ')} · נכנסים, ומוסיפים מייל לפני ההזמנה</span>
                    </span>
                  </Row>
                )}
                {file.parsed.merged.map((m) => (
                  <Row key={m.kept}>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#F59E0B]" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[16px] font-bold text-ink-900" dir="auto">{m.name} מופיע פעמיים</b>
                      <span className="block text-[13.5px] text-ink-500">אוחד לשורה אחת — התשובה החדשה</span>
                    </span>
                  </Row>
                ))}
                {[...of('in_app'), ...of('club_member')].map((n) => {
                  const r = byKey.get(n.key);
                  return (
                    <Row key={n.key}>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#3B82F6]" />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[16px] font-bold text-ink-900" dir="auto">{r?.name} כבר {n.member ? 'במועדון' : 'באפליקציה'}</b>
                        <span className="block text-[13.5px] leading-snug text-ink-500">
                          {n.member ? <>מצרפים לאקדמיה את החשבון הקיים (<bdi dir="auto">{n.athleteName}</bdi>), בלי הזמנה חדשה</> : <>יש לו חשבון שמחכה · {n.why}</>}
                        </span>
                      </span>
                      {n.member
                        ? <Toggle on={!!link[n.key]} onChange={(v) => setLink((x) => ({ ...x, [n.key]: v }))} label={link[n.key] ? 'קישור ✓' : 'לא לייבא'} />
                        : <span className="shrink-0 text-[13px] font-bold text-ink-400">לא מייבאים</span>}
                    </Row>
                  );
                })}
                {of('has_card').map((n) => (
                  <Row key={n.key}>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-ink-300" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[16px] font-bold text-ink-900" dir="auto">{byKey.get(n.key)?.name}</b>
                      <span className="block text-[13.5px] text-ink-500">כבר יש לו כרטיס במשפך · לא מייבאים שוב</span>
                    </span>
                    <Toggle on={!!include[n.key]} onChange={(v) => setInclude((x) => ({ ...x, [n.key]: v }))} label={include[n.key] ? 'לייבא ✓' : 'לייבא'} />
                  </Row>
                ))}
              </div>
            </>
          )}

          {nicks.length > 0 && (
            <>
              <SectionLabel>מאמנים מהעמודה ״מלווה״</SectionLabel>
              <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
                {nicks.map(({ nick, count }) => {
                  const id = coachMap[nick] ?? null;
                  return (
                    <label key={nick} className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <b className="block text-[16px] font-bold text-ink-900"><span dir="auto">{nick}</span> → {id ? <span dir="auto">{coachName(id)}</span> : <span className="text-[#B45309]">?</span>}</b>
                        <span className="block text-[13.5px] text-ink-500"><bdi dir="ltr">{count}</bdi> מתאמנים{!id && ' · לבחור מאמן, או להשאיר בלי'}</span>
                      </span>
                      <span className={cn('shrink-0 rounded-full px-3 py-1.5 text-[13px] font-extrabold', id ? 'text-[#16A34A]' : 'bg-[#F1EAFE] text-[#6D28D9]')}>{id ? '✓' : 'בחירה'}</span>
                      <select aria-label={`מאמן ל־${nick}`} value={id ?? ''} onChange={(e) => setCoachMap((m) => ({ ...m, [nick]: e.target.value || null }))}
                        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
                        <option value="">בלי מאמן בינתיים</option>
                        {preview.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="px-1 text-[12.5px] leading-relaxed text-ink-400">מי שלא מופיע ברשימה — קודם להוסיף אותו כמאמן (אקדמיה ← מאמנים ← ״מאמן חדש״), ואז לבחור.</p>
            </>
          )}
        </>
      )}
    </FlowScreen>
  );
}

function BoardScreen({ board, onClose, onUpload, reload }: { board: Board; onClose: () => void; onUpload: () => void; reload: () => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<Record<string, string>>({});
  const rows = board.rows;
  const waiting = rows.filter((r) => r.stage === 'not_invited');
  const invitable = waiting.filter((r) => r.email || r.linked);
  const stuck = rows.filter((r) => r.stuck);
  const count = (s: BoardRow['stage']) => rows.filter((r) => r.stage === s).length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickAll = (pred: (r: BoardRow) => boolean) => setPicked(new Set(invitable.filter(pred).map((r) => r.cardId)));
  const coachesInFile = [...new Set(invitable.flatMap((r) => r.coachIds))];
  const coachName = (id: string) => board.coaches.find((c) => c.id === id)?.name ?? '';

  const send = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await sendJson<{ results: Array<{ ok: boolean; error?: string; moved?: boolean }> }>('POST', '/api/academy/import', { action: 'invite', cardIds: [...picked] });
      const ok = r.results.filter((x) => x.ok).length;
      const failed = r.results.length - ok;
      setNote(failed ? `${ok} הוזמנו · ${failed} לא (כבר באפליקציה או בלי מייל)` : `${ok} הוזמנו`);
      setPicked(new Set());
      setConfirm(false);
      await reload();
    } catch {
      setNote('השליחה נכשלה');
    } finally {
      setBusy(false);
    }
  };
  const remind = async () => {
    setBusy(true);
    try {
      const r = await sendJson<{ reminded: number }>('POST', '/api/academy/import', { action: 'remind' });
      setNote(`נשלחה תזכורת ל־${r.reminded}`);
    } catch { setNote('התזכורת לא נשלחה'); } finally { setBusy(false); }
  };
  const saveEmail = async (cardId: string) => {
    const email = (emailFor[cardId] || '').trim();
    if (!email) return;
    try {
      await sendJson('PATCH', '/api/academy/import', { cardId, email });
      setEmailFor((m) => { const n = { ...m }; delete n[cardId]; return n; });
      await reload();
    } catch { setNote('המייל לא נשמר'); }
  };

  const line = (r: BoardRow) => [r.coachNames.map(first).join(' · ') || 'בלי מאמן', r.requestedBand ? `דבוקה ${r.requestedBand}` : null, r.linked ? 'חבר מועדון' : null].filter(Boolean).join(' · ');

  return (
    <FlowScreen
      title="מי מוזמן"
      leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />חזרה</BarButton>}
      trailing={<BarButton onClick={onUpload}>ייבוא</BarButton>}
      footer={picked.size > 0 && (
        <PrimaryButton onClick={() => setConfirm(true)}>שליחת הזמנה ל־<bdi dir="ltr">{picked.size}</bdi> נבחרים</PrimaryButton>
      )}
    >
      <div className="grid grid-cols-4 gap-2">
        {([['לא הוזמנו', count('not_invited')], ['הוזמנו', count('invited')], ['אישרו', count('confirmed')], ['באפליקציה', count('in_app')]] as const).map(([label, n]) => (
          <div key={label} className={cn(CARD, 'p-2.5 text-center')}>
            <p className="text-[22px] font-black tabular-nums text-ink-900">{n}</p>
            <p className="text-[11.5px] font-bold text-ink-400">{label}</p>
          </div>
        ))}
      </div>
      {note && <p className="px-1 text-[14px] font-bold text-[#16A34A]" role="status">{note}</p>}

      {stuck.length > 0 && (
        <>
          <div className="flex items-baseline justify-between px-1">
            <SectionLabel>תקועים · הוזמנו לפני 48+ שעות</SectionLabel>
            <button type="button" onClick={() => void remind()} disabled={busy} className="min-h-[36px] text-[13.5px] font-extrabold text-[#7C3AED] disabled:opacity-50">תזכורת לכולם</button>
          </div>
          <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
            {stuck.map((r) => (
              <Row key={r.cardId}>
                <Avatar text={initials(r.name)} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[16px] font-bold text-ink-900" dir="auto">{r.name}</b>
                  <span className="block truncate text-[13.5px] text-ink-500">{line(r)}</span>
                </span>
                <span className="shrink-0 text-[13px] font-extrabold text-[#B45309]">לא אישר</span>
              </Row>
            ))}
          </div>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <SectionLabel>בחירה מהירה</SectionLabel>
          <div className="flex gap-2 overflow-x-auto px-1 pb-1 [&>*]:shrink-0">
            {coachesInFile.map((id) => (
              <button key={id} type="button" onClick={() => pickAll((r) => r.coachIds.includes(id))}
                className="min-h-[38px] rounded-full bg-[#F1EAFE] px-3.5 text-[13.5px] font-extrabold text-[#6D28D9]">
                של <span dir="auto">{first(coachName(id))}</span> <bdi dir="ltr">({invitable.filter((r) => r.coachIds.includes(id)).length})</bdi>
              </button>
            ))}
            <button type="button" onClick={() => pickAll((r) => r.marked)}
              className="min-h-[38px] rounded-full bg-[#F1EAFE] px-3.5 text-[13.5px] font-extrabold text-[#6D28D9]">״בפנים״ בקובץ</button>
            {picked.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="min-h-[38px] rounded-full bg-white px-3.5 text-[13.5px] font-extrabold text-ink-500">ניקוי</button>
            )}
          </div>

          <SectionLabel>לא הוזמנו · <bdi dir="ltr">{waiting.length}</bdi></SectionLabel>
          <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
            {waiting.map((r) => {
              const can = !!(r.email || r.linked);
              return (
                <div key={r.cardId}>
                  <Row onClick={can ? () => toggle(r.cardId) : undefined}>
                    {can ? <Box on={picked.has(r.cardId)} /> : <span className="h-6 w-6 shrink-0" />}
                    <Avatar text={initials(r.name)} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[16px] font-bold text-ink-900" dir="auto">{r.name}</b>
                      <span className="block truncate text-[13.5px] text-ink-500">{can ? line(r) : 'חסר מייל — בלי מייל אי אפשר להזמין'}</span>
                    </span>
                  </Row>
                  {!can && (
                    <div className="flex gap-2 px-4 pb-3">
                      <input type="email" dir="ltr" inputMode="email" placeholder="name@example.com" value={emailFor[r.cardId] ?? ''}
                        onChange={(e) => setEmailFor((m) => ({ ...m, [r.cardId]: e.target.value }))}
                        className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-[#F4F4F8] px-3 text-end text-[16px] text-ink-900 focus:outline-none" />
                      <button type="button" onClick={() => void saveEmail(r.cardId)} className="min-h-[44px] shrink-0 rounded-xl bg-[#F1EAFE] px-3 text-[14px] font-extrabold text-[#6D28D9]">שמירה</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {(['invited', 'confirmed', 'in_app'] as const).map((stage) => {
        const list = rows.filter((r) => r.stage === stage && !r.stuck);
        if (!list.length) return null;
        return (
          <Fragment key={stage}>
            <SectionLabel>{STAGE_TEXT[stage]} · <bdi dir="ltr">{list.length}</bdi></SectionLabel>
            <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
              {list.map((r) => (
                <Row key={r.cardId}>
                  <Avatar text={initials(r.name)} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[16px] font-bold text-ink-900" dir="auto">{r.name}</b>
                    <span className="block truncate text-[13.5px] text-ink-500">{line(r)}</span>
                  </span>
                  <span className={cn('shrink-0 text-[13px] font-extrabold', stage === 'in_app' ? 'text-[#16A34A]' : 'text-ink-500')}>{STAGE_TEXT[stage]}{stage === 'in_app' && ' ✓'}</span>
                </Row>
              ))}
            </div>
          </Fragment>
        );
      })}

      {confirm && (
        <div className="fixed inset-0 z-[300] flex flex-col justify-end bg-black/40" onClick={() => !busy && setConfirm(false)}>
          <div className="rounded-t-[22px] bg-[#F4F4F8] px-[18px] pb-[max(30px,env(safe-area-inset-bottom))] pt-2" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="אישור שליחה">
            <span className="mx-auto mb-3 block h-[5px] w-[38px] rounded-full bg-[#C7C7CC]" />
            <h3 className="mb-3 text-[19px] font-black text-ink-900">לשלוח הזמנה ל־<bdi dir="ltr">{picked.size}</bdi>?</h3>
            <div className={cn(CARD, 'divide-y divide-[#EFEFF4] overflow-hidden')}>
              <Row><span className="text-[18px]">✉️</span><span className="min-w-0 flex-1"><b className="block text-[15.5px] font-bold text-ink-900">מייל עם הפרטים שלהם</b><span className="block text-[13px] text-ink-500">״זה נכון? אישור בלחיצה אחת״ · בלי שם המאמן</span></span></Row>
              <Row><span className="text-[18px]">🔁</span><span className="min-w-0 flex-1"><b className="block text-[15.5px] font-bold text-ink-900">תזכורת אחת</b><span className="block text-[13px] text-ink-500">אם לא אישרו תוך 48 שעות</span></span></Row>
              <Row><span className="text-[18px]">📲</span><span className="min-w-0 flex-1"><b className="block text-[15.5px] font-bold text-ink-900">אחרי האישור</b><span className="block text-[13px] text-ink-500">מייל התקנה ישר — בלי אישור נוסף שלך. המאמן מקבל ״טופס התאמה״.</span></span></Row>
            </div>
            <div className="mt-3 grid gap-2">
              <PrimaryButton busy={busy} onClick={() => void send()}>שליחה</PrimaryButton>
              <PrimaryButton secondary onClick={() => setConfirm(false)} disabled={busy}>ביטול</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </FlowScreen>
  );
}


/**
 * The door into "מעבר לאפליקציה" from People → trainees, for the manager: always there (the
 * file can be imported at any time), with where the move stands once there is one.
 */
export function ImportEntry({ onOpen }: { onOpen: () => void }) {
  const { data } = useApi<Board>('/api/academy/import');
  const rows = data?.rows ?? [];
  const waiting = rows.filter((r) => r.stage === 'not_invited').length;
  const inApp = rows.filter((r) => r.stage === 'in_app').length;
  const stuck = rows.filter((r) => r.stuck).length;
  return (
    <button type="button" onClick={onOpen}
      className="mb-2.5 flex min-h-[56px] w-full items-center gap-3 rounded-card bg-card px-3.5 py-2 text-start active:bg-page/40">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#F1EAFE] text-[#7C3AED]"><FileSpreadsheet className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-extrabold text-ink-700">מעבר לאפליקציה</b>
        <small className="block text-2xs text-ink-400">
          {rows.length
            ? <><bdi dir="ltr">{waiting}</bdi> לא הוזמנו · <bdi dir="ltr">{inApp}</bdi> באפליקציה{stuck ? <> · <bdi dir="ltr">{stuck}</bdi> תקועים</> : null}</>
            : 'ייבוא המתאמנים מהקובץ של האקדמיה'}
        </small>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-ink-300" />
    </button>
  );
}
