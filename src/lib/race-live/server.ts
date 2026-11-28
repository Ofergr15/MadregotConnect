import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { isMissingTable, isMissingColumn } from '@/lib/supabase/schema-drift';
import { enablementRows } from '@/lib/features/server';
import { resolveFeature } from '@/lib/features/flags';
import { sendPushLocalized, subscriptionsForAthletes, persistNotifications } from '@/lib/push';
import {
  cleanSplits, isPointKey, mapFeedToEntries, milestoneCopy, milestonesToSend, normalizeFeedBody,
  predictFinishSec, recipientsFor, shouldPoll, formatClock,
  type Entry, type FeedRunner, type Milestone, type Split,
} from './core';
import { replayFeedAt, replayRaceSec } from './replay';
import {
  LIVETRACK_POLL_SEC, LiveTrackError, parseLiveTrackUrl, progressToSplits, readLiveTrack, sessionLooksEnded, trackProgress,
} from './livetrack';
import { phoneEtaSec, positionSharingOn } from './phone';

export type SplitSource = 'manual' | 'feed' | 'livetrack' | 'replay';
/** Who wins the same point: staff's official chip time, then the organizer's feed, then the watch. */
export const SOURCE_RANK: Record<SplitSource, number> = { manual: 0, feed: 1, livetrack: 2, replay: 3 };
/** Links and positions are kept this long after the poll window closes. */
export const PURGE_AFTER_MS = 24 * 3600e3;

type Db = SupabaseClient<any, any, any>;

export interface RaceConfig {
  event_id: string;
  source: 'manual' | 'feed' | 'replay';
  feed_url: string | null;
  active: boolean;
  push_enabled: boolean;
  poll_from: string | null;
  poll_to: string | null;
  poll_every_sec: number;
  last_polled_at: string | null;
  fail_count: number;
  replay_started_at: string | null;
  replay_speed: number;
}

