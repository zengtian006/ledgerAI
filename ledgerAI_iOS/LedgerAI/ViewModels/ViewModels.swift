import Foundation
import Observation
import SwiftUI

@Observable @MainActor
final class HomeViewModel {
    var summary: Monthly?
    var recent: [Receipt] = []
    var insights: Insights?
    var insightsLoading = true
    var refreshingInsights = false
    var scanning = false
    var error: String?
    var review: ReviewSession?

    private let api: APIClient
    let month = Fmt.currentMonth()

    init(api: APIClient = .shared) { self.api = api }

    func load() async {
        do {
            async let monthly = api.monthly(month)
            async let receipts = api.recentReceipts()
            summary = try await monthly
            recent = try await receipts
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
        await loadInsights(force: false)
    }

    func loadInsights(force: Bool) async {
        do {
            insights = try await api.insights(force: force)
        } catch {
            // Insights are optional; keep whatever is already shown
        }
        insightsLoading = false
    }

    func refreshInsights() async {
        refreshingInsights = true
        await loadInsights(force: true)
        refreshingInsights = false
    }

    func scan(image: UIImage, fallbackCurrency: String) async {
        guard let jpeg = ImageCompressor.jpegData(from: image) else { error = "Could not read that photo."; return }
        await scan(jpeg: jpeg, fallbackCurrency: fallbackCurrency)
    }

    func scan(data: Data, fallbackCurrency: String) async {
        guard let jpeg = ImageCompressor.jpegData(from: data) else { error = "Could not read that photo."; return }
        await scan(jpeg: jpeg, fallbackCurrency: fallbackCurrency)
    }

    private func scan(jpeg: Data, fallbackCurrency: String) async {
        scanning = true
        error = nil
        defer { scanning = false }
        do {
            let result = try await api.parseReceipt(jpeg: jpeg)
            review = ReviewSession(
                imageURL: result.imageUrl.flatMap(URL.init(string:)),
                imageKey: result.imageKey,
                imageHash: result.imageHash,
                duplicateOf: result.duplicateOf,
                form: ReceiptForm(draft: result.draft, fallbackCurrency: fallbackCurrency)
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    func open(_ receipt: Receipt) async {
        do {
            let full = try await api.receipt(id: receipt.receiptId)
            review = ReviewSession(receiptId: full.receiptId, imageURL: full.imageUrl.flatMap(URL.init(string:)), form: ReceiptForm(receipt: full))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func saveBudget(_ amount: Double) async {
        do {
            try await api.setBudget(month: month, amount: amount)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

@Observable @MainActor
final class AnalyticsViewModel {
    enum Mode: String, CaseIterable, Identifiable {
        case daily = "Daily", monthly = "Monthly", yearly = "Yearly"
        var id: String { rawValue }
    }

    var mode: Mode = .monthly
    var month = Fmt.currentMonth()
    var year = Calendar.current.component(.year, from: Date())
    /// Changes whenever the visible period changes; the view reloads with `.task(id:)`.
    var reloadKey: String { "\(mode.rawValue)-\(month)-\(year)" }
    var category = ""

    var daily: Daily?
    var monthly: Monthly?
    var recurringExpenses: [RecurringExpense]?
    var recurringError: String?
    var yearly: Yearly?
    var loading = false
    var error: String?
    var review: ReviewSession?
    var shareItem: ShareItem?
    var exporting = false

    private let api: APIClient
    init(api: APIClient = .shared) { self.api = api }

    var canGoForward: Bool {
        mode == .yearly ? year < Calendar.current.component(.year, from: Date()) : month < Fmt.currentMonth()
    }

    func step(_ delta: Int) {
        if mode == .yearly { year += delta } else { month = Fmt.shiftMonth(month, by: delta) }
    }

    func load() async {
        loading = true
        error = nil
        recurringError = nil
        defer { loading = false }
        do {
            switch mode {
            case .daily: daily = try await api.daily(month)
            case .monthly:
                monthly = try await api.monthly(month)
                do {
                    recurringExpenses = try await api.recurringExpenses()
                } catch is CancellationError {
                } catch {
                    recurringError = error.localizedDescription
                }
            case .yearly: yearly = try await api.yearly(year)
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    func open(_ receipt: Receipt) async {
        do {
            let full = try await api.receipt(id: receipt.receiptId)
            review = ReviewSession(receiptId: full.receiptId, imageURL: full.imageUrl.flatMap(URL.init(string:)), form: ReceiptForm(receipt: full))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func export() async {
        exporting = true
        defer { exporting = false }
        let range: (String, String) = mode == .yearly ? ("\(year)-01-01", "\(year)-12-31") : ("\(month)-01", Fmt.monthLastDay(month))
        do {
            let data = try await api.exportCSV(from: range.0, to: range.1, category: category.isEmpty ? nil : category)
            let url = FileManager.default.temporaryDirectory.appending(path: "ledgerai-\(range.0)_\(range.1).csv")
            try data.write(to: url, options: .atomic)
            shareItem = ShareItem(url: url)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

@Observable @MainActor
final class AccountViewModel {
    var profile: Profile?
    var countries: [Country] = []
    var currencies: [String] = []

    var displayName = ""
    var country = ""
    var currency = ""

    var saving = false
    var notice: (text: String, isError: Bool)?
    var exportError: String?
    var shareItem: ShareItem?
    var exporting = false

    private let api: APIClient
    init(api: APIClient = .shared) { self.api = api }

    func load(user: User) async {
        displayName = user.displayName ?? ""
        country = user.country ?? ""
        currency = user.currency
        async let lists = try? api.countries()
        async let loaded = try? api.profile()
        if let lists = await lists { countries = lists.countries; currencies = lists.currencies }
        if let p = await loaded { adopt(p) }
    }

    private func adopt(_ p: Profile) {
        profile = p
        displayName = p.displayName ?? ""
        country = p.country ?? ""
        currency = p.currency
    }

    var isDirty: Bool {
        guard let profile else { return false }
        return displayName != (profile.displayName ?? "") || country != (profile.country ?? "") || currency != profile.currency
    }

    /// Drops unsaved edits when an editor screen is left.
    func discardChanges() {
        notice = nil
        if let profile { adopt(profile) }
    }

    func save() async -> Profile? {
        guard !country.isEmpty else { notice = ("Please choose your country.", true); return nil }
        saving = true
        notice = nil
        defer { saving = false }
        do {
            let updated = try await api.updateProfile(ProfileUpdate(displayName: displayName.trimmed, country: country, currency: currency))
            adopt(updated)
            notice = ("Saved", false)
            return updated
        } catch {
            notice = (error.localizedDescription, true)
            return nil
        }
    }

    func exportAll() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await api.exportCSV()
            let url = FileManager.default.temporaryDirectory.appending(path: "ledgerai-all-receipts.csv")
            try data.write(to: url, options: .atomic)
            shareItem = ShareItem(url: url)
        } catch {
            exportError = error.localizedDescription
        }
    }
}
