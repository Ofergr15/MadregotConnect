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
    /// Verbatim from U21_TRACKS (intake.ts). Deliberately no price anywhere: the draft
    /// prices have no approved source, so the native app never shows a number.
    var benefits: [String] {
        switch self {
        case .basic: ["תוכנית ריצה שבועית מותאמת אישית", "תרגילי כוח ומוביליטי בסיסיים", "התוכנית עוברת בדיקה של המאמן לפני שליחה", "הצטרפות לקהילת מדרגות"]
        case .advanced: ["כל מה שב־BASIC", "תוכנית כוח ומוביליטי מלאה", "עדכון התוכנית לפי משוב שבועי", "מעקב התקדמות לקראת יעד (גיבוש / מבדק / תחרות)", "הצטרפות לקהילת מדרגות"]
        case .pro: ["כל מה שב־ADVANCED", "ליווי אישי צמוד של המאמן", "שיחת היכרות ושיחות מעקב", "התאמות שוטפות לאורך השבוע", "הצטרפות לקהילת מדרגות"]
        }
    }
    /// parseU21TrackParam (entry.ts): exact ids only, anything else is no preselection.
    init?(param: String?) {
        guard let param, let t = U21Track(rawValue: param) else { return nil }
        self = t
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
    /// Verbatim from the web track picker.
    static let noPaymentNote = "בחירת מסלול אינה כרוכה בתשלום בשלב זה."
    /// Owner-fixed wording (Nov 19) for the top of the demo confirmation: an operational
    /// truth label, not marketing copy. Nothing in this flow is sent or stored.
    static let demoNotice = "מסך זה הוא הדגמה בלבד - הפרטים לא נשלחו ולא נשמרו."
    static let redFlagKeys = ["chestPain": "chest_pain", "fainting": "fainting", "bonePain": "bone_pain", "acuteInjury": "acute_injury"]
    static let minAge = 16
    static let maxAge = 21
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

    /// One section's checks, mirroring validateU21Intake() — same messages, same order of
    /// precedence (a missing required value is reported, other checks only on a value).
    static func errors(section: String, answers: [String: U21Answer], now: Date = .now) -> [String: String] {
        var out: [String: String] = [:]
        for f in fields where f.section == section && visible(f, answers: answers, now: now) {
            let a = answers[f.key]
            if f.required && isEmpty(f, a) {
                out[f.key] = f.kind == .checkbox ? "נדרש אישור הורה / אפוטרופוס" : "שדה חובה"
                continue
            }
            if case .text(let raw)? = a {
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if t.isEmpty { continue }
                if t.count > 2000 { out[f.key] = "ארוך מדי" }
                if f.kind == .email, !matches(t, emailPattern) { out[f.key] = "אימייל לא תקין" }
                if f.kind == .tel, !matches(t.replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: ""), phonePattern) {
                    out[f.key] = "מספר טלפון לא תקין"
                }
                if f.kind == .number, !matches(t, numberPattern) || (Double(t) ?? 0) > 300 { out[f.key] = "מספר לא תקין" }
            }
            if f.key == "birthDate", case .date(let b)? = a {
                let years = age(b, now: now)
                if years < minAge || years > maxAge { out[f.key] = "השירות מיועד לגילאי \(minAge)–\(maxAge)" }
            }
        }
        return out
    }

    /// All sections at once — the review step re-checks everything before the demo "send".
    static func allErrors(answers: [String: U21Answer], now: Date = .now) -> [String: String] {
        sections.reduce(into: [:]) { acc, s in acc.merge(errors(section: s, answers: answers, now: now)) { a, _ in a } }
    }

    /// The first section that has an error, so the review can send the user straight to it.
    static func firstSectionWithErrors(answers: [String: U21Answer], now: Date = .now) -> String? {
        sections.first { !errors(section: $0, answers: answers, now: now).isEmpty }
    }

    /// Only visible fields leave the questionnaire (pickKnownAnswers): a guardian entered
    /// before the birth date said "adult", or "other framework" after switching away from
    /// "אחר", is dropped, not kept as a hidden answer.
    static func visibleAnswers(_ answers: [String: U21Answer], now: Date = .now) -> [String: U21Answer] {
        var out: [String: U21Answer] = [:]
        for f in fields where visible(f, answers: answers, now: now) {
            if let a = answers[f.key] { out[f.key] = a }
        }
        return out
    }

    private static let emailPattern = #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#
    private static let phonePattern = #"^0\d{8,9}$"#
    private static let numberPattern = #"^\d+(\.\d+)?$"#

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    private static func isEmpty(_ f: U21Field, _ a: U21Answer?) -> Bool {
        switch (f.kind, a) {
        case (.checkbox, .flag(true)?): false
        case (.checkbox, _): true
        case (.yesno, .flag?): false
        case (.checkboxes, .choices(let s)?): s.isEmpty
        case (.radio, .choice?), (.date, .date?): false
        case (_, .text(let t)?): t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: true
        }
    }

    /// Any red-flag "yes" — shown to the coach as "needs attention"; changes nothing for the applicant.
    static func redFlag(_ answers: [String: U21Answer]) -> Bool {
        fields.contains { $0.redFlag && answers[$0.key] == .flag(true) }
    }
}
