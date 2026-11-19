import Foundation
import Testing
@testable import Madregot

struct U21IntakeTests {
    // Noon UTC on Nov 19 is Nov 19 in every time zone from UTC-11 to UTC+11, and a birth
    // date is built as a local calendar date (what a DatePicker yields): no zone can shift
    // either side of the birthday comparison.
    private let now = ISO8601DateFormatter().date(from: "2026-11-19T12:00:00Z")!
    private func birth(yearsAgo: Int, month: Int = 11, day: Int = 19) -> Date {
        Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026 - yearsAgo, month: month, day: day))!
    }

    @Test func tracksMatchTheWebContract() {
        #expect(U21Track.allCases.map(\.rawValue) == ["basic", "advanced", "pro"])
    }

    @Test func guardianFieldsOnlyForMinors() {
        let g = U21Intake.fields.first { $0.key == "guardianName" }!
        #expect(U21Intake.visible(g, answers: ["birthDate": .date(birth(yearsAgo: 17))], now: now))
        #expect(!U21Intake.visible(g, answers: ["birthDate": .date(birth(yearsAgo: 19))], now: now))
    }

    @Test func requiredAndAgeAreEnforced() {
        let empty = U21Intake.errors(section: "פרטים אישיים", answers: [:], now: now)
        #expect(empty["firstName"] == "שדה חובה")
        let tooOld = U21Intake.errors(section: "פרטים אישיים", answers: ["birthDate": .date(birth(yearsAgo: 25))], now: now)
        #expect(tooOld["birthDate"] == "השירות מיועד לגילאי 16–21")
    }

    @Test func redFlagIsAnyYes() {
        #expect(!U21Intake.redFlag(["chestPain": .flag(false)]))
        #expect(U21Intake.redFlag(["fainting": .flag(true)]))
    }
}

/// Pins the native model to the web contract at origin/u21-personal-coach baa5f738
/// (src/lib/u21/intake.ts): 28 fields in order, 7 sections, verbatim notes.
struct U21ContractTests {
    @Test func fieldKeysAndOrderMatchTheWeb() {
        #expect(U21Intake.fields.map(\.key) == ["firstName","lastName","email","phone","birthDate","guardianName","guardianPhone","guardianConsent","framework","frameworkOther","goal","targetDate","experience","fitnessResults","runsPerWeek","weeklyKm","strengthExperience","otherTraining","availableDays","equipment","sleepHours","recovery","chestPain","fainting","bonePain","acuteInjury","injuries","preferences"])
        #expect(U21Intake.sections.count == 7)
    }

    @Test func notesAreVerbatim() {
        #expect(U21Intake.testNote == "גרסת בדיקה: יש להזין פרטים בדויים בלבד. אין להזין פרטים אישיים או רפואיים אמיתיים.")
        #expect(U21Intake.draftNote == "טיוטה - ממתין לאישור המאמן והיבטים משפטיים")
        #expect(U21Intake.dateHint == "יש לבחור תאריך באמצעות סמל לוח השנה. סדר היום והחודש בתצוגה נקבע לפי הגדרות המכשיר או הדפדפן.")
    }

    @Test func draftMarkingCoversRedFlagsAndGuardianConsent() {
        let draft = Set(U21Intake.fields.filter(\.isDraft).map(\.key))
        #expect(draft == ["guardianConsent", "chestPain", "fainting", "bonePain", "acuteInjury"])
    }
}

