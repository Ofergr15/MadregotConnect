/**
 * apple-app-site-association for universal links into the native app.
 *
 * Scoped ONLY to the invite paths the app handles:
 *  - /join/<token>                 member invite (src/app/join/[token])
 *  - /academy-register?i=<token>   academy invite (query key `i`, read in
 *                                  src/app/academy-register/page.tsx)
 * No webcredentials, no other paths. The app also needs the Associated Domains
 * entitlement `applinks:www.madregot.app` (native side).
 */
export const AASA_APP_ID = 'V7D6R3AB64.app.madregot.ios';

export const AASA = {
  applinks: {
    details: [
      {
        appIDs: [AASA_APP_ID],
        components: [
          { '/': '/join/*', comment: 'Member invite' },
          { '/': '/academy-register*', comment: 'Academy invite (?i=<token>)' },
        ],
      },
    ],
  },
} as const;
