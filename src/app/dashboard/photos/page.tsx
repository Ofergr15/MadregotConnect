'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Image, Upload, Search, Eye, Loader2, CheckCircle2, AlertCircle, X, Tag, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { getSupabase } from '@/lib/supabase/client';
import { SegmentedControl, Sheet, InsetSection, InsetRow, EmptyState, SkeletonList } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedFace {
  id: string;
  crop_url: string | null;
  confidence: number | null;
  source: string;
  run_photos?: {
    id: string;
    drive_url: string;
    thumbnail_url: string | null;
    run_date: string;
    taken_at: string | null;
  } | null;
  athletes?: { id: string; name: string; email: string } | null;
}

interface Athlete {
  id: string;
  name: string;
  email: string;
}

const STAFF_ROLES = ['admin', 'coach', 'academy_coach'];

export default function PhotosPage() {
  const t = useTranslations('photos');
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);

  // Tab state — deep-link via ?tab=
  const isStaff = userRole ? STAFF_ROLES.includes(userRole) : false;
  type Tab = 'import' | 'unknown' | 'browse' | 'my';
  const [tab, setTab] = useState<Tab>('my');

  useEffect(() => {
    // Get email from session (Google OAuth)
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email || localStorage.getItem('athlete_email') || '';
      if (email) setUserEmail(email);
      const id = session?.user?.id || localStorage.getItem('athlete_id') || '';
      if (id) setAthleteId(id);
    });

    const paramTab = new URLSearchParams(window.location.search).get('tab');
    const valid: Tab[] = ['import', 'unknown', 'browse', 'my'];
    if (paramTab && valid.includes(paramTab as Tab)) setTab(paramTab as Tab);
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    fetch('/api/auth/me', { headers: { 'x-user-email': userEmail } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.role) setUserRole(d.role); })
      .catch(() => {})
      .finally(() => setRoleLoaded(true));
  }, [userEmail]);

  // Get the athleteId from the DB too (localStorage id may be Supabase auth UUID, not our athletes.id)
  useEffect(() => {
    if (!userEmail) return;
    const supabase = getSupabase();
    supabase.from('athletes').select('id').ilike('email', userEmail).maybeSingle()
      .then(({ data }) => { if (data?.id) setAthleteId(data.id); });
  }, [userEmail]);

  if (!roleLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
      </div>
    );
  }

  const staffTabs = [
    { key: 'import' as Tab, label: t('import'), icon: Upload },
    { key: 'unknown' as Tab, label: t('unknownFaces'), icon: Search },
    { key: 'browse' as Tab, label: t('browse'), icon: Eye },
    { key: 'my' as Tab, label: t('myPhotos'), icon: Image },
  ];
  const athleteTabs = [
    { key: 'browse' as Tab, label: t('browse'), icon: Eye },
    { key: 'my' as Tab, label: t('myPhotos'), icon: Image },
  ];
  const tabs = isStaff ? staffTabs : athleteTabs;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Image className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
      </div>

      {/* Tab bar */}
      {tabs.length > 1 && (
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={tabs.map(({ key, label, icon }) => ({ value: key, label, icon }))}
          className="mb-6"
        />
      )}

      {/* Tab content */}
      {tab === 'import' && isStaff && <ImportTab />}
      {tab === 'unknown' && isStaff && <UnknownFacesTab />}
      {tab === 'browse' && <BrowseTab />}
      {tab === 'my' && <MyPhotosTab athleteId={athleteId} />}
    </div>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

interface RunFolder {
  id: string; name: string; date: string;
  totalPhotos: number;
  imported?: boolean; importedCount?: number; unprocessedCount?: number;
}
type FolderState = 'idle' | 'importing' | 'processing' | 'grouping' | 'done' | 'error';

interface FolderPhoto {
  id: string; thumbnail_url: string | null; drive_url: string;
  filename: string; processed_at: string | null; faces_detected: number | null;
}

