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
                        .font(Theme.font(14, .semibold))
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("sign-in-error")
                }
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.top, 56)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
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
        VStack(spacing: 10) {
            ClubMark(size: 76)
            Text("מדרגות").font(Theme.font(30, .black)).foregroundStyle(Theme.ink900)
            Text("מועדון ריצה AFTER 2KM").font(Theme.font(12, .bold)).foregroundStyle(Theme.ink500)
            Text(step == .email ? "כותבים את המייל שאיתו נרשמתם למדרגות, ונשלח אליו קוד של 6 ספרות." : (info ?? ""))
                .font(Theme.font(14))
                .foregroundStyle(Theme.ink500)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
        }
        .padding(.bottom, 8)
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
                .font(Theme.font(16))
                .modifier(BrandFieldStyle())
                .accessibilityIdentifier("email-field")
            primaryButton("שליחת קוד", action: sendCode)
                .disabled(email.isEmpty)
            Button("חדשים במועדון? הצטרפות") { showRegistration = true }
                .font(Theme.font(14, .bold))
                .foregroundStyle(Theme.brand)
                .padding(.top, 8)
                .accessibilityIdentifier("open-registration")
            #if DEBUG || DEMO
            Button("מצב הדגמה") { session.enterDemo() }
                .font(Theme.font(13, .semibold))
                .foregroundStyle(Theme.ink500)
                .accessibilityIdentifier("demo-mode")
            #endif
        }
    }

    private var codeStep: some View {
        VStack(spacing: 12) {
            TextField("קוד בן 6 ספרות", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(Theme.font(28, .black).monospacedDigit())
                .tracking(code.isEmpty ? 0 : 8)   // spaced digits, not a spaced-out Hebrew placeholder
                .multilineTextAlignment(.center)
                .focused($focus, equals: .code)
                .modifier(BrandFieldStyle(height: 60))
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
            .font(Theme.font(14, .bold))
            .foregroundStyle(Theme.brand)
            .disabled(busy)
        }
    }

    private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().tint(.white) } else { Text(title) }
            }
        }
        .buttonStyle(BrandButtonStyle())
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
