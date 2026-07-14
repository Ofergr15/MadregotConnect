'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronDown, ChevronUp, Check, Trash2, Mail, Phone, ExternalLink, Copy, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    if (!window.confirm('Reject and remove this registration?')) return;
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

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Share the form */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
        <div>
          <div className="text-sm font-semibold text-white">Registration form</div>
          <div className="text-xs text-slate-400">Share this link instead of the Google Form.</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={FORM_PATH} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white">
            <ExternalLink className="h-4 w-4" /> Open
          </a>
          <button onClick={copyLink}
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary-600 hover:bg-primary-500 text-sm text-white font-semibold">
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1 w-fit">
        {([['pending', 'Awaiting approval'], ['all', 'All']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setShowAll(k === 'all')}
            className={cn('px-4 h-9 rounded-lg text-sm font-semibold transition-colors',
              (showAll ? 'all' : 'pending') === k ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      {regs.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
          <p className="text-slate-300 font-medium">{showAll ? 'No academy registrations yet' : 'No pending registrations'}</p>
          <p className="text-sm text-slate-500 mt-1">New sign-ups from the form appear here for review.</p>
        </div>
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
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3">
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{r.email}</span>
                      {r.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                    </div>
                  </div>
                  {r.approved ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-4 w-4" /> {r.hasGarmin ? 'Active' : 'Approved'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-400 shrink-0">
                      <Clock className="h-4 w-4" /> Pending
                    </span>
                  )}
                  {r.intake && (
                    <button onClick={() => setExpanded(open ? null : r.id)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                </div>

                {open && r.intake && (
                  <div className="border-t border-slate-700/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2" dir="rtl">
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
                    <button onClick={() => reject(r.id)} disabled={busy === r.id}
                      className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-red-300 hover:bg-red-500/10 text-sm font-semibold disabled:opacity-50">
                      <Trash2 className="h-4 w-4" /> Reject
                    </button>
                    <button onClick={() => approve(r.id)} disabled={busy === r.id}
                      className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                      {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
