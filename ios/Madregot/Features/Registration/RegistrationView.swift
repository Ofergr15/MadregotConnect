import SwiftUI

/// "New to the club" — the same request the web /register page sends: name, email,
/// optional phone, preferred pace group. The coach approves it; the approval mail is
/// what lets them sign in. Everything else (birth date, sizes, watch) is asked later.
struct RegistrationView: View {
    let client: RegistrationClient
    /// Back to sign-in, with the address filled in (for "already a member").
    let onSignIn: (String) -> Void

    @State private var form = RegistrationForm()
    @State private var groups: [PaceGroup] = []
    @State private var showProblems = false
    @State private var busy = false
    @State private var errorText: String?
    @State private var outcome: RegistrationOutcome?

    var body: some View {
        Group {
            if let outcome {
                RegistrationResultView(outcome: outcome, email: SessionStore.normalise(form.email)) {
                    onSignIn(SessionStore.normalise(form.email))
                }
            } else {
                formView
            }
        }
        .brandList("הצטרפות למועדון")
        .task { groups = await client.groups() }
    }

    private var formView: some View {
        Form {
            Section {
                TextField("שם מלא באנגלית", text: $form.fullName)
                    .textContentType(.name)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("reg-name")
                if let hint = nameHint {
                    Text(hint).font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
                }
            } header: {
                BrandSectionHeader("שם מלא")
            } footer: {
                Text("כך השם יופיע בשעון וב-Strava, ולפיו המאמן מוצא אתכם.")
                    .font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
            }

            Section {
                TextField("המייל שלכם", text: $form.email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .environment(\.layoutDirection, .leftToRight)
                    .accessibilityIdentifier("reg-email")
                if showProblems && form.problems.contains(.emailInvalid) {
                    Text("כתובת המייל לא נראית תקינה.").font(Theme.font(13, .regular)).foregroundStyle(Theme.danger)
                }
            } header: {
                BrandSectionHeader("מייל")
            }

            Section {
                TextField("טלפון", text: $form.phone)
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .environment(\.layoutDirection, .leftToRight)
                if showProblems && form.problems.contains(.phoneTooShort) {
                    Text("מספר הטלפון קצר מדי.").font(Theme.font(13, .regular)).foregroundStyle(.red)
                }
            } header: {
                BrandSectionHeader("טלפון (לא חובה)")
            } footer: {
                Text("למקרה שנצטרך לחזור אליכם.")
                    .font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
            }

            Section {
                ForEach(groups) { group in
                    groupRow(id: group.id, title: group.title, subtitle: group.subtitle)
                }
                groupRow(id: nil, title: "לא בטוחים?", subtitle: "המאמן יחליט")
            } header: {
                BrandSectionHeader("קבוצת קצב מועדפת")
            }

            Section {
                Button {
                    submit()
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("שליחת הבקשה") }
                }
                .buttonStyle(BrandButtonStyle())
                .disabled(busy)
                .accessibilityIdentifier("reg-submit")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                if let errorText {
                    Text(errorText).font(Theme.font(13, .bold)).foregroundStyle(Theme.danger)
                        .listRowBackground(Color.clear)
                }
            } footer: {
                Text("בחינם · בלי סיסמה · מאשרים בדרך כלל תוך יום")
                    .font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var nameHint: String? {
        let problems = form.problems
        if problems.contains(.nameNotLatin) { return "באותיות באנגלית, בבקשה. למשל Noa Levi" }
        if showProblems && problems.contains(.nameMissing) { return "איך קוראים לכם?" }
        return nil
    }

    private func groupRow(id: String?, title: String, subtitle: String?) -> some View {
        Button {
            form.groupId = id
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.font(16, .bold)).foregroundStyle(Theme.ink900)
                    if let subtitle { Text(subtitle).font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500) }
                }
                Spacer()
                Image(systemName: form.groupId == id ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22)).foregroundStyle(form.groupId == id ? Theme.brand : Theme.ink300)
            }
        }
    }

    private func submit() {
        showProblems = true
        errorText = nil
        guard form.problems.isEmpty, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                outcome = try await client.submit(form)
            } catch {
                errorText = (error as? RegistrationError ?? .server).message
            }
        }
    }
}

struct RegistrationResultView: View {
    let outcome: RegistrationOutcome
    let email: String
    let onSignIn: () -> Void

    var body: some View {
        BrandEmptyState(
            icon: outcome == .alreadyMember ? "person.crop.circle.badge.checkmark" : "hourglass",
            title: title, message: message,
            actionTitle: outcome == .alreadyMember ? "להתחברות" : nil,
            action: outcome == .alreadyMember ? onSignIn : nil)
            .background(Theme.page)
    }

    private var title: String {
        switch outcome {
        case .received: "הבקשה התקבלה"
        case .alreadyPending: "הבקשה כבר אצלנו"
        case .alreadyMember: "את/ה כבר רשום/ה"
        }
    }

    private var message: String {
        switch outcome {
        case .received, .alreadyPending:
            "ההרשמה ממתינה לאישור המאמן. כשתאושר, יגיע מייל ל-\(email) ותוכלו להתחבר עם קוד."
        case .alreadyMember:
            "\(email) כבר רשום במועדון. אין צורך להירשם שוב, פשוט מתחברים."
        }
    }
}
