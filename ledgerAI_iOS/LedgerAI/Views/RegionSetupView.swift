import SwiftUI
import Observation

/// Country + currency being chosen (at sign-up, or on the one-time setup screen). The currency follows the country
/// until the user picks one explicitly.
@Observable @MainActor
final class RegionChoice {
    var countries: [Country] = []
    var currencies: [String] = []
    var country = ""
    var currency = ""

    var isComplete: Bool { !country.isEmpty && !currency.isEmpty }

    func load(api: APIClient = .shared) async {
        guard countries.isEmpty, let lists = try? await api.countries() else { return }
        countries = lists.countries
        currencies = lists.currencies
    }

    func pick(country code: String) {
        country = code
        if let match = countries.first(where: { $0.code == code }) { currency = match.currency }
    }
}

/// The two pickers, as rows of an enclosing Form.
struct RegionPickerRows: View {
    @Bindable var choice: RegionChoice

    var body: some View {
        Picker("Country", selection: Binding(get: { choice.country }, set: { choice.pick(country: $0) })) {
            if choice.country.isEmpty { Text("Select…").tag("") }
            ForEach(choice.countries) { Text("\($0.flag)  \($0.name)").tag($0.code) }
        }
        .pickerStyle(.navigationLink)
        Picker("Currency", selection: $choice.currency) {
            if choice.currency.isEmpty { Text("Select…").tag("") }
            ForEach(choice.currencies, id: \.self) { Text($0).tag($0) }
        }
        .pickerStyle(.navigationLink)
    }
}

/// Shown once after sign-in when the account has no country yet (older accounts, or sign-up was interrupted).
struct RegionSetupView: View {
    @Environment(SessionStore.self) private var session
    @State private var choice = RegionChoice()
    @State private var busy = false
    @State private var error: String?
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    RegionPickerRows(choice: choice)
                } header: {
                    Text("Where do you live?")
                } footer: {
                    Text("All your receipts, budgets and reports use this currency. It can’t be changed after you continue.")
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.subheadline) } }
                Section {
                    Button { confirming = true } label: {
                        Group { if busy { ProgressView() } else { Text("Continue").fontWeight(.semibold) } }
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(busy || !choice.isComplete)
                }
                Section {
                    Button("Sign Out", role: .destructive) { Task { await session.signOut() } }
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Set Up Region")
            .navigationBarTitleDisplayMode(.large)
            .task { await choice.load() }
            .confirmationDialog("Use \(choice.currency) as your currency?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Confirm \(choice.currency)") { Task { await save() } }
            } message: {
                Text("You won’t be able to change your country or currency later.")
            }
        }
    }

    private func save() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await session.saveRegion(country: choice.country, currency: choice.currency)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
