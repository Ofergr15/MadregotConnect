'use client';

import { AlertTriangle, PartyPopper, Bell, Activity } from 'lucide-react';
import Link from 'next/link';
import { formatTime } from '@/lib/academy/benchmark';
import { useApi } from '@/lib/api';
import { Card, SkeletonCard } from '@/components/ui';

interface Attn {
  athleteId: string; name: string; avatarUrl: string | null; squad: string | null; squadColor: string | null;
  reasons: string[]; painTimes: number; painDetail: string | null; when: string;
}
interface Celeb {
  athleteId: string; name: string; avatarUrl: string | null; squadColor: string | null;
  kind: string; label: string; seconds: number; when: string;
}

// Coach Pulse — a coach-facing radar at the top of the coach dashboard: who needs
// attention (pain / wants-feedback / very hard) and who to celebrate (fresh PRs),
// from existing feedback + activity data. Staff-only; hidden when nothing to show.
interface PulseData { attention?: Attn[]; celebrate?: Celeb[]; }

export function CoachPulse() {
  const { data } = useApi<PulseData>('/api/coach/pulse?days=14');

  if (!data) return <SkeletonCard className="mb-4" />; // true first load → shaped skeleton

  const attention = data.attention || [];
  const celebrate = data.celebrate || [];

  if (attention.length === 0 && celebrate.length === 0) return null; // loaded but nothing to show → hide

  const initials = (n: string) => (n.split(' ').map((x) => x[0]).join('').toUpperCase().slice(0, 2)) || '?';
  const Avatar = ({ url, name }: { url: string | null; name: string }) =>
    url ? <img src={url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
      : <span className="w-8 h-8 rounded-full bg-page flex items-center justify-center text-2xs font-bold text-ink-700 shrink-0">{initials(name)}</span>;

  const reasonLabel = (a: Attn) => {
    if (a.painTimes >= 2) return `כאב ×${a.painTimes}${a.painDetail ? ` · ${a.painDetail}` : ''}`;
    if (a.reasons.includes('pain')) return `כאב${a.painDetail ? ` · ${a.painDetail}` : ''}`;
    if (a.reasons.includes('wants')) return 'ביקש/ה משוב';
    return 'אימון קשה מאוד';
  };

  return (
    <Card variant="solid" className="mb-4" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">דופק המאמן</h2>
        <span className="ms-auto text-2xs text-ink-400">14 ימים</span>
      </div>

      {attention.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2"><AlertTriangle className="h-3.5 w-3.5 text-band-3" /><span className="text-xs font-bold text-band-3">דורש תשומת לב</span></div>
          <div className="space-y-1.5">
            {attention.slice(0, 5).map((a) => (
              <Link key={a.athleteId} href="/dashboard/workout-feedback" className="flex items-center gap-3 bg-page/50 rounded-2xl p-2.5 active:bg-page/40 transition-colors">
                <Avatar url={a.avatarUrl} name={a.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-700 truncate" dir="auto">{a.name}</span>
                    {a.squad && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.squadColor || '#159AFF' }} />}
                  </div>
                  <span className="block text-xs text-band-3/90 truncate">{reasonLabel(a)}</span>
                </div>
                {a.reasons.includes('wants') && <Bell className="h-3.5 w-3.5 text-band-2 shrink-0" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      {celebrate.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2"><PartyPopper className="h-3.5 w-3.5 text-accent-600" /><span className="text-xs font-bold text-accent-600">לחגוג 🎉</span></div>
          <div className="space-y-1.5">
            {celebrate.slice(0, 5).map((c, i) => (
              <div key={`${c.athleteId}-${c.label}-${i}`} className="flex items-center gap-3 bg-page/50 rounded-2xl p-2.5">
                <Avatar url={c.avatarUrl} name={c.name} />
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink-700 truncate" dir="auto">{c.name}</span>
                  <span className="block text-xs text-accent-600/90">שיא חדש · {c.label}</span>
                </div>
                <span className="text-sm font-black text-ink-700 tabular-nums shrink-0">{formatTime(c.seconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
