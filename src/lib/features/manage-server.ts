import type { SupabaseClient } from '@supabase/supabase-js';
import { coachIdsByTrainee } from '@/lib/academy/trainee-coaches';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';
import {
  coachesAthlete, resolveFeature, visibleToManager, type EnablementRow, type FeatureKey, type ToggleCaller,
} from './flags';
import { enablementRows } from './server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export function toggleCaller(c: VerifiedCaller): ToggleCaller {
  return { athleteId: c.athleteId, role: c.role, roles: c.roles ?? [c.role], isSuperUser: c.isSuperUser };
}

interface AthleteRow { id: string; name: string | null; avatar_url: string | null; group_id: string | null; role: string | null; extra_roles?: string[] | null; is_academy: boolean | null; status?: string | null; academy_coach_id?: string | null }

/** Every athlete the caller's screen lists, each with the resolved state and whether the caller may flip it. */
export async function managedAthletes(db: Db, caller: VerifiedCaller, feature: FeatureKey) {
  const tc = toggleCaller(caller);
  let { data, error } = await db.from('athletes')
    .select('id, name, avatar_url, group_id, role, extra_roles, is_academy, status, academy_coach_id');
  if (error) ({ data, error } = await db.from('athletes').select('id, name, avatar_url, group_id, role, is_academy, status'));
  const rows = ((data || []) as AthleteRow[]).filter((a) => (a.status ?? 'active') === 'active');
  const coachMap = await coachIdsByTrainee(db, rows.filter((r) => r.is_academy).map((r) => r.id), rows).catch(() => new Map<string, string[]>());
  const enablements: EnablementRow[] = (await enablementRows(feature, db)) ?? [];
  const { data: groups } = await db.from('groups').select('id, name');
  const groupName = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [String(g.id), g.name]));
  const out = [];
  for (const a of rows) {
    const facts = { isAcademy: !!a.is_academy, academyCoachIds: coachMap.get(a.id) ?? [] };
    if (!visibleToManager(tc, facts)) continue;
    const res = resolveFeature(feature, enablements, {
      id: a.id, groupId: a.group_id ? String(a.group_id) : null, role: a.role, extraRoles: a.extra_roles ?? [], isAcademy: !!a.is_academy,
    });
    out.push({
      id: a.id, name: a.name, avatarUrl: a.avatar_url, isAcademy: !!a.is_academy,
      squad: a.group_id ? groupName.get(String(a.group_id)) ?? null : null, squadId: a.group_id ? String(a.group_id) : null,
      enabled: res.enabled, source: res.source,
      coachedByCaller: coachesAthlete(tc, facts),
    });
  }
  return { athletes: out.sort((x, y) => (x.name || '').localeCompare(y.name || '', 'he')), enablements, groups: [...groupName].map(([id, name]) => ({ id, name })) };
}

/** Facts for a single athlete-scope write, from the DB — never from the body. */
export async function athleteToggleFacts(db: Db, caller: VerifiedCaller, athleteId: string) {
  const { data } = await db.from('athletes').select('id, is_academy, academy_coach_id').eq('id', athleteId).maybeSingle();
  if (!data) return null;
  const map = await coachIdsByTrainee(db, [athleteId], [data]).catch(() => new Map<string, string[]>());
  const facts = { isAcademy: !!data.is_academy, academyCoachIds: map.get(athleteId) ?? [] };
  return { isAcademy: facts.isAcademy, coachedByCaller: coachesAthlete(toggleCaller(caller), facts) };
}
