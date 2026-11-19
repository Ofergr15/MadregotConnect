import Foundation
import Testing
@testable import Madregot

struct U21IntakeTests {
    private let now = ISO8601DateFormatter().date(from: "2026-11-19T10:00:00Z")!
    private func birth(yearsAgo: Int) -> Date { Calendar(identifier: .gregorian).date(byAdding: .year, value: -yearsAgo, to: now)! }

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
        #expect(tooOld["birthDate"] == "התוכנית מיועדת לגילאי 16–21")
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
