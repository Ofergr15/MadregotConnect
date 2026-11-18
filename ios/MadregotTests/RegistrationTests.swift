import Foundation
import Testing
@testable import Madregot

struct RegistrationFormTests {
    private func form(name: String = "Noa Levi", email: String = "noa@example.com", phone: String = "") -> RegistrationForm {
        var f = RegistrationForm()
        f.fullName = name
        f.email = email
        f.phone = phone
        return f
    }

    @Test func validFormHasNoProblems() {
        #expect(form().problems.isEmpty)
        #expect(form(phone: "050-123-4567").problems.isEmpty)
    }

    @Test func nameIsRequiredAndLatin() {
        #expect(form(name: "  ").problems == [.nameMissing])
        #expect(form(name: "נועה לוי").problems == [.nameNotLatin])
        #expect(form(name: "Noa לוי").problems == [.nameNotLatin])
        #expect(form(name: "Noa-Lee O'Brien").problems.isEmpty)
    }

    @Test func emailAndPhoneAreChecked() {
        #expect(form(email: "noa@").problems == [.emailInvalid])
        #expect(form(phone: "1234").problems == [.phoneTooShort])
    }

    @Test func bodySendsOnlyWhatTheWebFormSends() {
        var f = form(email: "  Noa@Example.com ")
        #expect(f.body == ["email": "noa@example.com", "fullName": "Noa Levi"])
        f.phone = " 0501234567 "
        f.groupId = "g-2"
        #expect(f.body == ["email": "noa@example.com", "fullName": "Noa Levi",
                           "phone": "0501234567", "groupId": "g-2"])
    }
}

private func json(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }

extension NetworkStubTests {
@Suite struct HTTPRegistrationClientTests {
    let client: HTTPRegistrationClient

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        client = HTTPRegistrationClient(
            config: AppConfig(apiBaseURL: URL(string: "http://localhost:3000")!, supabaseURL: nil, supabaseAnonKey: nil),
            session: URLSession(configuration: configuration)
        )
    }

    private var valid: RegistrationForm {
        var f = RegistrationForm()
        f.fullName = "Noa Levi"
        f.email = "noa@example.com"
        return f
    }

    @Test func groupsAreSortedByBandAndFailuresAreEmpty() async {
        StubURLProtocol.handler = { _ in
            (200, json(["groups": [
                ["id": "c", "name": "Group 3", "index": 2, "marathonGoal": "3:45"],
                ["id": "a", "name": "Group 1", "index": 0, "marathonGoal": ""],
            ]]))
        }
        let groups = await client.groups()
        #expect(groups.map(\.id) == ["a", "c"])
        #expect(groups.first?.title == "קבוצה 1")
        #expect(groups.last?.subtitle == "יעד מרתון 3:45")

        StubURLProtocol.handler = { _ in (500, Data()) }
        #expect(await client.groups().isEmpty)
    }

    @Test func submitMapsTheThreeServerStates() async throws {
        StubURLProtocol.handler = { _ in (200, json(["ok": true, "state": "new"])) }
        #expect(try await client.submit(valid) == .received)
        let request = try #require(StubURLProtocol.requests.last)
        #expect(request.url?.absoluteString == "http://localhost:3000/api/public/signup")

        StubURLProtocol.handler = { _ in (200, json(["ok": true, "state": "pending"])) }
        #expect(try await client.submit(valid) == .alreadyPending)

        StubURLProtocol.handler = { _ in (200, json(["ok": true, "state": "member"])) }
        #expect(try await client.submit(valid) == .alreadyMember)
    }

    @Test func submitErrors() async {
        StubURLProtocol.handler = { _ in (400, json(["error": "invalid-email"])) }
        await #expect(throws: RegistrationError.invalidEmail) { _ = try await client.submit(valid) }
        StubURLProtocol.handler = { _ in (500, json(["error": "failed"])) }
        await #expect(throws: RegistrationError.server) { _ = try await client.submit(valid) }
    }
}
}
