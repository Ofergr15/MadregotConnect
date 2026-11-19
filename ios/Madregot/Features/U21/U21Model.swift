import Foundation

/// The U21 Personal Coach intake, mirrored from the web's single source of truth
/// (`src/lib/u21/intake.ts` on the u21-personal-coach branch). Keep the two in step:
/// track ids, field keys, options and the guardian/red-flag rules are the server's
/// contract (POST /api/u21/register validates against the same list).
enum U21Track: String, CaseIterable, Identifiable, Sendable {
    case basic, advanced, pro
    var id: String { rawValue }
    var name: String { rawValue.uppercased() }
    var tagline: String {
        switch self {
        case .basic: "תוכנית שבועית מסודרת"
        case .advanced: "תוכנית + מעקב ועדכונים"
        case .pro: "ליווי אישי צמוד"
        }
    }
}

struct U21Field: Identifiable, Sendable {
    enum Kind: Sendable, Equatable {
        case text, email, tel, date, number, textarea
        case radio([String]), checkboxes([String]), yesno, checkbox
    }
    let section: String
    let key: String
    let label: String
    let kind: Kind
    var required = false
    var placeholder: String? = nil
    var redFlag = false
    var id: String { key }
    /// Fields the web marks as draft wording: the red-flag questions and the guardian consent.
    var isDraft: Bool { redFlag || key == "guardianConsent" }
}

enum U21Answer: Equatable, Sendable {
    case text(String), date(Date), choice(String), choices(Set<String>), flag(Bool)
}

enum U21Intake {
    static let draftNote = "טיוטה - ממתין לאישור המאמן והיבטים משפטיים"
    static let testNote = "גרסת בדיקה: יש להזין פרטים בדויים בלבד. אין להזין פרטים אישיים או רפואיים אמיתיים."
    static let dateHint = "יש לבחור תאריך באמצעות סמל לוח השנה. סדר היום והחודש בתצוגה נקבע לפי הגדרות המכשיר או הדפדפן."
    static let frameworks = ["מכינה קדם־צבאית", "שנת שירות", "תיכון", "אחר"]
    static let weekDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    static let guardianKeys: Set<String> = ["guardianName", "guardianPhone", "guardianConsent"]

