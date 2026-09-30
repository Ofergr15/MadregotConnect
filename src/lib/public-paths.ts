/**
 * The pages a stranger reaches with no account: the landing page, login, the join
 * and register links, the academy's Instagram page and form.
 *
 * Shared by the two things that must behave differently there:
 *  - MaintenanceGate never covers them (see its header for why)
 *  - UpdatePrompt never updates on them — no "New version" sheet, no silent reload.
 *    Somebody filling in the academy form from an Instagram link is not using the
 *    app, and a reload after they come back from WhatsApp loses every field.
 */
export const PUBLIC_PATHS = ['/', '/login', '/auth', '/garmin-callback', '/join', '/register', '/academy', '/academy-register', '/claim', '/pending-approval'];

export const isPublicPath = (p: string) =>
  PUBLIC_PATHS.some((pub) => p === pub || p.startsWith(pub + '/'));
