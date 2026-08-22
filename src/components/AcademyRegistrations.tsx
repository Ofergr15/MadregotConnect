'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Check, Trash2, Mail, Phone, ExternalLink, Copy, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { canApprove } from '@/lib/constants';
import { Spinner, SkeletonList, EmptyState, ConfirmSheet } from '@/components/ui';

interface Registration {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  approved: boolean;
  hasGarmin: boolean;
  onboardingStatus: string | null;
  intake: Record<string, any> | null;
  createdAt: string;
}

// Human labels for the intake keys (match the public form).
const LABELS: Record<string, string> = {
  focus: 'מה מדבר אליך יותר',
  age: 'גיל',
  weight: 'משקל',
  height: 'גובה',
  city: 'מקום מגורים',
  maritalStatus: 'סטטוס משפחתי',
  goal: 'מטרת ההשתתפות',
  group: 'דבוקה',
  runningHistory: 'עבר ריצה (שנה אחרונה)',
  achievements: 'הישגים',
  strava: 'סטראבה',
  medicalHistory: 'עבר רפואי',
  medicalDetails: 'פירוט רפואי',
  hearAbout: 'איך שמע/ה עלינו',
  instagram: 'אינסטגרם',
  shirtSize: 'מידת חולצה',
};

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

const FORM_PATH = '/academy-register';

export function AcademyRegistrations() {
  const [regs, setRegs] = useState<Registration[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  // Only allowlisted accounts may approve; server re-checks in /api/admin/approve.
  const [canApproveHere, setCanApproveHere] = useState(false);

  useEffect(() => {
    const me = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    setCanApproveHere(canApprove(me));
  }, []);

  const fetchRegs = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/academy/registrations${all ? '?all=1' : ''}`);
      const data = await res.json();
      setRegs(data.registrations || []);
    } catch (err) {
      console.error('Failed to fetch registrations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRegs(showAll); }, [showAll, fetchRegs]);

  const approve = async (id: string) => {
    setBusy(id);
    const approverEmail = typeof window !== 'undefined'
      ? (localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '')
      : '';
    try {
      await fetch('/api/admin/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId: id, approverEmail }),
      });
      fetchRegs(showAll);
    } catch { /* ignore */ } finally { setBusy(null); }
  };

  const reject = async (id: string) => {
    setBusy(id);
    setRegs(prev => prev.filter(r => r.id !== id));
    try { await fetch(`/api/athletes?id=${id}`, { method: 'DELETE' }); }
    catch { fetchRegs(showAll); } finally { setBusy(null); }
  };

  const formUrl = typeof window !== 'undefined' ? `${window.location.origin}${FORM_PATH}` : FORM_PATH;
  const copyLink = () => {
    navigator.clipboard?.writeText(formUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <SkeletonList count={4} />;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Share the form */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
        <div>
          <div className="text-sm font-semibold text-white">טופס הרשמה</div>
          <div className="text-xs text-slate-400">אפשר לשלוח קישור זה במקום טופס גוגל.</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={FORM_PATH} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white">
            <ExternalLink className="h-4 w-4" /> פתיחה
          </a>
          <button onClick={copyLink}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-primary-600 hover:bg-primary-500 text-sm text-white font-semibold">
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'הועתק' : 'העתקת קישור'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1 w-fit">
        {([['pending', 'מחכות לאישור'], ['all', 'הכול']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setShowAll(k === 'all')}
            className={cn('px-4 min-h-[44px] rounded-lg text-sm font-semibold transition-colors',
              (showAll ? 'all' : 'pending') === k ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      {regs.length === 0 ? (
        <EmptyState
          title={showAll ? 'עדיין אין הרשמות לאקדמיה' : 'אין הרשמות שמחכות לאישור'}
          description="הרשמות חדשות מהטופס יופיעו כאן."
        />
      ) : (
        <div className="space-y-2">
          {regs.map(r => {
            const open = expanded === r.id;
            return (
              <div key={r.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className="bg-primary-600/20 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 shrink-0">
                    {initialsOf(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate" dir="auto">{r.name}</div>
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3" dir="ltr">
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{r.email}</span>
                      {r.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                    </div>
                  </div>
                  {r.approved ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-4 w-4" /> {r.hasGarmin ? 'פעיל/ה' : 'אושר'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-400 shrink-0">
                      <Clock className="h-4 w-4" /> מחכה
                    </span>
                  )}
                  {r.intake && (
                    <button onClick={() => setExpanded(open ? null : r.id)} className="p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 min-h-[44px] min-w-[44px]">
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                </div>

                {open && r.intake && (
                  <div className="border-t border-slate-700/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {Object.entries(r.intake).map(([k, v]) => (
                      <div key={k} className="text-sm">
                        <span className="text-slate-500">{LABELS[k] || k}: </span>
                        <span className="text-slate-200">{Array.isArray(v) ? v.join(', ') : String(v || '—')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {!r.approved && (
                  <div className="border-t border-slate-700/50 p-3 flex items-center justify-end gap-2">
                    <button onClick={() => setRejectTarget(r.id)} disabled={busy === r.id}
                      className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-red-300 hover:bg-red-500/10 text-sm font-semibold disabled:opacity-50">
                      <Trash2 className="h-4 w-4" /> דחייה
                    </button>
                    {canApproveHere ? (
                      <button onClick={() => approve(r.id)} disabled={busy === r.id}
                        className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                        {busy === r.id ? <Spinner size={16} /> : <Check className="h-4 w-4" />} אישור
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-slate-500 px-2">האישור מוגבל למאמני המועדון</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmSheet
        open={!!rejectTarget}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        title="דחיית הרשמה"
        description="הרישום יוסר לצמיתות. לא ניתן לשחזר."
        confirmLabel="דחייה והסרה"
        cancelLabel="ביטול"
        onConfirm={() => { if (rejectTarget) reject(rejectTarget); }}
      />
    </div>
  );
}