function ImportTab() {
  const t = useTranslations('photos');
  const [folders, setFolders] = useState<RunFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState<Record<string, FolderState>>({});
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [folderPhotos, setFolderPhotos] = useState<Record<string, FolderPhoto[]>>({});
  const [photosLoading, setPhotosLoading] = useState<Record<string, boolean>>({});
  const [viewerPhoto, setViewerPhoto] = useState<FolderPhoto | null>(null);

  const loadFolders = () => {
    setLoading(true);
    authedFetch('/api/photos/drive-dates')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.folders) setFolders(d.folders); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFolders(); }, []);

  const loadFolderPhotos = (folderId: string) => {
    if (folderPhotos[folderId]) return;
    setPhotosLoading(p => ({ ...p, [folderId]: true }));
    authedFetch(`/api/photos?folderId=${folderId}`)
      .then(r => r.ok ? r.json() : { photos: [] })
      .then(d => setFolderPhotos(p => ({ ...p, [folderId]: d.photos || [] })))
      .finally(() => setPhotosLoading(p => ({ ...p, [folderId]: false })));
  };

  const toggleExpand = (folderId: string, isImported: boolean) => {
    if (expanded === folderId) { setExpanded(null); return; }
    setExpanded(folderId);
    if (isImported) loadFolderPhotos(folderId);
  };

  const importFolder = async (folder: RunFolder) => {
    setStates(s => ({ ...s, [folder.id]: 'importing' }));
    setErrors(e => ({ ...e, [folder.id]: '' }));
    try {
      const importRes = await authedFetch('/api/photos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folder.id, folderName: folder.name }),
      });
      const importData = await importRes.json();
      if (!importRes.ok) throw new Error(importData.error || t('importFailedFallback'));

      const { photoIds } = importData as { photoIds: string[] };

      if (photoIds.length > 0) {
        setStates(s => ({ ...s, [folder.id]: 'processing' }));
        setProgress(p => ({ ...p, [folder.id]: { done: 0, total: photoIds.length } }));

        for (let i = 0; i < photoIds.length; i++) {
          await authedFetch('/api/photos/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoId: photoIds[i] }),
          });
          setProgress(p => ({ ...p, [folder.id]: { done: i + 1, total: photoIds.length } }));
        }

        // Auto-recluster any faces that weren't grouped during processing
        setStates(s => ({ ...s, [folder.id]: 'grouping' }));
        await authedFetch('/api/photos/clusters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'recluster' }),
        });
      }

      setStates(s => ({ ...s, [folder.id]: 'done' }));
      setFolders(fs => fs.map(f => f.id === folder.id
        ? { ...f, imported: true, importedCount: f.totalPhotos, unprocessedCount: 0 }
        : f));
      // Refresh photo grid for this folder
      setFolderPhotos(p => { const n = { ...p }; delete n[folder.id]; return n; });
      if (expanded === folder.id) loadFolderPhotos(folder.id);
    } catch (err: unknown) {
      setErrors(e => ({ ...e, [folder.id]: String(err) }));
      setStates(s => ({ ...s, [folder.id]: 'error' }));
    }
  };

  const importAll = async () => {
    for (const folder of folders.filter(f => !f.imported || (f.unprocessedCount ?? 0) > 0)) {
      await importFolder(folder);
    }
  };

  const pendingCount = folders.filter(f => !f.imported || (f.unprocessedCount ?? 0) > 0).length;
  const anyRunning = Object.values(states).some(s => s === 'importing' || s === 'processing' || s === 'grouping');

  if (loading) {
    return <SkeletonList count={3} />;
  }

  if (folders.length === 0) return <EmptyState icon={Upload} title={t('noRunFolders')} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {pendingCount > 0 ? t('foldersNotImported', { count: pendingCount }) : t('allFoldersImported')}
        </p>
        {pendingCount > 0 && (
          <button onClick={importAll} disabled={anyRunning}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
            <Upload className="w-4 h-4" /> {t('importAll')}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {folders.map(folder => {
          const state = states[folder.id] ?? 'idle';
          const prog = progress[folder.id];
          const isRunning = state === 'importing' || state === 'processing' || state === 'grouping';
          const isImported = folder.imported || state === 'done';
          const hasPending = isImported && (folder.unprocessedCount ?? 0) > 0 && state !== 'done';
          const isExpanded = expanded === folder.id;
          const photos = folderPhotos[folder.id] ?? [];
          const importedCount = state === 'done' ? folder.totalPhotos : (folder.importedCount ?? 0);

          return (
            <div key={folder.id} className={cn(
              'rounded-xl border overflow-hidden transition-colors',
              isImported ? 'bg-green-500/5 border-green-500/20' : 'bg-white/5 border-white/10'
            )}>
              {/* Folder row */}
              <div className="flex items-center gap-3 p-4">
                <div className="flex-none w-5 h-5 flex items-center justify-center">
                  {isImported && !hasPending ? (
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                  ) : isRunning ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-white/20" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{folder.name}</p>
                    {/* x/y count */}
                    <span className={cn('text-xs px-1.5 py-0.5 rounded font-mono',
                      isImported && !hasPending ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-slate-400'
                    )}>
                      {isImported ? importedCount : 0}/{folder.totalPhotos}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{folder.date}</p>

                  {state === 'processing' && prog && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 transition-all duration-300"
                          style={{ width: `${(prog.done / prog.total) * 100}%` }} />
                      </div>
                      <p className="text-xs text-slate-400">{t('photosProcessedProgress', { done: prog.done, total: prog.total })}</p>
                    </div>
                  )}
                  {state === 'grouping' && (
                    <p className="text-xs text-primary-300 mt-0.5">{t('groupingFaces')}</p>
                  )}
                  {state === 'error' && errors[folder.id] && (
                    <p className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 flex-none" /> {errors[folder.id]}
                    </p>
                  )}
                </div>

                <div className="flex-none flex items-center gap-2">
                  {hasPending && !isRunning && (
                    <button onClick={() => importFolder(folder)} disabled={anyRunning}
                      className="flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium transition-colors">
                      <Upload className="w-3 h-3" /> {t('processCount', { count: folder.unprocessedCount ?? 0 })}
                    </button>
                  )}
                  {!isImported && !isRunning && (
                    <button onClick={() => importFolder(folder)} disabled={anyRunning}
                      className="flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-medium transition-colors">
                      <Upload className="w-3 h-3" /> {t('import')}
                    </button>
                  )}
                  {/* Expand toggle for imported folders */}
                  {(isImported || photos.length > 0) && (
                    <button onClick={() => toggleExpand(folder.id, isImported)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Photo grid (expanded) */}
              {isExpanded && (
                <div className="border-t border-white/10 px-4 pb-4 pt-3">
                  {photosLoading[folder.id] ? (
                    <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> {t('loadingPhotosShort')}
                    </div>
                  ) : photos.length === 0 ? (
                    <p className="text-xs text-slate-400">{t('noPhotosImportedYet')}</p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                      {photos.map(p => (
                        <button key={p.id} type="button" onClick={() => setViewerPhoto(p)}
                          className="relative group aspect-square rounded overflow-hidden bg-white/5 border border-white/10 hover:border-primary-500/40 transition-colors">
                          {p.thumbnail_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.thumbnail_url} alt={p.filename} className="w-full h-full object-cover"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Image className="w-4 h-4 text-slate-600" />
                            </div>
                          )}
                          {/* Faces badge */}
                          {p.processed_at && (
                            <span className="absolute bottom-0.5 end-0.5 bg-black/70 text-white text-[9px] px-1 rounded leading-tight">
                              {p.faces_detected ?? 0}
                            </span>
                          )}
                          {!p.processed_at && (
                            <span className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* In-app photo viewer — keeps the coach in-app instead of bouncing to an
          external Drive tab; the raw Drive link is offered as a secondary action. */}
      <Sheet open={!!viewerPhoto} onOpenChange={(o) => { if (!o) setViewerPhoto(null); }} bodyClassName="px-0 pb-0">
        {viewerPhoto && (
          <>
            <div className="bg-black flex items-center justify-center">
              {viewerPhoto.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewerPhoto.thumbnail_url} alt={viewerPhoto.filename} className="w-full max-h-[70vh] object-contain" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center">
                  <Image className="w-10 h-10 text-slate-600" />
                </div>
              )}
            </div>
            <div className="p-4">
              <a href={viewerPhoto.drive_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-primary-400 hover:text-primary-300">
                {t('openInDrive')}
              </a>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

// ─── Unknown Faces Tab ────────────────────────────────────────────────────────

interface FaceCluster {
  clusterId: string;
  faces: Array<{ id: string; crop_url: string | null; run_date: string | null }>;
  personName: string | null;
  runDates: string[];
}

function UnknownFacesTab() {
  const t = useTranslations('photos');
  const tc = useTranslations('common');
  const [clusters, setClusters] = useState<FaceCluster[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // merge mode: first selected cluster, waiting for second
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [labeling, setLabeling] = useState<string | null>(null);
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({});
  const [athleteSearch, setAthleteSearch] = useState<Record<string, string>>({});
  // Sheet-based "Tag as athlete" picker — replaces the raw <select>.
  const [taggingClusterId, setTaggingClusterId] = useState<string | null>(null);

  const loadClusters = () => {
    setLoading(true);
    Promise.all([
      authedFetch('/api/photos').then(r => r.ok ? r.json() : { clusters: [] }),
      fetch('/api/athletes').then(r => r.ok ? r.json() : { athletes: [] }),
    ]).then(([pd, ad]) => {
      setClusters(pd.clusters || []);
      setAthletes(ad.athletes || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadClusters(); }, []);

  const label = async (clusterId: string, athleteId?: string, personName?: string) => {
    setLabeling(clusterId);
    try {
      const res = await authedFetch('/api/photos/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId, athleteId, personName }),
      });
      if (res.ok) {
        setClusters(prev => prev.filter(c => c.clusterId !== clusterId));
        setExpanded(null);
      }
    } finally {
      setLabeling(null);
    }
  };

  const merge = async (targetClusterId: string) => {
    if (!mergeSource || mergeSource === targetClusterId) { setMergeSource(null); return; }
    await authedFetch('/api/photos/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', sourceClusterId: mergeSource, targetClusterId }),
    });
    setMergeSource(null);
    loadClusters();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>;

  if (clusters.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t('unknownFacesEmpty')} className="py-16" />;
  }

  const expandedCluster = clusters.find(c => c.clusterId === expanded);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-slate-400 text-sm">
          {t('unknownPersonCount', { count: clusters.length })}
          {mergeSource && <span className="ms-2 text-primary-400">{t('pickSecondPerson')}</span>}
        </p>
        {mergeSource && (
          <button onClick={() => setMergeSource(null)} className="min-h-[44px] text-xs text-slate-400 hover:text-white px-3 rounded border border-white/10">
            {t('cancelMerge')}
          </button>
        )}
      </div>

      {/* Expanded cluster detail */}
      {expandedCluster && (
        <div className="bg-white/5 border border-primary-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">
              {t('photoCountDates', { count: expandedCluster.faces.length, dates: expandedCluster.runDates.join(', ') })}
            </p>
            <button onClick={() => setExpanded(null)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {expandedCluster.faces.map(f => (
              <div key={f.id} className="relative">
                {f.crop_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.crop_url} alt="face" className="w-20 h-20 rounded-lg object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-white/10 flex items-center justify-center">
                    <Search className="w-5 h-5 text-slate-600" />
                  </div>
                )}
                {f.run_date && (
                  <span className="absolute bottom-1 start-1 bg-black/70 text-white text-[10px] px-1 rounded">
                    {f.run_date.slice(5)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cluster grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {clusters.map(cluster => {
          const primary = cluster.faces[0];
          const extra = cluster.faces.length - 1;
          const isMergeSource = mergeSource === cluster.clusterId;

          return (
            <div
              key={cluster.clusterId}
              className={cn(
                'bg-white/5 rounded-xl border overflow-hidden transition-colors',
                isMergeSource ? 'border-primary-500' : mergeSource ? 'border-white/10 hover:border-primary-400 cursor-pointer' : 'border-white/10'
              )}
              onClick={mergeSource && !isMergeSource ? () => merge(cluster.clusterId) : undefined}
            >
              {/* Face preview strip */}
              <div className="aspect-square relative cursor-pointer" onClick={mergeSource ? undefined : () => setExpanded(expanded === cluster.clusterId ? null : cluster.clusterId)}>
                {primary?.crop_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={primary.crop_url} alt="face" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <Search className="w-8 h-8 text-slate-600" />
                  </div>
                )}
                {extra > 0 && (
                  <span className="absolute top-1.5 end-1.5 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                    +{extra}
                  </span>
                )}
                <span className="absolute bottom-1 start-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {cluster.runDates.slice(-1)[0]?.slice(5) ?? ''}
                </span>
              </div>

              {/* Tag controls */}
              <div className="p-2 space-y-1.5">
                {cluster.personName ? (
                  <p className="text-xs text-primary-300 font-medium truncate">{cluster.personName}</p>
                ) : null}

                {/* Name input (for non-registered person) */}
                <input
                  type="text"
                  placeholder={t('namePlaceholder')}
                  value={nameInputs[cluster.clusterId] || ''}
                  onChange={e => setNameInputs(n => ({ ...n, [cluster.clusterId]: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && nameInputs[cluster.clusterId]?.trim()) {
                      label(cluster.clusterId, undefined, nameInputs[cluster.clusterId].trim());
                    }
                  }}
                  className="w-full bg-white/10 border border-white/20 rounded text-xs px-2 py-1 text-white placeholder-slate-500"
                  onClick={e => e.stopPropagation()}
                />

                {/* Athlete search + select */}
                <input
                  type="text"
                  placeholder={t('searchAthletePlaceholder')}
                  value={athleteSearch[cluster.clusterId] || ''}
                  onChange={e => setAthleteSearch(s => ({ ...s, [cluster.clusterId]: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded text-xs px-2 py-1 text-white placeholder-slate-500"
                  onClick={e => e.stopPropagation()}
                />
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setTaggingClusterId(cluster.clusterId); }}
                  disabled={labeling === cluster.clusterId}
                  className="w-full flex items-center justify-between gap-1 min-h-[36px] bg-white/10 border border-white/20 rounded text-xs px-2 py-1 text-white disabled:opacity-50"
                >
                  <span className="truncate text-slate-300">{t('labelAs')}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>

                {/* Merge button */}
                <button
                  onClick={e => { e.stopPropagation(); setMergeSource(isMergeSource ? null : cluster.clusterId); }}
                  className={cn(
                    'w-full min-h-[44px] flex items-center justify-center text-xs rounded transition-colors',
                    isMergeSource
                      ? 'bg-primary-600 text-white'
                      : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white'
                  )}
                >
                  {isMergeSource ? t('mergingPickTarget') : t('samePerson')}
                </button>

                {labeling === cluster.clusterId && (
                  <div className="flex justify-center"><Loader2 className="w-3 h-3 animate-spin text-primary-400" /></div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tag-as-athlete picker — replaces the raw <select> */}
      <Sheet
        open={!!taggingClusterId}
        onOpenChange={(o) => { if (!o) setTaggingClusterId(null); }}
        title={t('labelAs')}
      >
        {taggingClusterId && (() => {
          const q = (athleteSearch[taggingClusterId] || '').toLowerCase();
          const options = athletes.filter(a => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
          return (
            <InsetSection>
              {options.slice(0, 50).map(a => (
                <InsetRow
                  key={a.id}
                  label={a.name}
                  sublabel={a.email}
                  onClick={() => { const id = taggingClusterId; setTaggingClusterId(null); label(id, a.id); }}
                />
              ))}
              {options.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-slate-500">{tc('noResults')}</div>
              )}
            </InsetSection>
          );
        })()}
      </Sheet>
    </div>
  );
}

// ─── Browse Tab ───────────────────────────────────────────────────────────────

function BrowseTab() {
  const t = useTranslations('photos');
  const tc = useTranslations('common');
  const [runDate, setRunDate] = useState('');
  const [photos, setPhotos] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [importedDates, setImportedDates] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    authedFetch('/api/photos?importedDates=1')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.dates) setImportedDates(d.dates); })
      .catch(() => {});
  }, []);

  const load = async (d: string) => {
    if (!d) return;
    setRunDate(d);
    setLoading(true);
    try {
      const res = await authedFetch(`/api/photos?date=${d}`);
      const data = await res.json();
      setPhotos(data.photos || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-slate-300 mb-2">{t('selectDate')}</label>
        <button
          type="button"
          onClick={() => setShowDatePicker(true)}
          className="w-full min-h-[44px] flex items-center justify-between gap-2 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm min-w-[200px]"
        >
          <span className={runDate ? '' : 'text-slate-400'}>{runDate || t('chooseRunDate')}</span>
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </div>

      <Sheet open={showDatePicker} onOpenChange={setShowDatePicker} title={t('selectDate')}>
        <InsetSection>
          {importedDates.map(d => (
            <InsetRow
              key={d}
              label={d}
              onClick={() => { setShowDatePicker(false); load(d); }}
              trailing={runDate === d ? <Check className="h-4 w-4 text-primary-400" /> : undefined}
            />
          ))}
          {importedDates.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">{tc('noResults')}</div>
          )}
        </InsetSection>
      </Sheet>

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>}

      {!loading && runDate && photos.length === 0 && (
        <p className="text-slate-400">{t('noPhotosForDate')}</p>
      )}

      {!loading && photos.length > 0 && (
        <PhotoGrid photos={photos as PhotoItem[]} showTags />
      )}
    </div>
  );
}

// ─── My Photos Tab ────────────────────────────────────────────────────────────

function MyPhotosTab({ athleteId }: { athleteId: string | null }) {
  const t = useTranslations('photos');
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [viewerFace, setViewerFace] = useState<DetectedFace | null>(null);

  const loadMyPhotos = async (id: string) => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/photos?athleteId=${id}`);
      const data = await res.json();
      setFaces(data.faces || []);
    } finally {
      setLoading(false);
    }
  };

  const loadSelfie = async (id: string) => {
    // Try to get the signed URL for the reference face photo
    try {
      const res = await authedFetch(`/api/photos/selfie-url?athleteId=${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelfieUrl(data.url || null);
      }
    } catch { /* no selfie */ }
  };

  useEffect(() => {
    if (athleteId) {
      loadMyPhotos(athleteId);
      loadSelfie(athleteId);
    }
  }, [athleteId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await authedFetch('/api/photos/enroll-selfie', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || t('uploadFailed'));
      } else {
        setUploadMsg(t('selfieEnrolledMsg', { count: data.photosFound ?? 0 }));
        if (athleteId) {
          loadMyPhotos(athleteId);
          loadSelfie(athleteId);
        }
      }
    } catch (err: unknown) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selfie section */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h2 className="text-base font-semibold text-white mb-1">{t('selfieTitle')}</h2>
        <p className="text-sm text-slate-400 mb-4">
          {t('selfieHint')}
        </p>
        <div className="flex items-start gap-4">
          {selfieUrl ? (
            <img
              src={selfieUrl}
              alt={t('selfieTitle')}
              className="w-20 h-20 rounded-full object-cover border-2 border-primary-500/50"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center border-2 border-dashed border-white/20">
              <Image className="w-8 h-8 text-slate-500" />
            </div>
          )}
          <div className="flex-1 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? t('selfieUploading') : selfieUrl ? t('selfieReplace') : t('selfieUpload')}
            </button>
            {uploadMsg && (
              <p className="text-green-400 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {uploadMsg}
              </p>
            )}
            {uploadError && (
              <p className="text-red-400 text-sm flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> {uploadError}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* My photos grid */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">
          {t('myPhotosTitle')} {faces.length > 0 && <span className="text-slate-400 font-normal text-sm">({faces.length})</span>}
        </h2>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>
        ) : faces.length === 0 ? (
          <EmptyState icon={Image} title={t('myPhotosEmpty')} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {faces.map(face => (
              <button
                key={face.id}
                type="button"
                onClick={() => setViewerFace(face)}
                className="group relative text-start bg-white/5 rounded-xl overflow-hidden border border-white/10 hover:border-primary-500/40 transition-colors"
              >
                {face.crop_url ? (
                  <img
                    src={face.crop_url}
                    alt={t('youInRunPhotoAlt')}
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-white/5 flex items-center justify-center">
                    <Image className="w-8 h-8 text-slate-600" />
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1">
                  <p className="text-xs text-white/80">{face.run_photos?.run_date}</p>
                  {face.confidence && (
                    <p className="text-xs text-primary-300">{t('matchPercent', { percent: Math.round(face.confidence) })}</p>
                  )}
                </div>
                {face.source === 'manual' && (
                  <span className="absolute top-1.5 start-1.5 bg-primary-600/80 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Tag className="w-2.5 h-2.5" /> {t('tagged')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* In-app photo viewer — keeps the athlete in-app instead of bouncing to
          an external Drive tab; the raw Drive link is offered as a secondary action. */}
      <Sheet open={!!viewerFace} onOpenChange={(o) => { if (!o) setViewerFace(null); }} bodyClassName="px-0 pb-0">
        {viewerFace && (
          <>
            <div className="bg-black flex items-center justify-center">
              {viewerFace.crop_url ? (
                <img src={viewerFace.crop_url} alt={t('youInRunPhotoAlt')} className="w-full max-h-[70vh] object-contain" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center">
                  <Image className="w-10 h-10 text-slate-600" />
                </div>
              )}
            </div>
            <div className="p-4 space-y-1">
              <p className="text-sm text-slate-300">{viewerFace.run_photos?.run_date}</p>
              {viewerFace.run_photos?.drive_url && (
                <a href={viewerFace.run_photos.drive_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-primary-400 hover:text-primary-300">
                  {t('openInDrive')}
                </a>
              )}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

// ─── PhotoGrid ────────────────────────────────────────────────────────────────

interface PhotoItem {
  id: string;
  drive_url: string;
  thumbnail_url: string | null;
  run_date: string;
  faces_detected: number | null;
  processed_at: string | null;
  detected_faces?: Array<{
    id: string;
    athlete_id: string | null;
    crop_url: string | null;
    athletes?: { name: string } | null;
  }>;
}

function PhotoGrid({ photos, showTags }: { photos: PhotoItem[]; showTags?: boolean }) {
  const t = useTranslations('photos');
  const [viewerPhoto, setViewerPhoto] = useState<PhotoItem | null>(null);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {photos.map(photo => {
        const tags = (photo.detected_faces || []).filter(f => f.athlete_id);
        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => setViewerPhoto(photo)}
            className="group relative block text-start bg-white/5 rounded-xl overflow-hidden border border-white/10 hover:border-primary-500/40 transition-colors"
          >
            <div className="aspect-square">
              {photo.thumbnail_url ? (
                <img src={photo.thumbnail_url} alt={t('runPhotoAlt')} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Image className="w-8 h-8 text-slate-600" />
                </div>
              )}
            </div>
            {/* Status overlay */}
            <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1.5">
              <p className="text-xs text-white/70">{photo.run_date}</p>
              {photo.processed_at ? (
                <p className="text-xs text-primary-300">
                  {t('facesCount', { count: photo.faces_detected ?? 0 })}
                </p>
              ) : (
                <p className="text-xs text-slate-500">{t('notProcessed')}</p>
              )}
            </div>
            {/* Tag chips */}
            {showTags && tags.length > 0 && (
              <div className="absolute top-1.5 start-1.5 flex flex-wrap gap-1">
                {tags.slice(0, 3).map(f => (
                  <span key={f.id} className="bg-primary-600/80 text-white text-xs px-1.5 py-0.5 rounded">
                    {f.athletes?.name?.split(' ')[0] ?? '?'}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    +{tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}

      {/* In-app photo viewer — replaces the external-link anchor to Drive */}
      <Sheet open={!!viewerPhoto} onOpenChange={(o) => { if (!o) setViewerPhoto(null); }} bodyClassName="px-0 pb-0">
        {viewerPhoto && (
          <>
            <div className="bg-black flex items-center justify-center">
              {viewerPhoto.thumbnail_url ? (
                <img src={viewerPhoto.thumbnail_url} alt={t('runPhotoAlt')} className="w-full max-h-[70vh] object-contain" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center">
                  <Image className="w-10 h-10 text-slate-600" />
                </div>
              )}
            </div>
            <div className="p-4 space-y-1">
              <p className="text-sm text-slate-300">{viewerPhoto.run_date}</p>
              <a href={viewerPhoto.drive_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-primary-400 hover:text-primary-300">
                {t('openInDrive')}
              </a>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
