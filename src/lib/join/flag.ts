// The one switch for the unified sign-up (components/join/JoinFlow, mockup
// join-flow-mockup.html, Ofer 2026-10-20). Off: /register is today's form for
// everyone except the onboarding-v2 preview and a `?join=1` link. Flip to ship.
export const JOIN_UNIFIED_FOR_ALL = true;

/** Session storage key: the details typed in the unified sign-up, read by /academy-register?from=join. */
export const JOIN_HANDOFF_KEY = 'mc:join-details';