    static let fields: [U21Field] = [
        .init(section: "פרטים אישיים", key: "firstName", label: "שם פרטי", kind: .text, required: true),
        .init(section: "פרטים אישיים", key: "lastName", label: "שם משפחה", kind: .text, required: true),
        .init(section: "פרטים אישיים", key: "email", label: "אימייל", kind: .email, required: true),
        .init(section: "פרטים אישיים", key: "phone", label: "מספר נייד", kind: .tel, required: true, placeholder: "050-0000000"),
        .init(section: "פרטים אישיים", key: "birthDate", label: "תאריך לידה", kind: .date, required: true),
        .init(section: "פרטים אישיים", key: "guardianName", label: "שם הורה / אפוטרופוס", kind: .text, required: true),
        .init(section: "פרטים אישיים", key: "guardianPhone", label: "טלפון הורה / אפוטרופוס", kind: .tel, required: true),
        .init(section: "פרטים אישיים", key: "guardianConsent", label: "אישור הורה / אפוטרופוס להצטרפות (נוסח טיוטה)", kind: .checkbox, required: true),
        .init(section: "מסגרת ומטרה", key: "framework", label: "מסגרת נוכחית", kind: .radio(frameworks), required: true),
        .init(section: "מסגרת ומטרה", key: "frameworkOther", label: "פרט/י (מסגרת אחרת)", kind: .text),
        .init(section: "מסגרת ומטרה", key: "goal", label: "מה המטרה הספורטיבית שלך?", kind: .textarea, required: true, placeholder: "למשל: גיבוש, שיפור 3 ק״מ, מבדק כושר"),
        .init(section: "מסגרת ומטרה", key: "targetDate", label: "תאריך יעד (אם יש)", kind: .date),
        .init(section: "ניסיון וכושר", key: "experience", label: "ניסיון באימונים", kind: .radio(["אין ניסיון", "פחות משנה", "1–3 שנים", "יותר מ־3 שנים"]), required: true),
        .init(section: "ניסיון וכושר", key: "fitnessResults", label: "תוצאות כושר נוכחיות (3 ק״מ, מתח, שכיבות סמיכה...)", kind: .textarea),
        .init(section: "ניסיון וכושר", key: "runsPerWeek", label: "כמה פעמים בשבוע את/ה רץ/ה?", kind: .radio(["0", "1–2", "3–4", "5+"]), required: true),
        .init(section: "ניסיון וכושר", key: "weeklyKm", label: "נפח ריצה שבועי משוער (ק״מ)", kind: .number),
        .init(section: "ניסיון וכושר", key: "strengthExperience", label: "ניסיון באימוני כוח", kind: .radio(["אין", "מעט", "מתאמן/ת באופן קבוע"]), required: true),
        .init(section: "ניסיון וכושר", key: "otherTraining", label: "אימונים במסגרת אחרת (מכינה, קבוצה, חוג...)", kind: .textarea),
        .init(section: "זמינות וציוד", key: "availableDays", label: "באילו ימים אפשר להתאמן?", kind: .checkboxes(weekDays), required: true),
        .init(section: "זמינות וציוד", key: "equipment", label: "ציוד זמין", kind: .checkboxes(["ללא ציוד", "מתח", "משקולות", "חדר כושר", "גומיות", "מסלול / מגרש"])),
        .init(section: "שינה והתאוששות", key: "sleepHours", label: "כמה שעות שינה בלילה בממוצע?", kind: .radio(["פחות מ־6", "6–7", "7–8", "יותר מ־8"]), required: true),
        .init(section: "שינה והתאוששות", key: "recovery", label: "איך את/ה מרגיש/ה מבחינת עייפות והתאוששות?", kind: .radio(["טוב", "בינוני", "עייף/ה רוב הזמן"])),
        .init(section: "בריאות ובטיחות", key: "chestPain", label: "האם חווית כאב / לחץ בחזה במהלך מאמץ?", kind: .yesno, required: true, redFlag: true),
        .init(section: "בריאות ובטיחות", key: "fainting", label: "האם התעלפת או כמעט התעלפת במהלך / אחרי מאמץ?", kind: .yesno, required: true, redFlag: true),
        .init(section: "בריאות ובטיחות", key: "bonePain", label: "האם יש כאב נקודתי בעצם (שוק, כף רגל, ירך) שמחמיר בריצה?", kind: .yesno, required: true, redFlag: true),
        .init(section: "בריאות ובטיחות", key: "acuteInjury", label: "האם יש כרגע פציעה חריפה (נפיחות, צליעה, כאב חד)?", kind: .yesno, required: true, redFlag: true),
        .init(section: "בריאות ובטיחות", key: "injuries", label: "פציעות / כאבים / תסמינים נוספים (עבר או הווה)", kind: .textarea),
        .init(section: "העדפות", key: "preferences", label: "העדפות ומגבלות (שעות, סוגי אימון, דברים שחשוב שנדע)", kind: .textarea),
    ]

    static var sections: [String] {
        var seen: [String] = []
        for f in fields where !seen.contains(f.section) { seen.append(f.section) }
        return seen
    }

    static func age(_ birth: Date, now: Date = .now) -> Int {
        Calendar(identifier: .gregorian).dateComponents([.year], from: birth, to: now).year ?? 0
    }

    /// Mirrors fieldVisible(): guardian fields only under 18; "other framework" only when "אחר".
    static func visible(_ f: U21Field, answers: [String: U21Answer], now: Date = .now) -> Bool {
        if guardianKeys.contains(f.key) {
            guard case .date(let b)? = answers["birthDate"] else { return false }
            return age(b, now: now) < 18
        }
        if f.key == "frameworkOther" { return answers["framework"] == .choice("אחר") }
        return true
    }

    /// Required-field and age checks for one section, mirroring validateU21Intake().
    static func errors(section: String, answers: [String: U21Answer], now: Date = .now) -> [String: String] {
        var out: [String: String] = [:]
        for f in fields where f.section == section && visible(f, answers: answers, now: now) {
            let a = answers[f.key]
            if f.required {
                switch (f.kind, a) {
                case (.checkbox, .flag(true)?), (.yesno, .flag?): break
                case (.checkboxes, .choices(let s)?) where !s.isEmpty: break
                case (.radio, .choice?), (.date, .date?): break
                case (_, .text(let t)?) where !t.trimmingCharacters(in: .whitespaces).isEmpty: break
                default: out[f.key] = "שדה חובה"
                }
            }
            if f.key == "email", case .text(let t)? = a, !t.isEmpty, !t.contains("@") { out[f.key] = "כתובת לא תקינה" }
            if f.key == "birthDate", case .date(let b)? = a {
                let age = age(b, now: now)
                if age < 16 || age > 21 { out[f.key] = "התוכנית מיועדת לגילאי 16–21" }
            }
        }
        return out
    }

    /// Any red-flag "yes" — shown to the coach as "needs attention"; changes nothing for the applicant.
    static func redFlag(_ answers: [String: U21Answer]) -> Bool {
        fields.contains { $0.redFlag && answers[$0.key] == .flag(true) }
    }
}