/// Validation parity with validateU21Intake() at baa5f738: same rules, same Hebrew messages.
struct U21ValidationParityTests {
    // Noon UTC on Nov 19 is Nov 19 in every time zone from UTC-11 to UTC+11, and a birth
    // date is built as a local calendar date (what a DatePicker yields): no zone can shift
    // either side of the birthday comparison.
    private let now = ISO8601DateFormatter().date(from: "2026-11-19T12:00:00Z")!
    private func birth(yearsAgo: Int, month: Int = 11, day: Int = 19) -> Date {
        Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026 - yearsAgo, month: month, day: day))!
    }
    private let personal = "פרטים אישיים"

    private func adult(_ over: [String: U21Answer] = [:]) -> [String: U21Answer] {
        var a: [String: U21Answer] = [
            "firstName": .text("בדיקה"), "lastName": .text("בדיקה"), "email": .text("test@example.com"),
            "phone": .text("050-1234567"), "birthDate": .date(birth(yearsAgo: 19)),
            "framework": .choice("שנת שירות"), "goal": .text("גיבוש"),
            "experience": .choice("פחות משנה"), "runsPerWeek": .choice("1–2"), "strengthExperience": .choice("מעט"),
            "availableDays": .choices(["ראשון"]), "sleepHours": .choice("7–8"),
            "chestPain": .flag(false), "fainting": .flag(false), "bonePain": .flag(false), "acuteInjury": .flag(false),
        ]
        a.merge(over) { _, n in n }
        return a
    }

    @Test func completeAdultIntakeHasNoErrors() {
        #expect(U21Intake.allErrors(answers: adult(), now: now).isEmpty)
        #expect(U21Intake.firstSectionWithErrors(answers: adult(), now: now) == nil)
    }

    @Test func ageBoundaries() {
        for (years, ok) in [(15, false), (16, true), (17, true), (18, true), (21, true), (22, false)] {
            let e = U21Intake.errors(section: personal, answers: adult(["birthDate": .date(birth(yearsAgo: years))]), now: now)
            #expect((e["birthDate"] == nil) == ok, "age \(years)")
        }
    }

    @Test func minorNeedsGuardianNamePhoneAndConsent() {
        let minor = adult(["birthDate": .date(birth(yearsAgo: 17))])
        let e = U21Intake.errors(section: personal, answers: minor, now: now)
        #expect(e["guardianName"] == "שדה חובה")
        #expect(e["guardianPhone"] == "שדה חובה")
        #expect(e["guardianConsent"] == "נדרש אישור הורה / אפוטרופוס")
        var ok = minor
        ok["guardianName"] = .text("הורה בדיקה"); ok["guardianPhone"] = .text("0521234567"); ok["guardianConsent"] = .flag(true)
        #expect(U21Intake.errors(section: personal, answers: ok, now: now).isEmpty)
        ok["guardianConsent"] = .flag(false)
        #expect(U21Intake.errors(section: personal, answers: ok, now: now)["guardianConsent"] != nil)
    }

    @Test func ageFollowsTheWebAgeOn() {
        #expect(U21Intake.age(birth(yearsAgo: 18), now: now) == 18)            // birthday today
        #expect(U21Intake.age(birth(yearsAgo: 18, day: 20), now: now) == 17)   // birthday tomorrow
        #expect(U21Intake.age(birth(yearsAgo: 18, day: 18), now: now) == 18)   // birthday yesterday
        #expect(U21Intake.age(birth(yearsAgo: 0, day: 20), now: now) == nil)   // tomorrow → invalid
        #expect(U21Intake.age(birth(yearsAgo: -3), now: now) == nil)           // years ahead → invalid
        #expect(U21Intake.age(birth(yearsAgo: 0), now: now) == 0)              // today is not the future
    }

    @Test func futureBirthDateIsInvalidAndHidesTheGuardian() {
        let future = adult(["birthDate": .date(birth(yearsAgo: -1))])
        #expect(U21Intake.errors(section: personal, answers: future, now: now)["birthDate"] == "תאריך לא תקין")
        let g = U21Intake.fields.first { $0.key == "guardianName" }!
        #expect(!U21Intake.visible(g, answers: future, now: now))
    }

    @Test func eighteenNeedsNoGuardian() {
        let g = U21Intake.fields.first { $0.key == "guardianConsent" }!
        #expect(!U21Intake.visible(g, answers: adult(["birthDate": .date(birth(yearsAgo: 18))]), now: now))
        #expect(!U21Intake.visible(g, answers: [:], now: now))   // no birth date yet → hidden
    }

    @Test func frameworkOtherOnlyUnderOther() {
        let f = U21Intake.fields.first { $0.key == "frameworkOther" }!
        #expect(U21Intake.visible(f, answers: ["framework": .choice("אחר")], now: now))
        #expect(!U21Intake.visible(f, answers: ["framework": .choice("תיכון")], now: now))
    }

    @Test func messagesMatchTheWeb() {
        let e = U21Intake.errors(section: personal, answers: adult(["email": .text("x"), "phone": .text("123")]), now: now)
        #expect(e["email"] == "אימייל לא תקין")
        #expect(e["phone"] == "מספר טלפון לא תקין")
        let km = U21Intake.errors(section: "ניסיון וכושר", answers: adult(["weeklyKm": .text("abc")]), now: now)
        #expect(km["weeklyKm"] == "מספר לא תקין")
        #expect(U21Intake.errors(section: "ניסיון וכושר", answers: adult(["weeklyKm": .text("301")]), now: now)["weeklyKm"] == "מספר לא תקין")
        #expect(U21Intake.errors(section: "ניסיון וכושר", answers: adult(["weeklyKm": .text("30.5")]), now: now)["weeklyKm"] == nil)
        let long = U21Intake.errors(section: "העדפות", answers: adult(["preferences": .text(String(repeating: "א", count: 2001))]), now: now)
        #expect(long["preferences"] == "ארוך מדי")
    }

    @Test func phoneAcceptsDashesAndSpaces() {
        #expect(U21Intake.errors(section: personal, answers: adult(["phone": .text("050 123 4567")]), now: now)["phone"] == nil)
    }

    @Test func blankRequiredTextIsMissing() {
        #expect(U21Intake.errors(section: personal, answers: adult(["firstName": .text("   ")]), now: now)["firstName"] == "שדה חובה")
    }

    @Test func firstSectionWithErrorsPointsAtTheRightStep() {
        var a = adult()
        a.removeValue(forKey: "sleepHours")
        #expect(U21Intake.firstSectionWithErrors(answers: a, now: now) == "שינה והתאוששות")
    }

    @Test func hiddenAnswersAreDropped() {
        var a = adult()
        a["guardianName"] = .text("נשאר מקודם")
        a["frameworkOther"] = .text("נשאר מקודם")
        let v = U21Intake.visibleAnswers(a, now: now)
        #expect(v["guardianName"] == nil)
        #expect(v["frameworkOther"] == nil)
        #expect(v["firstName"] == .text("בדיקה"))
    }

    @Test func redFlagKeysMatchTheWeb() {
        let flagged = Set(U21Intake.fields.filter(\.redFlag).map(\.key))
        #expect(flagged == Set(U21Intake.redFlagKeys.keys))
        #expect(Set(U21Intake.redFlagKeys.values) == ["chest_pain", "fainting", "bone_pain", "acute_injury"])
    }
}

