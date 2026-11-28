# Hebrew running glossary (messages/he.json)

**How to use:** when you write or edit Hebrew UI copy, use the **canonical** spelling below and never the **avoid** form. The canonical form is whatever already dominates `messages/he.json`. For typography, use Hebrew gershayim `״` and geresh `׳` in abbreviations, not ASCII `"` / `'`. This covers UI copy only. Leave examples of what a coach types (workout syntax hints, the `3:30 (3:40) ((3:50))` pace notation) and quotes as they are.

Counts were measured on he.json on 2026-11-27, before alignment.

| Term | Canonical | Avoid | Meaning | Notes / examples |
|---|---|---|---|---|
| Kilometer (abbr.) | ק״מ | ק"מ, קמ | km | 187 vs 29 before; all 29 aligned. `5 ק״מ`, `ק״מ השבוע` |
| Kilometers (word) | קילומטרים | – | kilometers | Use the word where it's a noun in a sentence or chart title ("כל קילומטר") |
| Per km | /ק״מ (compact), לק״מ (in prose/labels) | /ק"מ, לק"מ | per km | Both are valid. Use `/ק״מ` right after a number and `לק״מ` in text |
| Minute (abbr.) | דק׳ | דק' | min | 31 vs 2; aligned |
| Second (abbr.) | שנ׳ | שנ' | sec | 31 vs 3; aligned. `שנ׳/ק״מ` |
| Pace | קצב | פייס | pace | 254 uses, no competitor |
| Pace group / pack | דבוקה, דבוקות | קבוצת קצב, קבוצה (for a pace group) | pace band/group | 137 vs 2; aligned "קבוצת קצב". `קבוצה` stays for training groups, see owner questions |
| Intervals (workout type) | אינטרוולים / אינטרוול | אינטרבלים | intervals | Not the same as חזרות |
| Reps | חזרות | – | repetitions inside a workout | 100 uses. Different from the workout type |
| Tempo | טמפו | – | tempo run | |
| Long run | ריצה ארוכה (full), ארוכה / הארוכה (short labels) | – | long run | Short form is fine in chips and tables |
| Easy run | ריצה קלה | – | easy run | |
| Recovery | התאוששות | – | recovery | |
| Warm-up | חימום | – | warm-up | |
| Cool-down | שחרור | קירור | cool-down | 12 vs 2; aligned |
| Strides | האצות | סטריידים | strides | Only one use so far |
| Quality session | אימון איכות / אימוני איכות | – | quality workout | |
| Fartlek | פארטלק | פרטלק | fartlek | Decided 28.11: פארטלק in all UI copy. The plan parser and the workout classifier accept both spellings as input (`/פא?רטלק/`), because coaches write both |
| Lap | הקפה / הקפות | לאפ, לאפים | lap | 27 vs 1; aligned |
| Splits | פיצולים / פיצול | ספליטים | per-km splits | 4 vs 1; aligned |
| Watch | שעון | – | GPS watch | |
| Coach | מאמן, המאמן/ת (when addressing unknown gender) | – | coach | Gender-neutral form only where the reader's gender is unknown |
| Trainee (academy) | מתאמן / מתאמנים, ICU `select` for gender | – | academy trainee | |
| Athlete / club runner | רצים, ספורטאים | – | club member | See owner questions |
| Marathon / half | מרתון / חצי מרתון | חצי-מרתון | marathon / half | |
| Personal record | שיא אישי / שיאים אישיים | PR | personal best | |
| Weekly volume | נפח שבועי | – | weekly mileage | |
| Race | מרוץ | מירוץ | race | |
| Garmin | גרמין inside Hebrew sentences | Garmin in a sentence, גארמין | | Latin only on connect/disconnect buttons and brand badges next to a logo. The app name **Garmin Connect** stays Latin (it is what the runner looks for on the phone) |
| Strava | סטרבה inside Hebrew sentences | Strava in a sentence, סטראבה | | Latin only on connect/sign-in buttons, brand badges next to a logo, and legal attribution ("Powered by Strava" stays Latin, Strava brand rules) |

## Owner questions

1. **Fartlek spelling.** It was split 1:1 (פרטלק / פארטלק). **Decided (28.11): פארטלק** everywhere in UI copy; the parser accepts both as input.
2. **Brand names, Hebrew or Latin?** he.json had Strava 41 / סטרבה 14 and Garmin 46 / גרמין 70. **Decided (28.11):** סטרבה / גרמין inside Hebrew sentences (a Latin word mid-sentence can scramble RTL word order); Strava / Garmin in Latin only on connect/disconnect buttons, brand badges next to logos, and legal attribution ("Powered by Strava"). Applied to he.json; keys left Latin: the sign-in/connect/disconnect/switch buttons and the bare brand labels (`planner.garmin`, `settings.garmin`, `profile.strava`, `profile.garminConnect`, `onbFunnel.source.strava-login`).
3. **ספורטאים vs מתאמנים vs רצים.** Default: unchanged. מתאמנים = academy trainees, ספורטאים/רצים = club members. Is that distinction intended?
4. **קבוצה used for a pace group** (e.g. "הקבוצה הזו" in the pace-offset preview, "לשלוש הקבוצות" in the audit). Default: **not yet aligned**. `קבוצה` appears 82 times, mostly in its own meaning (training group, group run), so this needs a string-by-string review.
5. **סה"כ (ASCII gershayim, not a running term).** Default: left as is, out of scope.

## Not yet aligned

- `קבוצה` where it means a pace group (see question 4).
- Hardcoded Hebrew in `src/**/*.tsx` was not checked or edited.
