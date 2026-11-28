import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { noteSwallowed } from '@/lib/errors/swallowed';

// The OAuth `state` for "connect Strava to THIS athlete" (link mode).
//
// It used to be the bare athlete id. Strava echoes `state` back untouched and the
// callback wrote the returning Strava account onto whichever row it named, with no
// session to check (the callback is a browser redirect from Strava). Anyone could
// therefore build their own authorize URL with state=<someone's id>, approve their
// own Strava account, and have it written onto that member — and because login mode
// recognises a member by strava_athlete_id, their next "Sign in with Strava" then
// resolved to the victim's row.
//
// Now the state is minted by GET /api/strava only AFTER requireCallerForAthlete has
// verified the caller may act for that athlete, and the callback accepts only a
// state this server signed, for that athlete, in the last 10 minutes.
//
// Signed with ENCRYPTION_KEY under its own label (the action-token approach), so no
// new environment variable is needed; an unusable key fails closed.
//
// Single use: GET /api/strava RESERVES the state's nonce in app_settings
// (key stravalink:<nonce>, value = the athlete id; at most one outstanding per athlete) and the callback CONSUMES it with
// one DELETE ... RETURNING before the code exchange. Only one request can delete the
// row, so a state works once, wherever it is completed.
//
// Why a server-side nonce and not a cookie: an installed iOS home-screen app opens
// Strava in a separate in-app browser sheet with its own storage (see
// supabase/migrations/082_login_handoffs.sql), so a cookie set on the app's fetch never
// reaches the callback and every link from the installed app would be refused.
// app_settings already exists (migration 032; key is the PRIMARY KEY): no migration.
//
// Residual, by design of OAuth state: whoever completes a valid state FIRST wins.
// Someone who captured a victim's state (URL, logs) and completed it within 10
// minutes, before the victim, would link their own Strava onto that athlete. The
// state is only ever in the victim's own browser, Strava, and server logs.

const PREFIX = 'link.';
const LABEL = 'strava-link-state-v1';
export const LINK_STATE_MAX_AGE_SECONDS = 10 * 60;

