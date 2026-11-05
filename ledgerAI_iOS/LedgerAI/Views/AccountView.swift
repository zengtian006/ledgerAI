import SwiftUI

struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppLock.self) private var lock
    @State private var vm = AccountViewModel()
    @State private var toggleReset = 0
    @State private var showDelete = false
    @State private var showChangePassword = false
    @State private var showSignOutConfirm = false

    private var user: User? { session.user }

    var body: some View {
        NavigationStack {
            List {
                headerSection
                accountSection
                securitySection
                dataSection

                Section {
                    Button("Sign Out", role: .destructive) { showSignOutConfirm = true }
                        .frame(maxWidth: .infinity)
                } footer: {
                    VStack(spacing: 14) {
                        Button("Delete Account…", role: .destructive) { showDelete = true }
                            .font(.footnote)
                        Text("Receipts are processed with Google Gemini.")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 20)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Account")
            .scrollDismissesKeyboard(.interactively)
            .task(id: user?.userId) { if let user { await vm.load(user: user) } }
        }
        .sheet(item: $vm.shareItem) { ShareSheet(items: [$0.url]).presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showChangePassword) { ChangePasswordView() }
        .sheet(isPresented: $showDelete) { DeleteAccountView() }
        .confirmationDialog("Sign out of LedgerAI?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { Task { await session.signOut() } }
        }
        .alert("Export Failed", isPresented: Binding(get: { vm.exportError != nil }, set: { if !$0 { vm.exportError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.exportError ?? "")
        }
    }

    // MARK: Sections

    private var headerSection: some View {
        Section {
            VStack(spacing: 6) {
                let name = vm.displayName.trimmed
                Text(String((name.isEmpty ? (user?.email ?? "?") : name).prefix(1)).uppercased())
                    .font(.system(size: 36, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                    .frame(width: 84, height: 84)
                    .background(LinearGradient(colors: [Color.accentColor.opacity(0.75), Color.accentColor], startPoint: .top, endPoint: .bottom), in: Circle())
                    .padding(.bottom, 6)
                    .accessibilityHidden(true)
                Text(name.isEmpty ? "Your Name" : name)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(name.isEmpty ? .secondary : .primary)
                Text(user?.email ?? "").font(.subheadline).foregroundStyle(.secondary)
                if let stats = stats {
                    HStack(spacing: 0) {
                        ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
                            if index > 0 { Divider().frame(height: 28) }
                            VStack(spacing: 2) {
                                Text(stat.value).font(.headline).monospacedDigit().minimumScaleFactor(0.8).lineLimit(1)
                                Text(stat.label).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.vertical, 12)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.top, 14)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
    }

    private var accountSection: some View {
        Section {
            NavigationLink {
                PersonalInfoView(vm: vm)
            } label: {
                LabeledContent {
                    Text(vm.displayName.trimmed).lineLimit(1)
                } label: {
                    IconLabel("Personal Information", symbol: "person.text.rectangle.fill", color: .blue)
                }
            }
            LabeledContent {
                HStack(spacing: 6) {
                    Text(regionSummary).lineLimit(1)
                    Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.tertiary)
                }
            } label: {
                IconLabel("Region", symbol: "globe", color: .green)
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint("Set when you signed up and can’t be changed")
        } footer: {
            Text("Your country and currency were set when you signed up and can’t be changed.")
        }
    }

    private var securitySection: some View {
        Section {
            if session.auth.supportsPasswordReset {
                Button { showChangePassword = true } label: {
                    NavigationRowLabel { IconLabel("Change Password", symbol: "key.fill", color: .gray) }
                }
            }
            Toggle(isOn: Binding(
                get: { lock.isEnabled },
                set: { on in Task { await lock.setEnabled(on); toggleReset += 1 } } // re-create the switch so it snaps back if auth was cancelled
            )) {
                IconLabel(lock.name, symbol: lock.kind.symbol, color: .green)
            }
            .id(toggleReset)
            .disabled(lock.isAuthenticating || (!lock.isEnabled && !lock.availability.canAuthenticate))
            .accessibilityIdentifier("applock-toggle")
        } header: {
            Text("Security")
        } footer: {
            if let message = lock.message {
                Text(message).foregroundStyle(.red)
            } else if !lock.availability.canAuthenticate {
                Text(lock.availability.unavailableReason ?? "")
            } else {
                Text("Require \(lock.name) to open LedgerAI. It locks again when you leave the app for more than \(Int(AppLock.gracePeriod)) seconds. Your passcode works as a fallback.")
            }
        }
        .task { lock.refreshAvailability() }
    }

    private var dataSection: some View {
        Section("Data") {
            Button { Task { await vm.exportAll() } } label: {
                HStack {
                    IconLabel("Export All Receipts", symbol: "square.and.arrow.up.fill", color: .orange)
                    Spacer()
                    if vm.exporting { ProgressView() } else { Text("CSV").foregroundStyle(.secondary) }
                }
            }
            .foregroundStyle(.primary)
            .disabled(vm.exporting)
        }
    }

    // MARK: Helpers

    private var stats: [(value: String, label: String)]? {
        var items: [(value: String, label: String)] = []
        if let count = vm.profile?.receiptCount { items.append(("\(count)", count == 1 ? "Receipt" : "Receipts")) }
        if let since = Fmt.memberSince(vm.profile?.createdAt, abbreviated: true) { items.append((since, "Member since")) }
        return items.isEmpty ? nil : items
    }

    private var regionSummary: String {
        guard let match = vm.countries.first(where: { $0.code == vm.country }) else { return vm.country.isEmpty ? "Not set" : vm.currency }
        return "\(match.flag) \(vm.currency)"
    }
}

// MARK: - Shared row components

/// Settings-style row label: white glyph on a rounded colored tile.
private struct IconLabel: View {
    let title: String
    let symbol: String
    let color: Color

    init(_ title: String, symbol: String, color: Color) {
        self.title = title; self.symbol = symbol; self.color = color
    }

    var body: some View {
        Label {
            Text(title).foregroundStyle(.primary)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 29, height: 29)
                .background(color.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
    }
}

/// Trailing chevron for button rows that open a sheet rather than push.
private struct NavigationRowLabel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack {
            content
            Spacer()
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Editors

/// Shared chrome for the pushed editors: Save in the toolbar, unsaved edits dropped on exit.
private struct ProfileEditor<Content: View>: View {
    let title: String
    @Bindable var vm: AccountViewModel
    @ViewBuilder let content: Content
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            content
            if let notice = vm.notice, notice.isError {
                Section { Text(notice.text).foregroundStyle(.red).font(.subheadline) }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if vm.saving { ProgressView() } else {
                    Button("Save") { Task { await save() } }.fontWeight(.semibold).disabled(!vm.isDirty)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .onDisappear { vm.discardChanges() }
    }

    private func save() async {
        if let updated = await vm.save() {
            session.apply(profile: updated)
            dismiss()
        }
    }
}

private struct PersonalInfoView: View {
    @Bindable var vm: AccountViewModel
    @Environment(SessionStore.self) private var session

    var body: some View {
        ProfileEditor(title: "Personal Information", vm: vm) {
            Section {
                LabeledContent("Name") {
                    TextField("Optional", text: $vm.displayName)
                        .multilineTextAlignment(.trailing)
                        .textContentType(.name)
                }
                LabeledContent("Email") {
                    Text(session.user?.email ?? "").foregroundStyle(.secondary)
                }
            } footer: {
                Text("Your email is used to sign in and can’t be changed here.")
            }
        }
    }
}

struct ChangePasswordView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Current password", text: $current).textContentType(.password)
                    SecureField("New password", text: $new).textContentType(.newPassword)
                } footer: {
                    Text(AppConfig.passwordHint)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Update") { Task { await update() } }.disabled(current.isEmpty || new.count < 8).fontWeight(.semibold)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func update() async {
        busy = true
        defer { busy = false }
        do {
            try await session.auth.changePassword(old: current, new: new)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DeleteAccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password).textContentType(.password)
                } footer: {
                    Text("This deletes your account, all receipts and their images. It can’t be undone.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button("Delete Account Permanently", role: .destructive) { Task { await delete() } }
                        .disabled(password.isEmpty || busy)
                }
            }
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private func delete() async {
        busy = true
        defer { busy = false }
        do {
            try await session.deleteAccount(password: password)
            lock.forget()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
