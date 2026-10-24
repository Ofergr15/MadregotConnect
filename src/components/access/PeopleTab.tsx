'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { personMatches } from '@/lib/search/match';
import { FeedAvatar } from '@/components/FeedAvatar';
import { CONTENT_TYPES, TYPE_ORDER, type ContentType } from '@/lib/content/hub';
import type { GrantableRole, RolePerson } from '@/lib/auth/roles';
import type { Grants, LogEntry } from '@/lib/access/grants';

// ═════════════════════════════════════════════════════════════════════════════
// הרשאות › אנשים (mockups/access-people.html, Ofer 10-24: "a combination of the
// three — a view where it is clear what each one has, the groups view, and exact
// editing inside"). Two views of the same people — one sentence each, or by group
// with faces — and one page per person where everything is changed: role, switches,
// extra pages, Content, and what they receive. Roles and switches save through
// /api/admin/roles (the same save as the roles screen), Content through /api/admin/access.
// ═════════════════════════════════════════════════════════════════════════════

export type Lvl = 0 | 1 | 2 | 3;
export type G = Grants & { __supers?: string[] };
export const DRAFTABLE: ContentType[] = ['messages', 'surveys', 'cheers', 'circle'];
export const LEVEL_TEXT: Record<Lvl, string> = { 0: 'לא', 1: 'רואה', 2: 'באישור', 3: 'מפרסם' };
const ROLE_ORDER: GrantableRole[] = ['coach', 'academy_coach', 'academy_manager', 'admin'];
const ROLE_HE: Record<string, string> = { admin: 'מנהל', coach: 'מאמן', academy_coach: 'מאמן אקדמיה', academy_manager: 'מנהל אקדמיה' };

export const isSuper = (p: RolePerson, g?: G) => !!g?.__supers?.includes(p.id);
export const isStaff = (p: RolePerson, g?: G) => p.roles.length > 0 || isSuper(p, g);

