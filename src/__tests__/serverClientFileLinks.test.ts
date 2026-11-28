import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerClient } from '@/lib/supabase/server';

const OLD = 'https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/avatars/ath-1/a.jpg?v=3';
const BANNER = 'https://eu.supabase.co/storage/v1/object/public/notification-images/n.png';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://eu.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ avatar_url: OLD, image_url: BANNER }]), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': '999' },
  })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('createServerClient hands out /api/files links for private buckets', () => {
  it('rewrites stored public links on every database read; a public bucket stays as stored', async () => {
    const { data, error } = await createServerClient().from('athletes').select('avatar_url, image_url');
    expect(error).toBeNull();
    expect(data).toEqual([{ avatar_url: '/api/files/avatars/ath-1/a.jpg?v=3', image_url: BANNER }]);
  });

  it('rawStorageUrls opts out (the move checks read the stored host)', async () => {
    const { data } = await createServerClient({ rawStorageUrls: true }).from('athletes').select('avatar_url');
    expect(data).toEqual([{ avatar_url: OLD, image_url: BANNER }]);
  });
});
