import SwiftUI

/// Email → 6-digit code. iOS offers the address from the device and the code from Mail
/// above the keyboard (`.emailAddress` / `.oneTimeCode`), so this is mostly taps.
struct SignInView: View {
    @Environment(SessionStore.self) private var session

    private enum Step: Equatable { case email, code }
    private enum Field: Hashable { case email, code }

    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var errorText: String?
    @State private var info: String?
    @State private var showRegistration = false
    @FocusState private var focus: Field?

    var registrationClient: RegistrationClient = HTTPRegistrationClient(config: .current)

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                header
                switch step {
                case .email: emailStep
                case .code: codeStep
                }
                if let errorText {
                    Text(errorText)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("sign-in-error")
                }
                Spacer()
            }
            .padding(.horizontal, 28)
            .padding(.top, 48)
            .onAppear { focus = .email }
            .navigationDestination(isPresented: $showRegistration) {
                RegistrationView(client: registrationClient) { registeredEmail in
                    email = registeredEmail
                    step = .email
                    errorText = nil
                    showRegistration = false
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "figure.run.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Theme.accent)
            Text("מדרגות").font(.largeTitle.bold())
            Text(step == .email ? "התחברות עם המייל שרשום במועדון" : (info ?? ""))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.bottom, 12)
    }

    private var emailStep: some View {
        VStack(spacing: 12) {
            TextField("כתובת מייל", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .environment(\.layoutDirection, .leftToRight)
                .multilineTextAlignment(.leading)
                .focused($focus, equals: .email)
                .submitLabel(.send)
                .onSubmit(sendCode)
                .padding(14)
                .background(.quaternary, in: .rect(cornerRadius: 12))
                .accessibilityIdentifier("email-field")
            primaryButton("שליחת קוד", action: sendCode)
                .disabled(email.isEmpty)
            Text("נשלח קוד בן 6 ספרות למייל, אם הוא רשום אצלנו.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("חדשים במועדון? הצטרפות") { showRegistration = true }
                .font(.subheadline.bold())
                .padding(.top, 8)
                .accessibilityIdentifier("open-registration")
            #if DEBUG
            Button("מצב הדגמה (פיתוח בלבד)") { session.enterDemo() }
                .font(.footnote)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("demo-mode")
            #endif
        }
    }

    private var codeStep: some View {
        VStack(spacing: 12) {
            TextField("קוד בן 6 ספרות", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(.title2.monospacedDigit())
                .multilineTextAlignment(.center)
                .focused($focus, equals: .code)
                .padding(14)
                .background(.quaternary, in: .rect(cornerRadius: 12))
                .onChange(of: code) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { code = digits }
                    // Autofill drops all six digits at once: verify without an extra tap.
                    if digits.count == 6 { verify() }
                }
                .accessibilityIdentifier("code-field")
            primaryButton("כניסה", action: verify)
                .disabled(code.count != 6)
            HStack {
                Button("שליחה מחדש", action: sendCode)
                Spacer()
                Button("מייל אחר") {
                    step = .email
                    code = ""
                    errorText = nil
                    focus = .email
                }
            }
            .font(.footnote)
            .disabled(busy)
        }
    }

    private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if busy { ProgressView() } else { Text(title).bold() }
            }
            .frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(busy)
    }

    private func sendCode() {
        guard !busy else { return }
        busy = true
        errorText = nil
        Task {
            defer { busy = false }
            do {
                try await session.sendCode(to: email)
                info = "אם \(SessionStore.normalise(email)) רשום אצלנו, נשלח אליו קוד."
                step = .code
                focus = .code
            } catch {
                errorText = (error as? AuthError ?? .server(status: 0)).message
            }
        }
    }

    private func verify() {
        guard !busy, code.count == 6 else { return }
        busy = true
        errorText = nil
        Task {
            defer { busy = false }
            do {
                try await session.verify(code: code, email: email)
            } catch {
                errorText = (error as? AuthError ?? .server(status: 0)).message
                code = ""
            }
        }
    }
}

#Preview {
    SignInView()
        .environment(SessionStore(previewState: .signedOut))
        .environment(\.layoutDirection, .rightToLeft)
}