function secret(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

const mac = (s: string, body: string) => createHmac('sha256', s).update(body).digest('base64url');

/** A signed link state for `athleteId`, or null when the key is unusable. */
export function signLinkState(athleteId: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const s = secret();
  if (!s || !athleteId) return null;
  const body = `${Buffer.from(athleteId, 'utf8').toString('base64url')}.${nowSeconds}.${randomBytes(9).toString('base64url')}`;
  return `${PREFIX}${body}.${mac(s, body)}`;
}

// No `_` or `%` in the prefix: it is used in a LIKE pattern below, where `_` would
// match any character and sweep unrelated settings.
const NONCE_KEY_PREFIX = 'stravalink:';
// Beside each reservation, where its answer returns to. `stravalink:%` does not match it
// (the colon comes earlier), so it is swept on its own.
const RETURN_KEY_PREFIX = 'stravalinkret:';

/** Where a link started: the member's own profile, the coach's athletes page, or the native app. */
export type LinkReturn = 'profile' | 'athletes' | 'app';

type Db = { from: (t: string) => any };

function nonceOf(state: string): string | null {
  if (!state.startsWith(PREFIX)) return null;
  const parts = state.slice(PREFIX.length).split('.');
  return parts.length === 4 && parts[2] ? parts[2] : null;
}

/**
 * Records the state's nonce for one later use, replacing any earlier reservation
 * for the same athlete (so a caller cannot pile up rows; the latest attempt wins).
 * False (fail closed) on any DB error.
 */
export async function reserveLinkState(db: Db, state: string, athleteId: string, returnTo: LinkReturn = 'profile'): Promise<boolean> {
  const nonce = nonceOf(state);
  if (!nonce) return false;
  try {
    // Best-effort: this athlete's earlier reservations, and anyone's that expired.
    const cutoff = new Date(Date.now() - LINK_STATE_MAX_AGE_SECONDS * 1000 - 60_000).toISOString();
    // The return hints of the reservations being replaced go with them (keyed by nonce).
    const { data: prior } = await db.from('app_settings').select('key').like('key', `${NONCE_KEY_PREFIX}%`).eq('value', athleteId);
    const priorNonces = ((prior || []) as Array<{ key: string }>).map((r) => r.key.slice(NONCE_KEY_PREFIX.length));
    if (priorNonces.length) await db.from('app_settings').delete().in('key', priorNonces.map((n) => `${RETURN_KEY_PREFIX}${n}`));
    await db.from('app_settings').delete().like('key', `${NONCE_KEY_PREFIX}%`).eq('value', athleteId);
    await db.from('app_settings').delete().like('key', `${NONCE_KEY_PREFIX}%`).lt('updated_at', cutoff);
    // Hints outlive nothing: an abandoned one expires with the same cutoff.
    await db.from('app_settings').delete().like('key', `${RETURN_KEY_PREFIX}%`).lt('updated_at', cutoff);
  } catch (err) { noteSwallowed('strava.link-state', err); /* the reservation below still decides */ }
  const { error } = await db.from('app_settings').insert({ key: `${NONCE_KEY_PREFIX}${nonce}`, value: athleteId, updated_at: new Date().toISOString() });
  if (error) return false;
  // Where the callback sends them back to. A redirect target only — it names no row and
  // grants nothing, so it is kept beside the reservation rather than inside the signature.
  // Only the coach's page needs remembering: anything unknown returns to the profile,
  // which every role has and which shows the result.
  if (returnTo !== 'profile') {
    try { await db.from('app_settings').insert({ key: `${RETURN_KEY_PREFIX}${nonce}`, value: returnTo, updated_at: new Date().toISOString() }); } catch { /* the profile, then */ }
  }
  return true;
}


/** Where this state's link should return to, read without clearing it. 'profile' when unknown. */
export async function readLinkReturn(db: Db, state: string | null | undefined): Promise<LinkReturn> {
  const nonce = state ? nonceOf(state) : null;
  if (!nonce) return 'profile';
  try {
    const { data } = await db.from('app_settings').select('value').eq('key', `${RETURN_KEY_PREFIX}${nonce}`);
    const v = Array.isArray(data) ? data[0]?.value : null;
    return v === 'athletes' || v === 'app' ? v : 'profile';
  } catch {
    return 'profile';
  }
}

/** Drops the return hint once its state is settled (used, or known dead). Best-effort. */
export async function clearLinkReturn(db: Db, state: string | null | undefined): Promise<void> {
  const nonce = state ? nonceOf(state) : null;
  if (!nonce) return;
  try { await db.from('app_settings').delete().eq('key', `${RETURN_KEY_PREFIX}${nonce}`); } catch { /* expires with its cutoff */ }
}

export type ConsumeResult = 'ok' | 'not_found' | 'error';

/**
 * Atomically consumes the reservation for this state and athlete: 'ok' exactly once,
 * 'not_found' when it was never reserved, already used or replaced, and 'error' when
 * the store could not answer. Both non-ok results must refuse the link.
 */
export async function consumeLinkState(db: Db, state: string, athleteId: string): Promise<ConsumeResult> {
  const nonce = nonceOf(state);
  if (!nonce) return 'not_found';
  try {
    const { data, error } = await db.from('app_settings')
      .delete().eq('key', `${NONCE_KEY_PREFIX}${nonce}`).eq('value', athleteId).select('key');
    if (error) return 'error';
    return Array.isArray(data) && data.length === 1 ? 'ok' : 'not_found';
  } catch {
    return 'error';
  }
}

/** The athlete id a valid, unexpired state names; null for anything else. */
export function verifyLinkState(state: string | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const s = secret();
  if (!s || !state || !state.startsWith(PREFIX)) return null;
  const parts = state.slice(PREFIX.length).split('.');
  if (parts.length !== 4) return null;
  const [idPart, issuedPart, nonce, sig] = parts;
  const expected = Buffer.from(mac(s, `${idPart}.${issuedPart}.${nonce}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const issued = Number(issuedPart);
  if (!Number.isInteger(issued) || nowSeconds - issued > LINK_STATE_MAX_AGE_SECONDS || issued - nowSeconds > 60) return null;
  const id = Buffer.from(idPart, 'base64url').toString('utf8');
  return id || null;
}
