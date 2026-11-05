import SwiftUI

struct AuthView: View {
    @Environment(SessionStore.self) private var session

    private enum Mode { case login, register, confirm, forgot, reset }
    private enum Field { case email, code, password }

    @State private var mode: Mode = .login
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var region = RegionChoice()
    @State private var error: String?
    @State private var notice: String?
    @State private var busy = false
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                VStack(spacing: 0) {
                    if mode != .confirm { field("Email") { emailField } }
                    if mode == .confirm || mode == .reset { divider; field("Code") { codeField } }
                    if mode == .login || mode == .register || mode == .reset { divider; field(mode == .reset ? "New password" : "Password") { passwordField } }
                }
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                if mode == .register {
                    VStack(spacing: 0) {
                        field("Country") { regionMenu(selection: Binding(get: { region.country }, set: { region.pick(country: $0) })) {
                            ForEach(region.countries) { Text("\($0.flag)  \($0.name)").tag($0.code) }
                        } }
                        divider
                        field("Currency") { regionMenu(selection: $region.currency) {
                            ForEach(region.currencies, id: \.self) { Text($0).tag($0) }
                        } }
                    }
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .task { await region.load() }
                }

                VStack(alignment: .leading, spacing: 8) {
                    if mode == .register { Text("Your country sets your currency for all receipts and reports. It can’t be changed after you sign up.").foregroundStyle(.secondary) }
                    if mode == .register || mode == .reset { Text(AppConfig.passwordHint).foregroundStyle(.secondary) }
                    if let notice { Text(notice).foregroundStyle(.secondary) }
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)

                Button(action: submit) {
                    Group { if busy { ProgressView().tint(.white) } else { Text(submitTitle).fontWeight(.semibold) } }
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy || !canSubmit)

                VStack(spacing: 14) {
                    if mode == .confirm { Button("Resend code") { Task { await resend() } } }
                    if mode == .login && AppConfig.usesCognito { Button("Forgot password?") { go(.forgot) } }
                    if mode == .login { Button("New here? Create Account") { go(.register) } }
                    if mode != .login { Button("Back to Sign In") { go(.login) } }
                }
                .font(.subheadline)
            }
            .padding(20)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: Pieces

    private var header: some View {
        VStack(spacing: 8) {
            Image("AppIcon-Preview")
                .resizable().scaledToFit().frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: .green.opacity(0.25), radius: 12, y: 6)
            Text("LedgerAI").font(.system(size: 28, weight: .bold))
            Text("Snap receipts. Understand your spending.").font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.top, 40)
    }

    private var divider: some View { Divider().padding(.leading, 16) }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(title).frame(width: 112, alignment: .leading)
            content()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private func regionMenu<Options: View>(selection: Binding<String>, @ViewBuilder options: () -> Options) -> some View {
        Picker("", selection: selection) {
            if selection.wrappedValue.isEmpty { Text("Select…").tag("") }
            options()
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, -12) // menu pickers carry their own leading inset; line up with the text fields above
    }

    private var emailField: some View {
        // Not "name@example.com": iOS draws a placeholder that looks like an email address in the blue link colour
        TextField("Your email", text: $email)
            .textContentType(.emailAddress).keyboardType(.emailAddress)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .focused($focus, equals: .email)
            .submitLabel(.next).onSubmit { focus = mode == .forgot ? nil : .password }
    }

    private var codeField: some View {
        TextField("6-digit code", text: $code)
            .textContentType(.oneTimeCode).keyboardType(.numberPad)
            .focused($focus, equals: .code)
    }

    private var passwordField: some View {
        SecureField("Required", text: $password)
            .textContentType(mode == .login ? .password : .newPassword)
            .focused($focus, equals: .password)
            .submitLabel(.go).onSubmit(submit)
    }

    private var submitTitle: String {
        switch mode {
        case .login: return "Sign In"
        case .register: return "Create Account"
        case .confirm: return "Verify"
        case .forgot: return "Send Code"
        case .reset: return "Update Password"
        }
    }

    private var canSubmit: Bool {
        switch mode {
        case .login: return !email.trimmed.isEmpty && !password.isEmpty
        case .register: return !email.trimmed.isEmpty && password.count >= 8 && region.isComplete
        case .confirm: return !code.trimmed.isEmpty
        case .forgot: return !email.trimmed.isEmpty
        case .reset: return !email.trimmed.isEmpty && !code.trimmed.isEmpty && password.count >= 8
        }
    }

    // MARK: Actions

    private func go(_ next: Mode, message: String? = nil) {
        mode = next
        error = nil
        notice = message
        code = ""
    }

    private func submit() {
        guard !busy, canSubmit else { return }
        focus = nil
        Task { await perform() }
    }

    private func perform() async {
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            switch mode {
            case .login:
                do {
                    try await session.signIn(email: email, password: password)
                } catch let e as AuthError where e.code == "UserNotConfirmedException" {
                    try await session.auth.resendCode(email: email)
                    go(.confirm, message: "Your email isn’t verified yet. We sent a new code to \(email).")
                }
            case .register:
                if try await session.signUp(email: email, password: password, region: region) == false {
                    go(.confirm, message: "We sent a 6-digit code to \(email.trimmed).")
                }
            case .confirm:
                try await session.confirm(email: email, code: code, password: password)
            case .forgot:
                try await session.auth.forgotPassword(email: email)
                go(.reset, message: "If \(email.trimmed) has an account, we sent a code to it.")
            case .reset:
                try await session.auth.resetPassword(email: email, code: code, newPassword: password)
                password = ""
                go(.login, message: "Password updated. Sign in with your new password.")
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func resend() async {
        error = nil
        do {
            try await session.auth.resendCode(email: email)
            notice = "We sent a new code to \(email.trimmed)."
        } catch {
            self.error = error.localizedDescription
        }
    }
}
