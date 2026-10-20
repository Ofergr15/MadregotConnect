'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { BackNav, InsetSection, Skeleton, Switch } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { ClubUpdatesConfig } from '@/lib/club-updates/model';
import { personMatches } from '@/lib/search/match';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › עדכונים מהמועדון — the admin's two switches, and nothing else for now (Ofer,
// 2026-10-18: "admin כרגע רק יכול להפעיל ולהגדיר מי יוכל לעדכן"): on/off for the club,
// and who may write. The admin always writes; while it is off only the admin sees it.
// ═════════════════════════════════════════════════════════════════════════════

interface AdminResponse {
  config: ClubUpdatesConfig;
  people: Array<{ id: string; name: string; avatarUrl: string | null; role: string }>;
  me: string | null;
  tablesReady: boolean;
}

export default function ClubUpdatesAdminPage() {
  const router = useRouter();
  const { data, mutate } = useApi<AdminResponse>('/api/admin/club-updates');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async (patch: Partial<ClubUpdatesConfig>, key: string) => {
    if (!data) return;
    setSaving(key); setErr(null);
    const optimistic = { ...data, config: { ...data.config, ...patch } };
    await mutate(optimistic, { revalidate: false });
    try {
      const res = await fetch('/api/admin/club-updates', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error();
      await mutate();
    } catch {
      setErr('לא נשמר — נסו שוב');
      await mutate();
    } finally { setSaving(null); }
  };

  const people = useMemo(() => {
    const list = (data?.people ?? []).filter((p) => p.id !== data?.me);
    const writers = new Set(data?.config.writerIds ?? []);
    const needle = q.trim().toLowerCase();
    return list
      .filter((p) => !needle || personMatches(p.name, needle))
      // Writers first, then the staff, then everyone else.
      .sort((a, b) => Number(writers.has(b.id)) - Number(writers.has(a.id)) || Number(b.role !== 'צוות') - Number(a.role !== 'צוות') || a.name.localeCompare(b.name));
  }, [data, q]);

  const writers = new Set(data?.config.writerIds ?? []);
  const toggleWriter = (id: string, on: boolean) => {
    const next = on ? [...writers, id] : [...writers].filter((x) => x !== id);
    void save({ writerIds: next }, id);
  };

  return (
    <div className="space-y-5 pb-16" dir="rtl">
      <BackNav label="תוכן" onBack={() => router.push('/dashboard/content')} />
      <div>
        <h1 className="text-[26px] font-black text-ink-900">עדכונים מהמועדון</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">עדכונים קצרים מהצוות, בזרם אחד ובכרטיס אחד בפיד. מבזק ותיוג שולחים התראה; כל השאר שקט.</p>
      </div>

      {data && !data.tablesReady && (
        <div className="rounded-2xl bg-[#FFF1D6] px-4 py-3 text-[13px] font-bold text-[#8A5A00]">צריך להריץ את מיגרציה 154 (supabase/migrations/154_club_updates.sql) לפני שאפשר לכתוב.</div>
      )}
      {err && <p className="text-[13px] font-bold text-accent-red" role="alert">{err}</p>}

      <InsetSection>
        <div className="flex min-h-[64px] items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] text-ink-900">פעיל לכל המועדון</b>
            <small className="block text-[12px] text-ink-400">{data?.config.enabled ? 'כולם רואים את העדכונים' : 'כבוי — רק אתה רואה, כדי לנסות'}</small>
          </span>
          {data ? <Switch checked={data.config.enabled} loading={saving === 'enabled'} onChange={(enabled) => void save({ enabled }, 'enabled')} ariaLabel="פעיל לכל המועדון" /> : <Skeleton className="h-7 w-12 rounded-full" />}
        </div>
        <Link href="/updates" className="flex min-h-[52px] items-center px-4 text-[14px] font-bold text-brand-600">לזרם העדכונים ›</Link>
      </InsetSection>

      <div>
        <p className="mb-2 px-1 text-[12px] font-extrabold text-ink-400">מי כותב · <bdi>{writers.size}</bdi> חוץ ממך</p>
        <label className="mb-2 flex min-h-[44px] items-center gap-2 rounded-full bg-card px-4">
          <Search className="h-4 w-4 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש" className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
        </label>
        <div className="overflow-hidden rounded-[20px] bg-card">
          {!data && Array.from({ length: 5 }, (_, i) => <div key={i} className="px-4 py-3"><Skeleton className="h-9 w-full" /></div>)}
          {people.map((p) => (
            <div key={p.id} className="flex min-h-[60px] items-center gap-3 border-b border-page px-4 last:border-0">
              <FeedAvatar name={p.name} url={p.avatarUrl} className="h-9 w-9 text-xs" />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14.5px] text-ink-900">{p.name}</b>
                <small className="block text-[11.5px] text-ink-400">{p.role === 'צוות' ? 'חבר/ה במועדון' : p.role}</small>
              </span>
              <Switch checked={writers.has(p.id)} loading={saving === p.id} onChange={(on) => toggleWriter(p.id, on)} activeColor="bg-[#16794A]" ariaLabel={`${p.name} כותב/ת`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