/// Tracks: ids, display names, verbatim copy, and no price anywhere.
struct U21TrackContractTests {
    @Test func namesAndTaglines() {
        #expect(U21Track.allCases.map(\.name) == ["BASIC", "ADVANCED", "PRO"])
        #expect(U21Track.allCases.map(\.tagline) == ["תוכנית שבועית מסודרת", "תוכנית + מעקב ועדכונים", "ליווי אישי צמוד"])
    }

    @Test func benefitsVerbatimAndPriceFree() {
        #expect(U21Track.basic.benefits.count == 4)
        #expect(U21Track.advanced.benefits.count == 5)
        #expect(U21Track.pro.benefits.count == 5)
        #expect(U21Track.allCases.allSatisfy { $0.benefits.last == "הצטרפות לקהילת מדרגות" })
        let all = U21Track.allCases.flatMap { [$0.name, $0.tagline] + $0.benefits }.joined(separator: " ")
        #expect(!all.contains("₪"))
        for price in ["79", "119", "219"] { #expect(!all.contains(price)) }
    }

    @Test func paramAcceptsExactIdsOnly() {
        #expect(U21Track(param: "advanced") == .advanced)
        for bad in ["Advanced", "ADVANCED", "", "gold", " pro", nil] as [String?] { #expect(U21Track(param: bad) == nil) }
    }

    @Test func fixedNotesVerbatim() {
        #expect(U21Intake.noPaymentNote == "בחירת מסלול אינה כרוכה בתשלום בשלב זה.")
        #expect(U21Intake.demoNotice == "מסך זה הוא הדגמה בלבד - הפרטים לא נשלחו ולא נשמרו.")
        #expect(U21Intake.minAge == 16 && U21Intake.maxAge == 21)
    }
}

/// Bidi: numbers and ranges keep their order inside right-to-left review lines.
struct U21BidiTests {
    private let lri = "\u{2066}", pdi = "\u{2069}"

    @Test func rangesAreIsolated() {
        #expect(U21Intake.ltrIsolated("1–3 שנים") == "\(lri)1–3\(pdi) שנים")
        #expect(U21Intake.ltrIsolated("7–8") == "\(lri)7–8\(pdi)")
        #expect(U21Intake.ltrIsolated("5+") == "\(lri)5+\(pdi)")
        #expect(U21Intake.ltrIsolated("פחות מ־6") == "פחות מ־\(lri)6\(pdi)")
        #expect(U21Intake.ltrIsolated("050-1234567") == "\(lri)050-1234567\(pdi)")
        #expect(U21Intake.ltrIsolated("30.5") == "\(lri)30.5\(pdi)")
    }

    @Test func textWithoutDigitsIsUnchanged() {
        #expect(U21Intake.ltrIsolated("שנת שירות") == "שנת שירות")
        #expect(U21Intake.ltrIsolated("") == "")
    }

    @Test func storedOptionsStayRaw() {
        // Isolation is a rendering concern; the contract values are never rewritten.
        guard case .radio(let options) = U21Intake.fields.first(where: { $0.key == "experience" })!.kind else {
            Issue.record("experience is not a radio"); return
        }
        #expect(options.contains("1–3 שנים"))
    }
}
