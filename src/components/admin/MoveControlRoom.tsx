'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';
import { Button, Card, ConfirmSheet, Spinner } from '@/components/ui';
import type { MoveStatus } from '@/lib/move/state';
import type { CheckResult } from '@/lib/move/checks';

// ═════════════════════════════════════════════════════════════════════════════
// The Tokyo → Frankfurt move, as one screen (lib/move/state.ts has the why).
//
// Five steps: check → start → copy → verify → open. "Start" and "Open" switch
// maintenance through PUT /api/maintenance (which keeps the caller on the
// allow-list) and record it in move_status; the copy in between runs from the
// operator's machine and reports into the same log, polled here every 5 s.
// "Open" stays disabled until the check suite has no failure.
// ═════════════════════════════════════════════════════════════════════════════

interface MoveState {
  host: string; ref: string; onNew: boolean; functionRegion: string; version: string; storageKeyPinned: string | null;
  status: MoveStatus;
  snapshot: { at: string; source: string; tables: number; rows: number } | null;
  maintenance: { on: boolean; allow: string[] };
}
interface ClientCheck { id: string; group: 'client'; status: CheckResult['status']; title: string; detail: string; ms: number }
type AnyCheck = CheckResult | ClientCheck;

const STEPS = ['check', 'start', 'copy', 'verify', 'open'] as const;
const GROUPS = ['env', 'data', 'files', 'links', 'auth', 'services', 'client'] as const;

function stepOf(s: MoveState | undefined): number {
  if (!s) return 0;
  switch (s.status.phase) {
    case 'idle': return 0;
    case 'start_requested': case 'frozen': case 'copying': return s.onNew ? 3 : 2;
    case 'switched': return 3;
    case 'open': return 4;
    case 'rollback_requested': return 2;
  }
}

/** Checks only a browser can answer: what this phone holds, and how the app's own routes feel from here. */
async function clientChecks(onNew: boolean): Promise<ClientCheck[]> {
  const out: ClientCheck[] = [];
  let carried = false;
  try { carried = sessionStorage.getItem('mc_session_carried') === '1'; } catch { /* private mode */ }
  out.push({ id: 'carried', group: 'client', status: 'pass', ms: 0, title: carried ? 'This phone carried its Tokyo session over' : 'Session on this phone is current', detail: carried ? 'refreshed against the new database, no sign-in' : onNew ? 'already issued here' : '—' });
  const headers = await bearerHeaders(false);
  for (const path of ['/api/auth/me', '/api/feed?limit=20', '/api/groups', '/api/dashboard/weekly', '/api/notifications/unread']) {
    const t = performance.now();
    const r = await fetch(path, { headers, cache: 'no-store' }).catch(() => null);
    const ms = Math.round(performance.now() - t);
    out.push({ id: `route:${path}`, group: 'client', ms, status: !r || r.status >= 500 ? 'fail' : r.status >= 400 ? 'warn' : ms > 1500 ? 'warn' : 'pass', title: `${path.split('?')[0]} → ${r ? r.status : 'no answer'}`, detail: `${ms} ms from this phone${r?.headers.get('x-vercel-id') ? ` · ${r.headers.get('x-vercel-id')!.split('::').slice(0, 2).join('→')}` : ''}` });
  }
  return out;
}