export function levelOf(p: RolePerson, grants: G, k: ContentType): { level: Lvl; from: 'role' | 'switch' | 'grant' | null } {
  if (isStaff(p, grants)) return { level: 3, from: 'role' };
  if (k === 'share' && p.storyEditor) return { level: 3, from: 'switch' };
  const v = (grants as Grants)[p.id]?.content?.[k];
  return v === 3 || v === 2 || v === 1 ? { level: v, from: 'grant' } : { level: 0, from: null };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`);

/** The person's one-line role, and the one sentence saying what else they have. */
export function roleLine(p: RolePerson, g: G): string {
  if (isSuper(p, g) && !p.roles.includes('admin')) return 'מנהל-על';
  if (p.roles.includes('admin')) return 'מנהל';
  if (p.roles.includes('academy_manager')) return 'מנהל אקדמיה';
  if (p.roles.includes('coach')) return 'מאמן';
  if (p.roles.includes('academy_coach')) return 'מאמן אקדמיה';
  return 'רץ';
}
export function sentence(p: RolePerson, g: G): string {
  if (isSuper(p, g) || p.roles.includes('admin')) return 'רואה ועושה הכל';
  const parts: string[] = [];
  const staffBits: string[] = [];
  if (p.roles.includes('coach')) staffBits.push('עמודי המאמנים');
  if (p.roles.includes('academy_manager')) staffBits.push('כל האקדמיה');
  else if (p.roles.includes('academy_coach')) staffBits.push('המתאמנים שלו באקדמיה');
  if (staffBits.length) parts.push(`${list(staffBits)} · מפרסם בכל התוכן`);
  if (!isStaff(p, g)) {
    const at = (l: Lvl) => TYPE_ORDER.filter((k) => levelOf(p, g, k).level === l).map((k) => CONTENT_TYPES[k].label);
    if (at(3).length) parts.push(`מפרסם ב${list(at(3))}`);
    if (at(2).length) parts.push(`שולח לאישור ב${list(at(2))}`);
    if (at(1).length) parts.push(`רואה ${list(at(1))}`);
  }
  if (p.clubManager) parts.push('רואה מספרים');
  if (p.coreRunner) parts.push('גרעין');
  if (p.academy) parts.push('מתאמן אקדמיה');
  return parts.join(' · ') || 'מה שכל רץ רואה';
}
const special = (p: RolePerson, g: G) => isStaff(p, g) || !!p.storyEditor || !!p.coreRunner || !!p.clubManager || !!p.academy || !!(g as Grants)[p.id]?.content;

// ── the save, for role and switches: the whole state, through the roles route ──
export type Flags = { roles: GrantableRole[]; academy: boolean; storyEditor: boolean; coreRunner: boolean; clubManager: boolean };
export const flagsOf = (p: RolePerson): Flags => ({ roles: p.roles, academy: !!p.academy, storyEditor: !!p.storyEditor, coreRunner: !!p.coreRunner, clubManager: !!p.clubManager });
export async function saveFlags(athleteId: string, f: Flags): Promise<string | null> {
  const res = await fetch('/api/admin/roles', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, ...f }) });
  if (res.ok) return null;
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  return out.error === 'You cannot remove your own admin role.' ? 'אי אפשר להוריד לעצמך את תפקיד המנהל.' : res.status === 403 ? 'רק מי שמורשה לתת "מנהל" יכול לשנות את זה.' : 'לא נשמר. אפשר לנסות שוב.';
}

type GroupKey = 'admin' | 'coach' | 'academy_manager' | 'academy_coach' | 'share' | 'content' | 'numbers' | 'core' | 'trainee';
const GROUPS: Array<{ key: GroupKey; title: string; sub: string; color: string; has: (p: RolePerson, g: G) => boolean; add?: (f: Flags) => Flags }> = [
  { key: 'admin', title: 'מנהלים', sub: 'רואים ועושים הכל, כולל ההרשאות', color: '#5B2DB8', has: (p, g) => p.roles.includes('admin') || isSuper(p, g), add: (f) => ({ ...f, roles: [...f.roles, 'admin'] }) },
  { key: 'coach', title: 'מאמנים', sub: 'עמודי המאמנים, משוב ונוכחות, מפרסמים בתוכן', color: '#174EA6', has: (p) => p.roles.includes('coach'), add: (f) => ({ ...f, roles: [...f.roles, 'coach'] }) },
  { key: 'academy_manager', title: 'מנהלי אקדמיה', sub: 'כל האקדמיה: כל המתאמנים, המועמדים, השיבוץ והלוח', color: '#0B6B35', has: (p) => p.roles.includes('academy_manager'), add: (f) => ({ ...f, roles: [...f.roles, 'academy_manager'] }) },
  { key: 'academy_coach', title: 'מאמני אקדמיה', sub: 'רק המתאמנים שלהם: התוכנית, המשוב, הטסטים', color: '#34a853', has: (p) => p.roles.includes('academy_coach'), add: (f) => ({ ...f, roles: [...f.roles, 'academy_coach'] }) },
  { key: 'share', title: 'משתפי האימון', sub: 'בוחרים רץ מכל דבוקה ומשתפים, מקבלים את ההתראה של הבוקר', color: '#B0186F', has: (p) => !!p.storyEditor, add: (f) => ({ ...f, storyEditor: true }) },
  { key: 'content', title: 'מפרסמים בתוכן', sub: 'מי שאינו בצוות ויש לו חלק בתוכן — בדף של כל אחד', color: '#6d3fd6', has: (p, g) => !isStaff(p, g) && !!(g as Grants)[p.id]?.content },
  { key: 'numbers', title: 'רואים מספרים', sub: 'עמוד "מדרגות במספרים", בלי תפקיד', color: '#ff9500', has: (p) => !!p.clubManager, add: (f) => ({ ...f, clubManager: true }) },
  { key: 'core', title: 'גרעין', sub: 'נספרים כרצי גרעין במספרים ובטבלאות', color: '#8A4A0B', has: (p) => !!p.coreRunner, add: (f) => ({ ...f, coreRunner: true }) },
  { key: 'trainee', title: 'מתאמני אקדמיה', sub: 'רצים באקדמיה', color: '#0f9d6b', has: (p) => !!p.academy, add: (f) => ({ ...f, academy: true }) },
];

export function PeopleTab({ people, grants, onOpen, onChanged }: { people: RolePerson[]; grants: G; onOpen: (p: RolePerson) => void; onChanged: () => void }) {
  const [view, setView] = useState<'person' | 'group'>('person');
  const [filter, setFilter] = useState<'special' | 'staff' | 'core' | 'all'>('special');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<(typeof GROUPS)[number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const searched = q.trim() ? people.filter((p) => personMatches(p.name, q)) : people;
  const order = (a: RolePerson, b: RolePerson) => Number(isStaff(b, grants)) - Number(isStaff(a, grants)) || a.name.localeCompare(b.name);
  const filtered = (q.trim() ? searched
    : filter === 'staff' ? searched.filter((p) => isStaff(p, grants))
      : filter === 'core' ? searched.filter((p) => p.coreRunner)
        : filter === 'all' ? searched : searched.filter((p) => special(p, grants))).slice().sort(order);
  const count = (f: typeof filter) => (f === 'staff' ? people.filter((p) => isStaff(p, grants)) : f === 'core' ? people.filter((p) => p.coreRunner) : f === 'all' ? people : people.filter((p) => special(p, grants))).length;

  return (
    <>
      <div className="mb-2 flex gap-[3px] rounded-[10px] bg-[#e4e4ea] p-[3px]">
        {([['person', 'כל אחד ומה יש לו'], ['group', 'לפי קבוצות']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            className={cn('min-h-[32px] flex-1 rounded-[8px] text-[13px] font-bold', view === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>{l}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש" aria-label="חיפוש" className="mb-2 min-h-[42px] w-full rounded-[11px] bg-[#e4e4ea] px-3 text-base" />
      {msg && <p role="status" className="mb-2 rounded-[12px] bg-card px-3 py-2 text-13 font-bold text-ink-700">{msg}</p>}

      {view === 'person' && (
        <>
          {!q.trim() && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {([['special', 'עם תפקיד או הרשאה'], ['staff', 'צוות'], ['core', 'גרעין'], ['all', 'כולם']] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={cn('min-h-[32px] rounded-full px-3 text-[12.5px] font-bold', filter === k ? 'bg-ink-900 text-white' : 'bg-card text-ink-600')}>
                  {l}<span className="ms-1 opacity-60">{count(k)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-[16px] bg-card">
            {filtered.map((p) => (
              <button key={p.id} type="button" onClick={() => onOpen(p)} className="flex w-full items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2.5 text-start first:border-t-0 active:bg-page">
                <FeedAvatar name={p.name} url={p.avatarUrl} className="h-9 w-9 shrink-0 text-[12px]" />
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[14.5px] text-ink-900">{p.name}</b>
                  <small className="block text-[12px] leading-snug text-ink-500">{sentence(p, grants)}</small>
                </span>
                <span className={cn('shrink-0 rounded-[7px] px-2 py-[3px] text-[11px] font-extrabold', isStaff(p, grants) ? 'bg-[#EDE7FB] text-[#5B2DB8]' : 'bg-page text-ink-500')}>{roleLine(p, grants)}</span>
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3.5 py-3.5 text-13 text-ink-400">אין כאן אף אחד.</p>}
          </div>
        </>
      )}

      {view === 'group' && GROUPS.map((gr) => {
        const members = searched.filter((p) => gr.has(p, grants));
        return (
          <section key={gr.key} className="mb-2.5 rounded-[16px] bg-card px-3 pb-1.5 pt-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: gr.color }} />
              <b className="flex-1 text-[15.5px] text-ink-900">{gr.title}</b>
              <span className="text-12 font-extrabold text-ink-400 tabular-nums">{members.length}</span>
            </div>
            <small className="mb-2 mt-0.5 block ps-[18px] text-[12px] text-ink-500">{gr.sub}</small>
            <div className="flex gap-2.5 overflow-x-auto pb-1.5">
              {members.map((p) => (
                <button key={p.id} type="button" onClick={() => onOpen(p)} className="flex w-[52px] shrink-0 flex-col items-center gap-1">
                  <FeedAvatar name={p.name} url={p.avatarUrl} className="h-10 w-10 text-[12px]" />
                  <span dir="auto" className="block max-w-[52px] truncate text-[11px] text-ink-700">{p.name.split(' ')[0]}</span>
                </button>
              ))}
              {gr.add && (
                <button type="button" onClick={() => setAdding(gr)} className="flex w-[52px] shrink-0 flex-col items-center gap-1" aria-label={`הוספה ל${gr.title}`}>
                  <span className="grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-dashed border-[#d1d5db] text-[18px] font-bold text-ink-400">+</span>
                  <span className="text-[11px] text-ink-400">הוספה</span>
                </button>
              )}
            </div>
          </section>
        );
      })}

      {adding && (
        <div className="fixed inset-0 z-[320] flex items-end bg-black/40" onClick={() => setAdding(null)} dir="rtl">
          <div className="max-h-[75vh] w-full overflow-y-auto rounded-t-[22px] bg-white px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-center text-[16px] font-extrabold text-ink-900">הוספה ל{adding.title}</p>
            <PickPerson people={people.filter((p) => !adding.has(p, grants))} onPick={async (p) => {
              const err = await saveFlags(p.id, adding.add!(flagsOf(p)));
              setMsg(err ?? `✓ ${p.name} נוסף ל${adding.title}`);
              setAdding(null);
              onChanged();
            }} />
          </div>
        </div>
      )}
    </>
  );
}

export function PickPerson({ people, onPick }: { people: RolePerson[]; onPick: (p: RolePerson) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (q.trim() ? people.filter((p) => personMatches(p.name, q)) : people).slice(0, 40), [people, q]);
  return (
    <div dir="rtl">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש רץ" aria-label="חיפוש רץ" className="mb-2 min-h-[44px] w-full rounded-[11px] bg-page px-3 text-base" />
      {shown.map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p)} className="flex min-h-[48px] w-full items-center gap-2.5 px-1 text-start">
          <FeedAvatar name={p.name} url={p.avatarUrl} className="h-8 w-8 text-[11px]" /><span dir="auto" className="text-[15px] text-ink-900">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

// ── one person, everything about them ─────────────────────────────────────────
interface Routed { kind: string; label: string; roles: Record<string, boolean> }

export function PersonPage({ p, grants, log, onBack, onChanged, onSetLevel, busy }: {
  p: RolePerson; grants: G; log: LogEntry[]; onBack: () => void; onChanged: () => void;
  onSetLevel: (k: ContentType, l: Lvl) => void; busy: boolean;
}) {
  const { data: routing } = useApi<{ kinds: Routed[] }>('/api/admin/notifications');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = flagsOf(p);
  const sup = isSuper(p, grants);
  const save = async (next: Flags) => {
    setSaving(true); setErr(null);
    try { const e = await saveFlags(p.id, next); setErr(e); onChanged(); } finally { setSaving(false); }
  };
  const roleSet = new Set(p.roles);
  const receives = (routing?.kinds ?? []).filter((k) => sup || [...roleSet].some((r) => k.roles[r]) || (sup && k.roles.admin)).map((k) => k.label);
  const mine = log.filter((e) => e.athleteId === p.id).slice(0, 6);
  const first = p.name.split(' ')[0];

  return (
    <div className="pb-10" dir="rtl">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ הרשאות</button>
      <div className="flex items-center gap-3 px-0.5 pb-2.5">
        <FeedAvatar name={p.name} url={p.avatarUrl} className="h-14 w-14 shrink-0 text-[17px]" />
        <span className="min-w-0"><b dir="auto" className="block text-[21px] font-extrabold text-ink-900">{p.name}</b><small className="text-13 text-ink-500">{roleLine(p, grants)}</small></span>
      </div>
      <p className="rounded-[16px] bg-card px-3.5 py-3 text-[14px] leading-relaxed text-ink-700"><b className="text-ink-900">{first}</b> — {sentence(p, grants)}.</p>
      {err && <p role="alert" className="mt-2 rounded-[12px] bg-[#FEE2E2] px-3 py-2 text-13 font-bold text-[#b91c1c]">{err}</p>}

      <Q>מה התפקיד שלו?</Q>
      <div className="rounded-[16px] bg-card px-3 py-2.5">
        {sup ? <p className="text-13 text-ink-600">מנהל-על — רואה ועושה הכל. לא משתנה מכאן.</p> : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <RoleChip on={!p.roles.length} label="רץ" disabled={saving} onClick={() => p.roles.length && void save({ ...f, roles: [] })} />
              {ROLE_ORDER.map((r) => (
                <RoleChip key={r} on={roleSet.has(r)} label={ROLE_HE[r]} disabled={saving}
                  onClick={() => void save({ ...f, roles: roleSet.has(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r] })} />
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-400">אפשר כמה ביחד (למשל מאמן וגם מאמן אקדמיה). מי שמקבל תפקיד חדש מקבל התראה.</p>
          </>
        )}
      </div>

      <Q>מה עוד מותר לו?</Q>
      <div className="overflow-hidden rounded-[16px] bg-card">
        <SwitchRow label="שיתוף האימון (אינסטגרם)" sub="בוחר רץ מכל דבוקה ומשתף, מקבל את ההתראה של הבוקר" on={f.storyEditor} disabled={saving} onToggle={() => void save({ ...f, storyEditor: !f.storyEditor })} />
        <SwitchRow label="גרעין" sub="נספר כרץ גרעין במספרים ובטבלאות" on={f.coreRunner} disabled={saving} onToggle={() => void save({ ...f, coreRunner: !f.coreRunner })} />
        <SwitchRow label="מתאמן אקדמיה" sub="רץ באקדמיה" on={f.academy} disabled={saving} onToggle={() => void save({ ...f, academy: !f.academy })} />
      </div>

      <Q>אילו עמודים נוספים הוא רואה? <span className="font-semibold text-ink-400">— מעבר לתפקיד</span></Q>
      <div className="overflow-hidden rounded-[16px] bg-card">
        {isStaff(p, grants) && !p.clubManager && (p.roles.includes('admin') || sup)
          ? <p className="px-3.5 py-3 text-13 text-ink-500">כמנהל, רואה את כל העמודים.</p>
          : <SwitchRow label="מספרים" sub="מדרגות במספרים — כמה רצים, ק״מ, צמיחה, דבוקות" on={f.clubManager} disabled={saving} onToggle={() => void save({ ...f, clubManager: !f.clubManager })} />}
        {!isStaff(p, grants) && (
          <div className="flex min-h-[50px] items-center gap-2.5 border-t-[0.5px] border-black/[0.07] px-3 py-2">
            <span className="min-w-0 flex-1"><b className="block text-[14px] text-ink-900">תוכן</b><small className="block text-[11.5px] text-ink-400">נפתח לבד כשיש לו חלק בתוכן (למטה)</small></span>
            <span className={cn('rounded-full px-2 py-1 text-[11px] font-extrabold', TYPE_ORDER.some((k) => levelOf(p, grants, k).level >= 1) ? 'bg-[#E6F4EC] text-[#0B6B35]' : 'bg-page text-ink-400')}>
              {TYPE_ORDER.some((k) => levelOf(p, grants, k).level >= 1) ? 'פתוח' : 'סגור'}
            </span>
          </div>
        )}
      </div>

      <Q>מה הוא עושה בתוכן?</Q>
      <div className="overflow-hidden rounded-[16px] bg-card">
        {TYPE_ORDER.map((k) => {
          const { level, from } = levelOf(p, grants, k);
          const locked = from === 'role' || from === 'switch';
          return (
            <div key={k} className="flex items-center gap-2 border-t-[0.5px] border-black/[0.06] px-3 py-2 first:border-t-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CONTENT_TYPES[k].color }} />
              <b className="flex-1 text-[13.5px] text-ink-900">{CONTENT_TYPES[k].label}</b>
              {locked ? (
                <span className="rounded-full bg-[#E6F4EC] px-2 py-1 text-[11px] font-extrabold text-[#0B6B35]">מפרסם · {from === 'role' ? 'מהתפקיד' : 'מ״שיתוף האימון״'}</span>
              ) : (
                <span className="flex gap-0.5 rounded-[9px] bg-page p-0.5">
                  {((DRAFTABLE.includes(k) ? [0, 1, 2, 3] : [0, 1, 3]) as Lvl[]).map((l) => (
                    <button key={l} type="button" disabled={busy} aria-pressed={level === l} onClick={() => level !== l && onSetLevel(k, l)}
                      className={cn('min-h-[30px] rounded-[7px] px-2 text-[11.5px] font-extrabold', level === l ? (l === 3 ? 'bg-[#DCFCE7] text-[#15803d]' : l === 2 ? 'bg-[#FEF3C7] text-[#b45309]' : l === 1 ? 'bg-[#EEF0FF] text-[#1D2A99]' : 'bg-white text-ink-700') : 'text-ink-400')}>{LEVEL_TEXT[l]}</button>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Q>אילו התראות ניהול הוא מקבל?</Q>
      <div className="rounded-[16px] bg-card px-3.5 py-3 text-13 leading-relaxed text-ink-600">
        {receives.length ? receives.join(' · ') : 'אף אחת.'}
        <small className="mt-1 block text-[11.5px] text-ink-400">נקבע לפי התפקיד, בלשונית ״התראות״.</small>
      </div>

      <Q>שינויים אחרונים</Q>
      <div className="overflow-hidden rounded-[16px] bg-card">
        {mine.length === 0 && <p className="px-3.5 py-3 text-13 text-ink-400">עוד לא שונה אצלו כלום מכאן.</p>}
        {mine.map((e, i) => (
          <div key={i} className="border-t-[0.5px] border-black/[0.07] px-3.5 py-2.5 first:border-t-0">
            <b className="block text-[13px] text-ink-900">{logText(e)}</b>
            <small className="block text-[11px] text-ink-400">{e.byName ?? '—'} · {dm(e.at)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function logText(e: LogEntry): string {
  if (e.what) return e.what;
  const k = e.kind ? CONTENT_TYPES[e.kind as ContentType]?.label ?? e.kind : '';
  return `${k}: ${LEVEL_TEXT[(e.from ?? 0) as Lvl]} ← ${LEVEL_TEXT[(e.to ?? 0) as Lvl]}`;
}
export const dm = (iso: string) => { const d = new Date(iso); return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function Q({ children }: { children: React.ReactNode }) {
  return <p className="px-1 pb-1.5 pt-4 text-[13px] font-extrabold text-ink-900">{children}</p>;
}
function RoleChip({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-pressed={on} onClick={onClick} className={cn('min-h-[34px] rounded-full px-3 text-[13px] font-bold disabled:opacity-60', on ? 'bg-ink-900 text-white' : 'bg-page text-ink-600')}>{label}</button>;
}
function SwitchRow({ label, sub, on, disabled, onToggle }: { label: string; sub?: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-t-[0.5px] border-black/[0.07] px-3 py-2 first:border-t-0">
      <span className="min-w-0 flex-1"><b className="block text-[14px] text-ink-900">{label}</b>{sub && <small className="block text-[11.5px] leading-snug text-ink-400">{sub}</small>}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle}
        className={cn('relative h-[28px] w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-[#34C759]' : 'bg-[#d4d4d8]')}>
        <span className={cn('absolute top-[2px] h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'right-[20px]' : 'right-[2px]')} />
      </button>
    </div>
  );
}
