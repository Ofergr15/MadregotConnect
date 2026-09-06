/**
 * Device-local keys for the push subscription, in a module with NO imports.
 *
 * Both a UI component (PushOptIn) and the crash-recovery path (recover.ts) need
 * to agree on this key, and recover.ts is imported by CrashScreen — which must
 * stay free of the module graph that may be what crashed. So the key lives
 * here rather than being exported from either side, and a mismatched literal
 * can't silently disable the re-check.
 */

/**
 * Last day (YYYY-MM-DD) the subscription self-heal ran successfully on this
 * device — see ensurePushSubscription. Once a day is plenty: the thing it
 * repairs only changes when iOS drops the subscription underneath us.
 */
export const PUSH_HEAL_DAY_KEY = 'push_sub_healed_on';