export function MoveControlRoom() {
  const t = useTranslations('move');
  const { data: s, mutate } = useApi<MoveState>('/api/admin/move', { refreshInterval: 5000 });
  const [results, setResults] = useState<AnyCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'start' | 'open' | 'rollback'>(null);
  const [note, setNote] = useState<string | null>(null);

  const post = useCallback(async (action: string) => {
    const r = await fetch('/api/admin/move', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await mutate();
    return d;
  }, [mutate]);

  const setMaintenance = useCallback(async (on: boolean) => {
    const r = await fetch('/api/maintenance', { method: 'PUT', headers: await bearerHeaders(), body: JSON.stringify({ on }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const r = await fetch('/api/admin/move/checks', { method: 'POST', headers: await bearerHeaders() });
      const d = await r.json();
      const server: CheckResult[] = r.ok ? d.results : [{ id: 'suite', group: 'env', status: 'fail', title: 'Check suite did not run', detail: d.error || `HTTP ${r.status}`, ms: 0 }];
      setResults([...server, ...(await clientChecks(!!s?.onNew))]);
      setRanAt(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } finally { setRunning(false); }
  }, [s?.onNew]);

  // Run once on arrival, and again by itself the moment the app lands on the new database.
  const onNew = !!s?.onNew;
  useEffect(() => { if (s) void run(); }, [onNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: 'start' | 'open' | 'rollback' | 'baseline' | 'test-push') => {
    setBusy(what); setNote(null);
    try {
      if (what === 'start') { await setMaintenance(true); await post('start'); }
      else if (what === 'open') { await setMaintenance(false); await post('opened'); }
      else if (what === 'test-push') { const d = await post('test-push'); setNote(t('pushSent', { sent: d.sent, devices: d.devices })); }
      else await post(what);
      if (what === 'baseline') await run();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(null); }
  };

  const tally = useMemo(() => {
    const c = { pass: 0, warn: 0, fail: 0 };
    for (const r of results || []) c[r.status]++;
    return c;
  }, [results]);

  if (!s) return <div className="flex justify-center mt-20"><Spinner size={28} /></div>;
  const step = stepOf(s);
  const canOpen = s.onNew && !!results && tally.fail === 0 && !running && s.maintenance.on;

  return (
    <div className="max-w-xl mx-auto space-y-3 pb-10">
      <h1 className="text-2xl font-bold px-1">{t('title')}</h1>

      <div className="flex gap-1.5" aria-label={t('stepsAria')}>
        {STEPS.map((k, i) => (
          <div key={k} className={cn('flex-1 text-center text-[11px] py-1.5 rounded-xl', i < step ? 'bg-accent-600/15 text-accent-700' : i === step ? 'bg-ink-900 text-white font-semibold' : 'bg-card text-ink-500')}>{t(`step.${k}`)}</div>
        ))}
      </div>

      <Card className="divide-y divide-ink-900/10">
        <Row k={t('database')} v={<>{s.onNew ? t('frankfurt') : t('tokyo')} <Pill tone={s.onNew ? 'ok' : 'warn'}>{s.onNew ? t('new') : t('old')}</Pill></>} sub={s.host} />
        <Row k={t('functions')} v={<bdi dir="ltr">{s.functionRegion}</bdi>} />
        <Row k={t('version')} v={<bdi dir="ltr">{s.version}</bdi>} />
        <Row k={t('maintenance')} v={<Pill tone={s.maintenance.on ? 'bad' : 'ok'}>{s.maintenance.on ? t('maintOn', { n: s.maintenance.allow.length }) : t('maintOff')}</Pill>} />
        <Row k={t('snapshot')} v={s.snapshot ? <bdi dir="ltr">{s.snapshot.rows.toLocaleString('en-US')} rows · {s.snapshot.at.slice(11, 16)}Z</bdi> : '—'} sub={s.snapshot?.source} />
      </Card>

      <Card>
        <div className="flex gap-2 mb-2">
          <Tally tone="ok" n={tally.pass} label={t('pass')} />
          <Tally tone="warn" n={tally.warn} label={t('warn')} />
          <Tally tone="bad" n={tally.fail} label={t('fail')} />
        </div>
        <div className="text-xs text-ink-500 mb-2">{running ? t('running') : ranAt ? t('ranAt', { time: ranAt }) : ''}</div>
        {GROUPS.map((g) => {
          const rows = (results || []).filter((r) => r.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="text-[12px] font-bold text-ink-500 mt-3 mb-0.5">{t(`group.${g}`)}</div>
              {rows.map((r) => (
                <div key={r.id} className="flex gap-2.5 items-start py-2 border-t border-ink-900/10 first:border-t-0">
                  <span className={cn('w-5 h-5 rounded-full grid place-items-center text-white text-xs flex-none mt-0.5', r.status === 'pass' ? 'bg-accent-600' : r.status === 'warn' ? 'bg-amber-600' : 'bg-accent-red')}>{r.status === 'pass' ? '✓' : r.status === 'warn' ? '!' : '✕'}</span>
                  <div className="min-w-0 flex-1" dir="ltr" style={{ textAlign: 'start' }}>
                    <div className="text-sm font-semibold">{r.title}</div>
                    <div className="text-xs text-ink-500 break-words">{r.detail}</div>
                  </div>
                  <span className="text-xs text-ink-400 flex-none" dir="ltr">{r.ms ? `${r.ms}ms` : ''}</span>
                </div>
              ))}
            </div>
          );
        })}
        <div className="flex gap-2 mt-3">
          <Button variant="secondary" className="flex-1" onClick={run} disabled={running}>{t('runAgain')}</Button>
          <Button variant="secondary" className="flex-1" onClick={() => act('test-push')} disabled={!!busy}>{t('testPush')}</Button>
        </div>
        {!s.onNew && s.status.phase === 'idle' && (
          <Button variant="ghost" className="w-full mt-2" onClick={() => act('baseline')} disabled={!!busy}>{t('saveBaseline')}</Button>
        )}
        {note && <div className="text-xs mt-2 text-ink-600">{note}</div>}
      </Card>

      {s.status.log.length > 0 && (
        <Card>
          <div className="font-semibold mb-1">{t('progress')}</div>
          {[...s.status.log].reverse().map((e, i) => (
            <div key={i} className="flex gap-2 text-[13px] py-1">
              <span className="text-ink-400 w-11 flex-none" dir="ltr">{new Date(e.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
              <span>{e.ok === false ? '⚠️' : '✅'}</span>
              <span className="min-w-0 break-words" dir="ltr" style={{ textAlign: 'start' }}>{e.text}</span>
            </div>
          ))}
        </Card>
      )}

      {s.status.phase === 'idle' && !s.onNew && (
        <Card>
          <div className="font-semibold">{t('readyTitle')}</div>
          <div className="text-sm text-ink-500 mt-1">{t('readyBody')}</div>
          <Button className="w-full mt-3" size="lg" onClick={() => setConfirm('start')} disabled={!!busy}>{t('start')}</Button>
        </Card>
      )}

      {s.onNew && s.status.phase !== 'open' && (
        <Card>
          <div className="font-semibold">{canOpen ? t('allGreen') : t('notYet')}</div>
          <div className="text-sm text-ink-500 mt-1">{canOpen ? t('openBody') : t('openBlocked', { n: tally.fail })}</div>
          <Button className="w-full mt-3" size="lg" onClick={() => setConfirm('open')} disabled={!canOpen || !!busy}>{t('open')}</Button>
        </Card>
      )}

      {s.status.phase !== 'idle' && s.status.phase !== 'open' && (
        <Button variant="danger" className="w-full" onClick={() => setConfirm('rollback')} disabled={!!busy}>{t('rollback')}</Button>
      )}

      <ConfirmSheet
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? t(`confirm.${confirm}.title`) : ''}
        description={confirm ? t(`confirm.${confirm}.body`) : ''}
        confirmLabel={confirm ? t(`confirm.${confirm}.cta`) : ''}
        cancelLabel={t('cancel')}
        danger={confirm !== 'open'}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void act(c); }}
      />
    </div>
  );
}

function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="flex justify-between items-center py-2 gap-3">
      <span className="text-[13px] text-ink-500">{k}</span>
      <span className="text-end text-sm">{v}{sub && <span className="block text-[11px] text-ink-400" dir="ltr">{sub}</span>}</span>
    </div>
  );
}
function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-pill', tone === 'ok' ? 'bg-accent-600/15 text-accent-700' : tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-accent-red/15 text-accent-red-ink')}>{children}</span>;
}
function Tally({ tone, n, label }: { tone: 'ok' | 'warn' | 'bad'; n: number; label: string }) {
  return <span className={cn('flex-1 text-center rounded-xl py-2 font-bold', tone === 'ok' ? 'bg-accent-600/15 text-accent-700' : tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-accent-red/15 text-accent-red-ink')}>{n} {label}</span>;
}
