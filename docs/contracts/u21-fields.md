# U21 questionnaire fields: what the native form must send

Pinned by `src/__tests__/u21FieldSpecContract.test.ts`; source `src/lib/u21/intake.ts` (`U21_FIELDS`).
These go inside `answers` of `POST /api/u21/register` (see `u21-register.md`).

| key | type | required | notes |
|---|---|---|---|
| firstName, lastName | string | yes | |
| email | string | yes | valid email |
| phone | string | yes | `0` + 8–9 digits; spaces/dashes ignored |
| birthDate | string `YYYY-MM-DD` | yes | age 16–21 |
| guardianName, guardianPhone | string | **only if age < 18** | dropped for adults |
| guardianConsent | **boolean** `true` | **only if age < 18** | |
| framework | radio | yes | מכינה קדם־צבאית · שנת שירות · תיכון · אחר |
| frameworkOther | string | no | only when framework = אחר |
| goal | string | yes | |
| targetDate | string date | no | |
| experience | radio | yes | אין ניסיון · פחות משנה · 1–3 שנים · יותר מ־3 שנים |
| fitnessResults, otherTraining, injuries, preferences | string | no | |
| runsPerWeek | radio | yes | 0 · 1–2 · 3–4 · 5+ |
| weeklyKm | **numeric string** | no | e.g. `"15"`, ≤ 300 |
| strengthExperience | radio | yes | אין · מעט · מתאמן/ת באופן קבוע |
| availableDays | string[] | yes, ≥ 1 | ראשון · שני · שלישי · רביעי · חמישי · שישי · שבת |
| equipment | string[] | no | ללא ציוד · מתח · משקולות · חדר כושר · גומיות · מסלול / מגרש |
| sleepHours | radio | yes | פחות מ־6 · 6–7 · 7–8 · יותר מ־8 |
| recovery | radio | no | טוב · בינוני · עייף/ה רוב הזמן |
| chestPain, fainting, bonePain, acuteInjury | `"yes"` / `"no"` | yes | draft red flags; never change the response |

**Option strings are compared byte-for-byte.** `1–3` uses an en dash (U+2013), `יותר מ־3` uses
the Hebrew maqaf (U+05BE). A plain hyphen fails with 400. Copy the strings, don't retype them.

Tracks: `basic` · `advanced` · `pro` (lowercase). **Don't show prices**: the plan forbids it until
approved. Note that `U21_TRACKS[].priceIls` exists in the server lib and the web `/u21` page
currently renders it.
