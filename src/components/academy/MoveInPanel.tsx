'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, MessageCircle, Search, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Spinner } from '@/components/ui';
import { sortBands } from '@/lib/academy/bands';
import { joinHebrewList } from '@/lib/academy/members';
import { waShareUrl, type AddableMember } from '@/lib/academy/manage';
import { useApi } from '@/lib/api';
import { groupDisplayName } from '@/lib/utils';
import type { AcademyBand, AcademyCoachSummary } from './types';
import { CoachesPicker } from './CoachesPicker';

// "כבר מתאמנים אצלנו" — the migration path (academy-existing-add/migration-plan.html, screens
// 1–2): people who ALREADY train in the academy, moved into the app in one go. No form, no
// calls: in as trainees, with the coaches, the band and "training since" set once for all.
// Each row says what moving them in will do besides adding them, before it is done; the
// result says what happens next for each, and can be undone the same day, silently.

interface MoveResult { athleteId: string; ok: boolean; unchanged?: boolean; error?: string; coachIds?: string[] }

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';

async function moveIn(body: Record<string, unknown>): Promise<{ results: MoveResult[]; error?: string }> {
  try {
    const res = await fetch('/api/academy/members/bulk', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { results: [], error: json.error || 'ההעברה נכשלה' };
    return { results: Array.isArray(json.results) ? json.results : [] };
  } catch {
    return { results: [], error: 'ההעברה נכשלה' };
  }
}

function Box({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border-2 transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'mute'; children: React.ReactNode }) {
  return (
    <span className={cn('mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold',
      tone === 'info' ? 'bg-band-2/15 text-band-2-ink' : tone === 'warn' ? 'bg-band-3/10 text-band-3-ink' : 'bg-page text-ink-500')}>
      {children}
    </span>
  );
}

const ERROR_TEXT: Record<string, string> = {
  not_club_member: 'עוד לא חבר מועדון מאושר',
  pairing_failed: 'נכנס, אבל המאמנים לא נשמרו',
  write_failed: 'לא נשמר',
  not_found: 'לא נמצא',
};

export function MoveInPanel({ addable, coaches, bands, multiCoach, onDone }: {
  addable: AddableMember[] | undefined;
  coaches: AcademyCoachSummary[];
  bands: AcademyBand[];
  multiCoach?: boolean;
  onDone: () => void | Promise<void>;
}) {
  const assignable = useMemo(() => coaches.filter((c) => c.coachId).sort((a, b) => a.trainees - b.trainees), [coaches]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [bandId, setBandId] = useState<string | null>(null);
  const [since, setSince] = useState('');
  const [picker, setPicker] = useState<'coach' | 'band' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MoveResult[] | null>(null);
  const [undone, setUndone] = useState(false);
  // "עוד לא באפליקציה": a pre-approved invitation instead of a move (mockup screens 3–4).
  const [mode, setMode] = useState<'club' | 'invite'>('club');
  const [inv, setInv] = useState({ name: '', email: '', phone: '' });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ url: string; name: string; phone: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> }>(mode === 'invite' ? '/api/groups' : null);
  const groups = groupsData?.groups ?? [];
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email.trim());

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (addable ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 60);
  }, [addable, query]);
  const nameOf = (id: string) => (addable ?? []).find((a) => a.athleteId === id)?.name ?? '';
  const coachName = (id: string) => assignable.find((c) => c.coachId === id)?.coachName ?? '';
  const band = bands.find((b) => b.id === bandId) ?? null;
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = async () => {
    setBusy(true); setError(null);
    const r = await moveIn({ action: 'add', existing: true, athleteIds: [...picked], coachIds, bandId, trainingSince: since || undefined, notify: true });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setDone(r.results);
    await onDone();
  };

  const invite = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/academy/members/invite', {
        method: 'POST', headers: await bearerHeaders(),
        body: JSON.stringify({ ...inv, coachIds, bandId, groupId, trainingSince: since || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.error === 'already_in_app') { setError(`${json.name || 'הוא'} כבר באפליקציה — מעבירים מהלשונית "מהמועדון".`); return; }
      if (!res.ok || !json.url) { setError(json.error || 'ההזמנה לא נוצרה'); return; }
      setInvited({ url: json.url, name: inv.name.trim(), phone: inv.phone.trim(), email: inv.email.trim().toLowerCase() });
      await onDone();
    } catch {
      setError('ההזמנה לא נוצרה');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!done) return;
    const ids = done.filter((r) => r.ok && !r.unchanged).map((r) => r.athleteId);
    if (!ids.length) return;
    setBusy(true);
    const r = await moveIn({ action: 'undoMove', athleteIds: ids });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setUndone(true);
    await onDone();
  };

  // ── After the move: what happened to each, and what comes next ──
  if (done) {
    const moved = done.filter((r) => r.ok && !r.unchanged);
    return (
      <div>
        <div className="rounded-card bg-card p-4 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-600/10"><Check className="h-6 w-6 text-accent-600" strokeWidth={3} /></span>
          <p className="mt-2 text-lg font-extrabold text-ink-700">{undone ? 'ההעברה בוטלה' : moved.length === 1 ? 'אחד עבר לאקדמיה' : `${moved.length} עברו לאקדמיה`}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            {undone
              ? 'הכל חזר כמו שהיה. ההודעה שכבר נשלחה להם לא נמחקת.'
              : 'כל אחד קיבל ״האקדמיה עוברת לאפליקציה״, וכל מאמן שקיבל מתאמנים — הודעה אחת. השעון שלהם לא משתנה עד שבוע אישי ראשון.'}
          </p>
        </div>
        <div className="mt-3 overflow-hidden rounded-card bg-card divide-y divide-page">
          {done.map((r) => {
            const a = (addable ?? []).find((x) => x.athleteId === r.athleteId);
            return (
              <div key={r.athleteId} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{nameOf(r.athleteId) || r.athleteId}</span>
                  {!r.ok ? <Note tone="warn">{ERROR_TEXT[r.error || ''] || 'לא הועבר'}</Note>
                    : r.unchanged ? <Note tone="mute">כבר באקדמיה</Note>
                      : a && !a.hasWatch ? <Note tone="warn">בלי שעון מחובר · בלי שעון אין לאן לשלוח שבוע</Note>
                        : <Note tone="info">הבא: טסט, דבוקה ומאמן — ב״השלמת פרטים״</Note>}
                </span>
              </div>
            );
          })}
        </div>
        {error && <p className="mt-2 px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{error}</p>}
        {!undone && moved.length > 0 && (
          <button type="button" onClick={() => void undo()} disabled={busy}
            className="mt-3 flex w-full min-h-[44px] items-center justify-center gap-1.5 text-sm font-bold text-ink-400 disabled:opacity-50">
            {busy ? <Spinner size={14} /> : <Undo2 className="h-4 w-4" />}ביטול ההעברה
          </button>
        )}
      </div>
    );
  }

  if (invited) {
    const coach = coachIds.length ? joinHebrewList(coachIds.map((c) => firstName(coachName(c)))) : null;
    const text = `היי ${firstName(invited.name)} 👋 האקדמיה של מדרגות עוברת לאפליקציה. מעכשיו התוכנית שלך, הקצבים לשעון והפידבק${coach ? ` מ־${coach}` : ''} יהיו שם, במקום אחד.\nכניסה בלחיצה, בלי טופס: ${invited.url}\n(ההתחברות עם ${invited.email})`;
    return (
      <div>
        <div className="rounded-card bg-card p-4">
          <p className="text-[15px] font-bold text-ink-700">ההזמנה של {firstName(invited.name)} מוכנה</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">קישור אישי שכבר מאושר: נכנסים ישר לאקדמיה{coach ? `, עם ${coach}` : ''}. בלי טופס ובלי ״ממתין לאישור״.</p>
          <p className="mt-2.5 select-all break-all rounded-xl bg-page px-3 py-2 text-xs text-ink-700"><bdi dir="ltr">{invited.url}</bdi></p>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <a href={waShareUrl(invited.phone, text)} target="_blank" rel="noopener noreferrer"
            className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-[#1FA55B] text-xs font-extrabold text-white">
            <MessageCircle className="h-5 w-5" /> וואטסאפ
          </a>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {}); }}
            className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-card text-xs font-extrabold text-ink-700">
            {copied ? <Check className="h-5 w-5 text-accent-600" /> : <Copy className="h-5 w-5" />}{copied ? 'הועתק' : 'העתקת ההודעה'}
          </button>
        </div>
        <p className="mt-2 px-1 text-xs leading-relaxed text-ink-400">מופיע כבר עכשיו ברשימת המתאמנים, עם ״בלי שעון מחובר״, עד שייכנס בקישור ויחבר שעון.</p>
      </div>
    );
  }

  const modeTabs = (
    <div className="mb-3 flex rounded-xl bg-card p-0.5" role="tablist">
      {([['club', 'מהמועדון'], ['invite', 'עוד לא באפליקציה']] as const).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setError(null); }}
          className={cn('min-h-[38px] flex-1 rounded-[10px] text-[13px] font-extrabold', mode === k ? 'bg-page text-ink-700' : 'text-ink-400')}>
          {label}
        </button>
      ))}
    </div>
  );

  const settings = picker === 'coach' ? (
    <div>
      <CoachesPicker coaches={assignable} value={coachIds} onChange={setCoachIds} sets={[[]]} multi={multiCoach !== false} exclude={[...picked]} onCoachMade={onDone} />
      <button type="button" onClick={() => setPicker(null)} className="mt-2 flex w-full min-h-[48px] items-center justify-center rounded-2xl bg-card text-sm font-extrabold text-brand-600">סיום</button>
    </div>
  ) : picker === 'band' ? (
    <div className="max-h-[220px] overflow-y-auto rounded-card bg-card divide-y divide-page">
      {[...sortBands(bands).map((b) => ({ id: b.id as string | null, label: b.name })), { id: null, label: 'בלי דבוקה · לפי הטסט' }].map((o) => (
        <button key={o.id ?? 'none'} type="button" onClick={() => { setBandId(o.id); setPicker(null); }} className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start">
          <span className={cn('h-[22px] w-[22px] shrink-0 rounded-full border-2', bandId === o.id ? 'border-[7px] border-brand-600' : 'border-ink-300')} />
          <span className="text-[15px] font-semibold text-ink-700">{o.label}</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
      <button type="button" onClick={() => setPicker('coach')} className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start">
        <span className="flex-1 text-[15px] font-semibold text-ink-700">מאמנים</span>
        <span className="truncate text-sm font-bold text-ink-500" dir="auto">{coachIds.length ? joinHebrewList(coachIds.map((c) => firstName(coachName(c)))) : mode === 'club' ? 'המאמן הקודם / בלי' : 'בלי'}</span>
        <span className="shrink-0 text-[13px] font-extrabold text-brand-600">שיבוץ</span>
      </button>
      <button type="button" onClick={() => setPicker('band')} className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start">
        <span className="flex-1 text-[15px] font-semibold text-ink-700">דבוקה באקדמיה</span>
        <span className="truncate text-sm font-bold text-ink-500">{band?.name || 'לפי הטסט'}</span>
        <span className="shrink-0 text-[13px] font-extrabold text-brand-600">שינוי</span>
      </button>
      {mode === 'invite' && (
        <label className="flex w-full min-h-[52px] items-center gap-3 px-4">
          <span className="flex-1 text-[15px] font-semibold text-ink-700">קבוצת קצב</span>
          <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value || null)} className="h-10 max-w-[150px] rounded-lg bg-page px-2 text-sm font-bold text-ink-700 focus:outline-none">
            <option value="">בלי</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{groupDisplayName(g.name)}</option>)}
          </select>
        </label>
      )}
      <label className="flex w-full min-h-[52px] items-center gap-3 px-4">
        <span className="flex-1 text-[15px] font-semibold text-ink-700">מתאמנים אצלנו מאז</span>
        <input type="month" value={since} onChange={(e) => setSince(e.target.value)} dir="ltr"
          className="h-10 rounded-lg bg-page px-2 text-sm font-bold text-ink-700 focus:outline-none" />
      </label>
    </div>
  );

  if (mode === 'invite') {
    const field = (key: 'name' | 'email' | 'phone', label: string, ph: string, ltr?: boolean, hint?: string) => (
      <label className="block">
        <span className="mb-1 block px-1 text-2xs font-bold text-ink-400">{label}</span>
        <input value={inv[key]} onChange={(e) => setInv((v) => ({ ...v, [key]: e.target.value }))} placeholder={ph} dir={ltr ? 'ltr' : 'auto'}
          type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
          className={cn('w-full min-h-[46px] rounded-xl bg-card px-3 text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none', ltr && 'text-end')} />
        {hint && <span className="mt-1 block px-1 text-[11px] text-ink-400">{hint}</span>}
      </label>
    );
    return (
      <>
        {modeTabs}
        <div className="space-y-2">
          {field('name', 'שם', 'שם מלא')}
          {field('email', 'מייל', 'name@example.com', true, 'ההתחברות לאפליקציה היא עם המייל — בלי מייל אי אפשר להזמין.')}
          {field('phone', 'טלפון (לוואטסאפ)', '050-0000000', true)}
        </div>
        <p className="mb-1.5 mt-3 px-1 text-2xs font-bold text-ink-400">מה שכבר ידוע</p>
        {settings}
        <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">קבוצת הקצב קובעת איזו תוכנית מועדון יקבל עד השבוע האישי הראשון.</p>
        {error && <p className="mt-2 px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{error}</p>}
        <button type="button" onClick={() => void invite()} disabled={!inv.name.trim() || !emailOk || busy}
          className="mt-3 flex w-full min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-brand-600 text-base font-extrabold text-white transition-all active:scale-[0.99] disabled:opacity-50">
          {busy && <Spinner size={16} tone="ink" />}
          {inv.name.trim() ? `ליצור הזמנה ל${firstName(inv.name)}` : 'ליצור הזמנה'}
        </button>
      </>
    );
  }

  return (
    <>
      {modeTabs}
      <p className="mb-2 px-1 text-xs leading-relaxed text-ink-400">מי שכבר מתאמן איתנו ועובר לאפליקציה: בלי טופס, בלי שיחות, ישר כמתאמן.</p>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש במועדון"
          className="w-full min-h-[44px] rounded-xl bg-card ps-9 pe-3 text-[16px] text-ink-700 placeholder:text-ink-400 focus:outline-none" />
      </div>
      <div className="max-h-[300px] overflow-y-auto rounded-card bg-card divide-y divide-page">
        {addable === undefined ? (
          <div className="flex justify-center py-6"><Spinner size={18} /></div>
        ) : list.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-ink-400">{query ? 'אין התאמה במועדון' : 'כל חברי המועדון כבר באקדמיה'}</p>
        ) : list.map((a) => (
          <button key={a.athleteId} type="button" onClick={() => toggle(a.athleteId)} aria-pressed={picked.has(a.athleteId)}
            className="flex w-full min-h-[56px] items-center gap-3 px-4 py-2 text-start active:bg-page/60">
            <Box on={picked.has(a.athleteId)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-ink-700" dir="auto">{a.name}</span>
              <span className="block truncate text-xs text-ink-400">{a.groupName || 'בלי דבוקה'}</span>
              {a.openCard && <Note tone="info">יש לו כרטיס במשפך · ייסגר כמתאמן קיים</Note>}
              {a.wasAcademy && !coachIds.length && <Note tone="info">היה באקדמיה · יחזור למאמן הקודם</Note>}
              {a.hasWatch === false && <Note tone="warn">בלי שעון מחובר</Note>}
              {a.isStaff && <Note tone="mute">צוות · יראה את מרכז האקדמיה, לא את מסך המתאמן</Note>}
            </span>
          </button>
        ))}
      </div>

      <p className="mb-1.5 mt-3 px-1 text-2xs font-bold text-ink-400">
        {picked.size > 1 ? `לכל ה־${picked.size} · אפשר לשנות לכל אחד אחר כך` : 'איך מתחילים'}
      </p>
      {settings}
      {error && <p className="mt-2 px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{error}</p>}
      <button type="button" onClick={() => void run()} disabled={!picked.size || busy}
        className="mt-3 flex w-full min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-brand-600 text-base font-extrabold text-white transition-all active:scale-[0.99] disabled:opacity-50">
        {busy && <Spinner size={16} tone="ink" />}
        {!picked.size ? 'לבחור מהרשימה' : picked.size === 1 ? `להעביר את ${firstName(nameOf([...picked][0]))} לאקדמיה` : `להעביר ${picked.size} לאקדמיה`}
      </button>
    </>
  );
}
