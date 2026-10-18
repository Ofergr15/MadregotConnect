import { apiHeaders } from '@/lib/api';
import type { ClubUpdate } from '@/lib/club-updates/server';

export interface StreamResponse {
  enabled: boolean;
  canWrite?: boolean;
  admin?: boolean;
  me?: string | null;
  missing?: boolean;
  updates: ClubUpdate[];
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: await apiHeaders(true), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed');
  return data as T;
}

export const publishUpdate = (b: { body: string; imageUrl: string | null; breaking: boolean; pinned: boolean }) =>
  send<{ update: ClubUpdate; push: boolean }>('/api/club-updates', 'POST', b);
export const editUpdate = (id: string, b: Partial<{ body: string; imageUrl: string | null; breaking: boolean; pinned: boolean; restore: boolean }>) =>
  send<{ update: ClubUpdate }>(`/api/club-updates/${id}`, 'PATCH', b);
export const deleteUpdate = (id: string) => send<{ ok: true; pushStopped: boolean }>(`/api/club-updates/${id}`, 'DELETE');
export const reactTo = (id: string, emoji: string) => send<{ update: ClubUpdate }>(`/api/club-updates/${id}/react`, 'POST', { emoji });
