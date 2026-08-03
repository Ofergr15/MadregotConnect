'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Send, Trash2, Loader2, Clock, Repeat, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Group { id: string; name: string; }
interface Athlete { id: string; name: string; email: string; }
interface NotificationRow {
  id: string;
  title_he: string; body_he: string;
  title_en: string | null; body_en: string | null;
  audience_type: string; audience_id: string | null;
  schedule_type: string; scheduled_at: string | null;
  recur_interval: number | null; recur_unit: string | null;
  next_run_at: string | null; status: string;
  last_sent_at: string | null; sent_count: number; created_at: string;
}

export function NotificationCenter() {
  const [actorEmail, setActorEmail] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // compose form
  const [titleHe, setTitleHe] = useState('');
  const [bodyHe, setBodyHe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [audienceType, setAudienceType] = useState<'all' | 'group' | 'athlete'>('all');
  const [audienceId, setAudienceId] = useState('');
  const [scheduleType, setScheduleType] = useState<'now' | 'once_at' | 'recurring'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurUnit, setRecurUnit] = useState<'day' | 'week'>('week');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      setList(data.notifications || []);
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setActorEmail(localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '');
    fetch('/api/groups').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.groups) setGroups(d.groups.map((g: any) => ({ id: g.id, name: g.name })));
    }).catch(() => {});
    fetch('/api/admin/users').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
    }).catch(() => {});
    loadList();
  }, [loadList]);

  const reset = () => {
    setTitleHe(''); setBodyHe(''); setTitleEn(''); setBodyEn('');
    setAudienceType('all'); setAudienceId('');
    setScheduleType('now'); setScheduledAt(''); setRecurInterval(1); setRecurUnit('week');
  };

  const submit = async () => {
    if (!titleHe.trim() || !bodyHe.trim()) { setMsg('כותרת ותוכן בעברית נדרשים'); return; }
    if (audienceType !== 'all' && !audienceId) { setMsg('בחרו קהל יעד'); return; }
    if ((scheduleType === 'once_at' || scheduleType === 'recurring') && !scheduledAt) {
      setMsg('בחרו תאריך ושעה'); return;
    }
    setSending(true); setMsg(null);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorEmail,
          title_he: titleHe, body_he: bodyHe,
          title_en: titleEn || null, body_en: bodyEn || null,
          audience_type: audienceType,
          audience_id: audienceType === 'all' ? null : audienceId,
          schedule_type: scheduleType,
          scheduled_at: scheduleType === 'now' ? null : new Date(scheduledAt).toISOString(),
          recur_interval: scheduleType === 'recurring' ? recurInterval : null,
          recur_unit: scheduleType === 'recurring' ? recurUnit : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMsg(scheduleType === 'now' ? `נשלח ל-${data.sent ?? 0} מכשירים` : 'התזמון נשמר');
      reset();
      loadList();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/notifications?id=${id}&actorEmail=${encodeURIComponent(actorEmail)}`, { method: 'DELETE' });
    loadList();
  };
  const cancel = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, actorEmail, status: 'cancelled' }),
    });
    loadList();
  };

  const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#4338ff]';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Compose */}
      <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-[#4338ff]" />
          <h3 className="font-bold text-white">שליחת התראה / New notification</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-400">כותרת (עברית)</label>
            <input dir="rtl" value={titleHe} onChange={e => setTitleHe(e.target.value)} className={inputCls} placeholder="לדוגמה: אימון היום ב-18:00" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400">תוכן (עברית)</label>
            <textarea dir="rtl" value={bodyHe} onChange={e => setBodyHe(e.target.value)} rows={2} className={inputCls} placeholder="פרטי ההתראה" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-400">Title (English)</label>
              <input value={titleEn} onChange={e => setTitleEn(e.target.value)} className={inputCls} placeholder="optional" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400">Body (English)</label>
              <input value={bodyEn} onChange={e => setBodyEn(e.target.value)} className={inputCls} placeholder="optional" />
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="text-xs font-semibold text-slate-400">קהל יעד / Audience</label>
            <div className="flex gap-2 mt-1">
              <select value={audienceType} onChange={e => { setAudienceType(e.target.value as any); setAudienceId(''); }} className={inputCls}>
                <option value="all">כל הרצים / All</option>
                <option value="group">קבוצה / Group</option>
                <option value="athlete">אדם ספציפי / Person</option>
              </select>
              {audienceType === 'group' && (
                <select value={audienceId} onChange={e => setAudienceId(e.target.value)} className={inputCls}>
                  <option value="">בחרו קבוצה…</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
              {audienceType === 'athlete' && (
                <select value={audienceId} onChange={e => setAudienceId(e.target.value)} className={inputCls}>
                  <option value="">בחרו רץ…</option>
                  {athletes.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <label className="text-xs font-semibold text-slate-400">תזמון / Schedule</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {(['now', 'once_at', 'recurring'] as const).map(s => (
                <button key={s} onClick={() => setScheduleType(s)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition',
                    scheduleType === s ? 'bg-[#4338ff] text-white' : 'bg-slate-700/40 text-slate-400 hover:text-white')}>
                  {s === 'now' ? 'עכשיו / Now' : s === 'once_at' ? 'בזמן מסוים / At time' : 'חוזר / Recurring'}
                </button>
              ))}
            </div>
          </div>
          {(scheduleType === 'once_at' || scheduleType === 'recurring') && (
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputCls} />
          )}
          {scheduleType === 'recurring' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">כל / every</span>
              <input type="number" min={1} value={recurInterval} onChange={e => setRecurInterval(Number(e.target.value))} className="w-20 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-white" />
              <select value={recurUnit} onChange={e => setRecurUnit(e.target.value as any)} className={inputCls}>
                <option value="day">ימים / days</option>
                <option value="week">שבועות / weeks</option>
              </select>
            </div>
          )}

          {msg && <p className="text-sm text-[#4338ff]">{msg}</p>}

          <button onClick={submit} disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 bg-[#4338ff] hover:bg-[#3730d4] disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {scheduleType === 'now' ? 'שליחה עכשיו / Send now' : 'תזמון / Schedule'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-5">
        <h3 className="font-bold text-white mb-4">התראות / Notifications</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">אין התראות עדיין</p>
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-y-auto scrollbar-thin">
            {list.map(n => (
              <div key={n.id} className="bg-slate-900/40 rounded-xl border border-slate-700/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate" dir="auto">{n.title_he}</p>
                    <p className="text-xs text-slate-400 truncate" dir="auto">{n.body_he}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                      {n.status === 'sent' ? <CheckCircle className="w-3 h-3 text-green-400" />
                        : n.schedule_type === 'recurring' ? <Repeat className="w-3 h-3 text-[#4338ff]" />
                        : <Clock className="w-3 h-3 text-amber-400" />}
                      <span>
                        {n.status === 'sent' ? `נשלח (${n.sent_count})`
                          : n.status === 'cancelled' ? 'בוטל'
                          : n.schedule_type === 'recurring' ? `כל ${n.recur_interval} ${n.recur_unit === 'week' ? 'שבועות' : 'ימים'}`
                          : n.next_run_at ? new Date(n.next_run_at).toLocaleString('he-IL') : 'מתוזמן'}
                      </span>
                      <span>· {n.audience_type === 'all' ? 'הכל' : n.audience_type === 'group' ? 'קבוצה' : 'אדם'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {n.status === 'scheduled' && (
                      <button onClick={() => cancel(n.id)} title="ביטול" className="text-slate-500 hover:text-amber-400 p-1">
                        <Clock className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => remove(n.id)} title="מחיקה" className="text-slate-500 hover:text-red-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