/** One GET per club runner, sequential, 8s timeout each — ~10 runners, never a crawl of the field. */
export async function fetchFeed(urlTemplate: string, bibs: string[], fetcher: typeof fetch = fetch): Promise<FeedRunner[]> {
  const out: FeedRunner[] = [];
  let failures = 0;
  for (const bib of bibs) {
    try {
      const res = await fetcher(urlTemplate.replace('{bib}', encodeURIComponent(bib)), {
        headers: { accept: 'application/json', 'user-agent': 'club-race-tracker/1.0' },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status === 403) throw new Error(`feed refused (${res.status})`);
      if (!res.ok) { failures++; continue; }
      const rows = normalizeFeedBody(await res.json());
      const own = rows.find((r) => r.bib === bib) ?? (rows.length === 1 ? { ...rows[0], bib } : null);
      if (own) out.push(own);
    } catch (e) {
      // A refusal stops the round at once: backing off is the point.
      if (String(e).includes('refused')) throw e;
      failures++;
    }
  }
  if (bibs.length && failures === bibs.length) throw new Error('feed unreachable for every bib');
  return out;
}

/**
 * race_entries rows with the sharing stop (225). Pre-migration the column is missing: read without it,
 * so the board and the poller keep working (the stop then only lasts until the next poll, as before).
 */
export async function entriesWithSharing(db: Db, eventId: string, columns: string, athleteId?: string): Promise<any[]> {
  const run = (cols: string) => {
    let q = db.from('race_entries').select(cols).eq('event_id', eventId);
    if (athleteId) q = q.eq('athlete_id', athleteId);
    return q;
  };
  const first = await run(`${columns}, sharing_stopped_at`);
  if (!first.error) return (first.data || []) as any[];
  if (!isMissingColumn(first.error, 'sharing_stopped_at')) return [];
  return ((await run(columns)).data || []) as any[];
}

/** The one race_positions write (phone + LiveTrack). Stamps `source`; retries without it pre-225. */
export async function writePosition(db: Db, row: Record<string, unknown> & { source: 'phone' | 'livetrack' }): Promise<{ error: unknown }> {
  const first = await db.from('race_positions').upsert(row, { onConflict: 'event_id,athlete_id' });
  if (!first.error || !isMissingColumn(first.error, 'source')) return { error: first.error };
  const { source: _drop, ...rest } = row;
  const retry = await db.from('race_positions').upsert(rest, { onConflict: 'event_id,athlete_id' });
  return { error: retry.error };
}

async function loadEntries(db: Db, eventId: string): Promise<Entry[]> {
  const { data } = await db.from('race_entries').select('athlete_id, bib, live_opt_out').eq('event_id', eventId);
  return (data || []).map((r: any) => ({ athleteId: String(r.athlete_id), bib: r.bib, optOut: !!r.live_opt_out }));
}

async function loadSplits(db: Db, eventId: string): Promise<Map<string, Split[]>> {
  const { data } = await db.from('race_splits').select('athlete_id, point, elapsed_sec').eq('event_id', eventId);
  const m = new Map<string, Split[]>();
  for (const r of data || []) {
    if (!isPointKey(r.point)) continue;
    const list = m.get(String(r.athlete_id)) ?? [];
    list.push({ point: r.point, elapsedSec: r.elapsed_sec });
    m.set(String(r.athlete_id), list);
  }
  return m;
}

/** Ids of every member the race_live feature resolves ON for. */
export async function enabledMemberIds(db: Db): Promise<string[]> {
  const rows = await enablementRows('race_live', db);
  if (!rows || !rows.length) return [];
  const { data } = await db.from('athletes').select('id, group_id, role, is_academy');
  return (data || [])
    .filter((a: any) => resolveFeature('race_live', rows, { id: String(a.id), groupId: a.group_id ? String(a.group_id) : null, role: a.role, isAcademy: !!a.is_academy }).enabled)
    .map((a: any) => String(a.id));
}

/** Store splits (upsert per point), returning athletes whose split set changed. */
export async function storeSplits(db: Db, eventId: string, incoming: Map<string, Split[]>, source: SplitSource): Promise<string[]> {
  const { data: knownRows } = await db.from('race_splits').select('athlete_id, point, elapsed_sec, source').eq('event_id', eventId);
  const changed: string[] = [];
  const rows: any[] = [];
  for (const [athleteId, splits] of incoming) {
    const had = new Map((knownRows || []).filter((r: any) => String(r.athlete_id) === athleteId).map((r: any) => [r.point, r]));
    const fresh = cleanSplits(splits).filter((s) => {
      const h: any = had.get(s.point);
      if (!h) return true;
      // A lower-ranked source never overwrites a better one (the watch can't undo a chip time).
      if (SOURCE_RANK[h.source as SplitSource] < SOURCE_RANK[source]) return false;
      return h.elapsed_sec !== s.elapsedSec || h.source !== source;
    });
    if (!fresh.length) continue;
    changed.push(athleteId);
    for (const s of fresh) rows.push({ event_id: eventId, athlete_id: athleteId, point: s.point, elapsed_sec: s.elapsedSec, source, recorded_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error } = await db.from('race_splits').upsert(rows, { onConflict: 'event_id,athlete_id,point' });
    if (error) throw new Error(`race_splits: ${error.message}`);
  }
  return changed;
}

/**
 * Claim → send. The INSERT is the claim (PK event+athlete+milestone), so an overlapping poll that
 * loses the race to insert sends nothing. Skipped-past milestones are claimed with sent=false.
 */
export async function announceMilestones(db: Db, cfg: RaceConfig, athleteIds: string[], deps: { send?: typeof sendMilestonePush } = {}): Promise<number> {
  if (!athleteIds.length) return 0;
  const [entries, splits, claimedRes, enabledIds] = await Promise.all([
    loadEntries(db, cfg.event_id),
    loadSplits(db, cfg.event_id),
    db.from('race_milestones').select('athlete_id, milestone').eq('event_id', cfg.event_id),
    enabledMemberIds(db),
  ]);
  const claimed = new Map<string, Milestone[]>();
  for (const r of claimedRes.data || []) claimed.set(String(r.athlete_id), [...(claimed.get(String(r.athlete_id)) ?? []), r.milestone]);
  const send = deps.send ?? sendMilestonePush;
  let sent = 0;
  for (const athleteId of athleteIds) {
    const entry = entries.find((e) => e.athleteId === athleteId);
    if (!entry || entry.optOut) continue;
    const s = splits.get(athleteId) ?? [];
    const plan = milestonesToSend(s, claimed.get(athleteId) ?? []);
    if (!plan.send) continue;
    if (plan.silent.length) {
      await db.from('race_milestones').upsert(plan.silent.map((m) => ({ event_id: cfg.event_id, athlete_id: athleteId, milestone: m, sent: false })), { onConflict: 'event_id,athlete_id,milestone', ignoreDuplicates: true });
    }
    const { data: won } = await db.from('race_milestones')
      .upsert({ event_id: cfg.event_id, athlete_id: athleteId, milestone: plan.send, sent: cfg.push_enabled }, { onConflict: 'event_id,athlete_id,milestone', ignoreDuplicates: true })
      .select('athlete_id');
    if (!won || !won.length) continue; // another poll claimed it
    if (plan.send === 'finish') await postFinisherCard(db, cfg.event_id, athleteId, s);
    if (!cfg.push_enabled) continue;
    const { data: followers } = await db.from('athlete_follows').select('follower_id').eq('followee_id', athleteId);
    const to = recipientsFor({ milestone: plan.send, runnerId: athleteId, runnerOptOut: entry.optOut, followerIds: (followers || []).map((f: any) => String(f.follower_id)), enabledMemberIds: enabledIds });
    const at = cleanSplits(s).find((x) => x.point === (plan.send === 'half' ? 'half' : plan.send))?.elapsedSec ?? 0;
    sent += await send(db, { eventId: cfg.event_id, athleteId, milestone: plan.send, elapsedSec: at, predictedSec: predictFinishSec(s), to });
  }
  return sent;
}

export async function sendMilestonePush(db: Db, p: { eventId: string; athleteId: string; milestone: Milestone; elapsedSec: number; predictedSec: number | null; to: string[] }): Promise<number> {
  if (!p.to.length) return 0;
  const { data: a } = await db.from('athletes').select('name').eq('id', p.athleteId).maybeSingle();
  const name = String(a?.name || '');
  const url = `/events/${p.eventId}/live?runner=${p.athleteId}`;
  const subs = await subscriptionsForAthletes(p.to);
  const { byAthlete } = await sendPushLocalized(subs, (locale) => ({
    ...milestoneCopy(locale === 'en' ? 'en' : 'he', { name, milestone: p.milestone, elapsedSec: p.elapsedSec, predictedSec: p.predictedSec }),
    kind: 'race_live',
    category: 'events',
    url,
    // One tag per runner+milestone: even a duplicate delivery collapses on the phone.
    tag: `race-${p.eventId}-${p.athleteId}-${p.milestone}`,
  }));
  const copy = milestoneCopy('he', { name, milestone: p.milestone, elapsedSec: p.elapsedSec, predictedSec: p.predictedSec });
  await persistNotifications(p.to.map((id) => ({ athleteId: id, kind: 'race_live', actorAthleteId: p.athleteId, title: copy.title, body: copy.body, url })), byAthlete);
  return Object.values(byAthlete).reduce((n, v) => n + v, 0);
}

/** A feed card per finisher with the official time. Idempotent per runner+event. */
export async function postFinisherCard(db: Db, eventId: string, athleteId: string, splits: Split[]): Promise<void> {
  const fin = cleanSplits(splits).find((s) => s.point === 'finish');
  if (!fin) return;
  const { data: twin } = await db.from('feed_items').select('id').eq('type', 'achievement').eq('author_athlete_id', athleteId).eq('payload->>raceEventId', eventId).limit(1);
  const body = `מרתון ולנסיה · ${formatClock(fin.elapsedSec)}`;
  const payload = { kind: 'race_result', raceEventId: eventId, chipSec: fin.elapsedSec, half: cleanSplits(splits).find((s) => s.point === 'half')?.elapsedSec ?? null };
  // Staff's chip time replacing the watch's: the card follows, the push does not repeat.
  if ((twin || []).length) {
    await db.from('feed_items').update({ body, payload }).eq('id', twin![0].id);
    return;
  }
  const { error } = await db.from('feed_items').insert({
    type: 'achievement',
    author_athlete_id: athleteId,
    body,
    payload,
    occurred_at: new Date().toISOString(),
  });
  if (error) console.warn('race finisher card failed:', error.message);
}

/** One poller tick for every active race. Called every minute on race day. */
export async function raceLiveTick(opts: { nowMs?: number; db?: Db; fetcher?: typeof fetch; force?: boolean } = {}): Promise<{ races: number; polled: number; changed: number; pushed: number; errors: string[] }> {
  const db = opts.db ?? createServerClient();
  const nowMs = opts.nowMs ?? Date.now();
  const out = { races: 0, polled: 0, changed: 0, pushed: 0, errors: [] as string[] };
  const { data, error } = await db.from('race_live_config').select('*').eq('active', true);
  if (error) { if (!isMissingTable(error)) out.errors.push(error.message); return out; }
  for (const cfg of (data || []) as RaceConfig[]) {
    out.races++;
    const due = opts.force || shouldPoll({
      nowMs,
      fromMs: cfg.poll_from ? Date.parse(cfg.poll_from) : (cfg.source === 'replay' ? 0 : Infinity),
      toMs: cfg.poll_to ? Date.parse(cfg.poll_to) : Infinity,
      lastPolledMs: cfg.last_polled_at ? Date.parse(cfg.last_polled_at) : null,
      failCount: cfg.fail_count,
      everySec: cfg.poll_every_sec,
    });
    // Purge first: 24 h after the window, LiveTrack links and positions are gone whatever else happens.
    if (cfg.poll_to && nowMs > Date.parse(cfg.poll_to) + PURGE_AFTER_MS) {
      await purgeLiveTrack(db, cfg.event_id);
      continue;
    }
    const inWindow = (!cfg.poll_from || nowMs >= Date.parse(cfg.poll_from)) && (!cfg.poll_to || nowMs <= Date.parse(cfg.poll_to));
    if (inWindow || opts.force) {
      try {
        const r = await pollLiveTrack(db, cfg, nowMs, opts.fetcher);
        out.changed += r.changed;
        out.pushed += r.pushed;
      } catch (e: any) { out.errors.push(`livetrack: ${e?.message || e}`); }
    }
    if (!due || cfg.source === 'manual') {
      // Manual entries are announced as they're typed (POST route); nothing to fetch.
      continue;
    }
    try {
      const entries = await loadEntries(db, cfg.event_id);
      const bibs = entries.filter((e) => e.bib && !e.optOut).map((e) => e.bib as string);
      let feed: FeedRunner[];
      if (cfg.source === 'replay') {
        feed = replayFeedAt(bibs, replayRaceSec(nowMs, Date.parse(cfg.replay_started_at || new Date(nowMs).toISOString()), cfg.replay_speed));
      } else {
        if (!cfg.feed_url) throw new Error('feed_url missing');
        feed = await fetchFeed(cfg.feed_url, bibs, opts.fetcher);
      }
      out.polled++;
      const changed = await storeSplits(db, cfg.event_id, mapFeedToEntries(feed, entries), cfg.source);
      out.changed += changed.length;
      out.pushed += await announceMilestones(db, cfg, changed);
      await db.from('race_live_config').update({ last_polled_at: new Date(nowMs).toISOString(), fail_count: 0, last_error: null }).eq('event_id', cfg.event_id);
    } catch (e: any) {
      out.errors.push(String(e?.message || e));
      await db.from('race_live_config').update({ last_polled_at: new Date(nowMs).toISOString(), fail_count: (cfg.fail_count || 0) + 1, last_error: String(e?.message || e).slice(0, 300) }).eq('event_id', cfg.event_id);
    }
  }
  return out;
}

// ─── Garmin LiveTrack ────────────────────────────────────────────────────────

/**
 * One pass over the runners who shared a LiveTrack link: each at most every LIVETRACK_POLL_SEC,
 * sequentially, skipping anyone finished, ended, opted out or failing for good. Splits go through
 * the same storeSplits → announceMilestones path (so dedup and source precedence hold).
 */
export async function pollLiveTrack(db: Db, cfg: RaceConfig, nowMs: number, fetcher?: typeof fetch): Promise<{ polled: number; changed: number; pushed: number }> {
  const data = await entriesWithSharing(db, cfg.event_id, 'athlete_id, live_opt_out, livetrack_url, livetrack_state, livetrack_polled_at');
  const { data: fin } = await db.from('race_splits').select('athlete_id').eq('event_id', cfg.event_id).eq('point', 'finish');
  const finished = new Set((fin || []).map((r: any) => String(r.athlete_id)));
  const out = { polled: 0, changed: 0, pushed: 0 };
  const changed: string[] = [];
  for (const e of (data || []) as any[]) {
    const id = String(e.athlete_id);
    const link = parseLiveTrackUrl(e.livetrack_url);
    if (!link || e.live_opt_out || finished.has(id) || e.livetrack_state === 'ended') continue;
    if (['error:passcode', 'error:not_found', 'error:expired', 'error:refused'].includes(e.livetrack_state)) continue;
    if (e.livetrack_polled_at && nowMs - Date.parse(e.livetrack_polled_at) < (LIVETRACK_POLL_SEC - 5) * 1000) continue;
    let state = 'active';
    try {
      const r = await readLiveTrack(link, fetcher);
      out.polled++;
      const ended = sessionLooksEnded(r, nowMs);
      const p = trackProgress(r.points);
      const splits = progressToSplits(p, { ended });
      // Q26-5: splits still flow (the board's times), but a runner who stopped sharing gets no position row.
      if (p.last && positionSharingOn(e)) {
        await writePosition(db, { event_id: cfg.event_id, athlete_id: id, lat: p.last.lat, lon: p.last.lon, distance_m: Math.round(p.distanceM), elapsed_sec: p.elapsedSec, at: new Date(p.last.t).toISOString(), source: 'livetrack' });
      }
      if ((await storeSplits(db, cfg.event_id, new Map([[id, splits]]), 'livetrack')).length) changed.push(id);
      if (ended) state = 'ended';
    } catch (err) {
      // A personal link before the start has no session yet: not an error, try again next pass.
      state = err instanceof LiveTrackError ? (err.code === 'no_session' ? 'ready' : `error:${err.code}`) : 'error:unreachable';
      // 'refused' means Garmin is pushing back: stop asking for everyone this pass.
      if (state === 'error:refused') { await db.from('race_entries').update({ livetrack_state: state, livetrack_polled_at: new Date(nowMs).toISOString() }).eq('event_id', cfg.event_id).eq('athlete_id', id); break; }
    }
    await db.from('race_entries').update({ livetrack_state: state, livetrack_polled_at: new Date(nowMs).toISOString() }).eq('event_id', cfg.event_id).eq('athlete_id', id);
  }
  out.changed = changed.length;
  out.pushed = await announceMilestones(db, cfg, changed);
  return out;
}

/** Links and positions deleted (24 h after the race, or when a runner opts out). */
export async function purgeLiveTrack(db: Db, eventId: string, athleteId?: string): Promise<void> {
  let q = db.from('race_entries').update({ livetrack_url: null, livetrack_state: null, livetrack_polled_at: null }).eq('event_id', eventId);
  if (athleteId) q = q.eq('athlete_id', athleteId);
  await q;
  let d = db.from('race_positions').delete().eq('event_id', eventId);
  if (athleteId) d = d.eq('athlete_id', athleteId);
  await d;
}

// ─── read model for the live board ──────────────────────────────────────────

export interface BoardRunner {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  bib: string | null;
  goalSec: number | null;
  paceGroup: string | null;
  state: 'not_started' | 'running' | 'finished';
  splits: Split[];
  lastPoint: string | null;
  lastSec: number | null;
  predictedSec: number | null;
  isSelf: boolean;
  /** Which source the latest split came from — 'livetrack' reads as "by the watch". */
  lastSource: SplitSource | null;
  /** Only for a viewer who opted in to the map, and never for an opted-out runner. */
  position: { lat: number; lon: number; distanceM: number; elapsedSec?: number | null; etaSec?: number | null; at: string } | null;
  /** Only on the viewer's own row: is their LiveTrack link set and readable. Never the URL. */
  liveTrack: { set: boolean; state: string | null } | null;
}

/**
 * The board every member sees. Opted-out runners are left out entirely — not masked, absent —
 * except for themselves (so they can see their own state and the switch that hides it).
 */
export async function liveBoard(db: Db, eventId: string, viewerId: string | null): Promise<{ runners: BoardRunner[]; source: string; updatedAt: string | null; active: boolean; mapOptIn: boolean }> {
  const [{ data: cfg }, entries, splits, { data: groups }] = await Promise.all([
    db.from('race_live_config').select('source, active, last_polled_at').eq('event_id', eventId).maybeSingle(),
    loadEntries(db, eventId),
    loadSplits(db, eventId),
    db.from('event_group_assignments').select('athlete_id, event_pace_groups!group_id(label)').eq('event_id', eventId),
  ]);
  const visible = entries.filter((e) => !e.optOut || e.athleteId === viewerId);
  const ids = visible.map((e) => e.athleteId);
  const { data: people } = ids.length ? await db.from('athletes').select('id, name, avatar_url').in('id', ids) : { data: [] as any[] };
  const goals = await entriesWithSharing(db, eventId, 'athlete_id, goal_sec, livetrack_url, livetrack_state');
  const { data: srcRows } = await db.from('race_splits').select('athlete_id, point, source').eq('event_id', eventId);
  const mapOn = viewerId ? !!((await db.from('race_map_viewers').select('athlete_id').eq('event_id', eventId).eq('athlete_id', viewerId)).data || []).length : false;
  const { data: posRows } = mapOn ? await db.from('race_positions').select('athlete_id, lat, lon, distance_m, elapsed_sec, at').eq('event_id', eventId) : { data: [] as any[] };
  const ltOf = new Map((goals || []).map((g: any) => [String(g.athlete_id), g]));
  const groupOf = new Map((groups || []).map((g: any) => [String(g.athlete_id), g.event_pace_groups?.label ?? null]));
  const goalOf = new Map((goals || []).map((g: any) => [String(g.athlete_id), g.goal_sec ?? null]));
  const runners = visible.map((e) => {
    const p = (people || []).find((x: any) => String(x.id) === e.athleteId);
    const s = cleanSplits(splits.get(e.athleteId) ?? []);
    const last = s[s.length - 1] ?? null;
    return {
      athleteId: e.athleteId,
      name: p?.name ?? '',
      avatarUrl: p?.avatar_url ?? null,
      bib: e.bib,
      goalSec: goalOf.get(e.athleteId) ?? null,
      paceGroup: groupOf.get(e.athleteId) ?? null,
      state: !last ? 'not_started' : last.point === 'finish' ? 'finished' : 'running',
      splits: s,
      lastPoint: last?.point ?? null,
      lastSec: last?.elapsedSec ?? null,
      predictedSec: predictFinishSec(s),
      isSelf: e.athleteId === viewerId,
      lastSource: (srcRows || []).find((r: any) => String(r.athlete_id) === e.athleteId && r.point === last?.point)?.source ?? null,
      position: (() => {
        if (e.optOut || ltOf.get(e.athleteId)?.sharing_stopped_at) return null;
        const pr = (posRows || []).find((r: any) => String(r.athlete_id) === e.athleteId);
        // b24: elapsed + a finish estimate from the device's own pace (phone or watch) for the fans' map.
        return pr ? { lat: pr.lat, lon: pr.lon, distanceM: pr.distance_m, elapsedSec: pr.elapsed_sec ?? null, etaSec: phoneEtaSec(pr.distance_m, pr.elapsed_sec ?? 0), at: pr.at } : null;
      })(),
      liveTrack: e.athleteId === viewerId ? { set: !!ltOf.get(e.athleteId)?.livetrack_url, state: ltOf.get(e.athleteId)?.livetrack_state ?? null } : null,
    } as BoardRunner;
  });
  return { runners, source: cfg?.source ?? 'manual', updatedAt: cfg?.last_polled_at ?? null, active: !!cfg?.active, mapOptIn: mapOn };
}
