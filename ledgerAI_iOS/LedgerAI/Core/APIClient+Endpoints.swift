import Foundation

/// Every endpoint the app uses, mirroring web/src/api.js.
extension APIClient {
    func countries() async throws -> CountriesResponse { try await get("/countries") }
    func profile() async throws -> Profile { (try await get("/profile") as ProfileResponse).profile }

    func updateProfile(_ update: ProfileUpdate) async throws -> Profile {
        (try await put("/profile", body: update) as ProfileResponse).profile
    }

    func monthly(_ month: String) async throws -> Monthly { try await get("/monthly", query: ["month": month]) }
    func recurringExpenses() async throws -> [RecurringExpense] {
        (try await get("/recurring") as RecurringExpensesResponse).expenses
    }
    func daily(_ month: String) async throws -> Daily { try await get("/daily", query: ["month": month]) }
    func yearly(_ year: Int) async throws -> Yearly { try await get("/yearly", query: ["year": String(year)]) }

    func setBudget(month: String, amount: Double) async throws {
        let _: BudgetResponse = try await put("/budget", body: BudgetBody(month: month, amount: amount))
    }

    func insights(force: Bool) async throws -> Insights? {
        (try await post("/insights/refresh", body: RefreshBody(force: force)) as InsightsResponse).insights
    }

    func recentReceipts(limit: Int = 10) async throws -> [Receipt] {
        (try await get("/receipts", query: ["limit": String(limit)]) as ReceiptsResponse).receipts
    }

    func receipt(id: Int) async throws -> Receipt { (try await get("/receipts/\(id)") as ReceiptResponse).receipt }
    func parseReceipt(jpeg: Data) async throws -> ParseResponse { try await upload("/receipts/parse", imageData: jpeg) }
    func saveReceipt(_ input: ReceiptInput) async throws { let _: ReceiptResponse = try await post("/receipts", body: input) }
    func updateReceipt(id: Int, _ input: ReceiptInput) async throws { let _: ReceiptResponse = try await put("/receipts/\(id)", body: input) }
    func deleteReceipt(id: Int) async throws { try await delete("/receipts/\(id)") }

    /// Removes an uploaded image when the user cancels the review sheet (best effort).
    func discardImage(key: String) async { try? await delete("/receipts/draft-image", query: ["key": key]) }

    func exportCSV(from: String? = nil, to: String? = nil, category: String? = nil) async throws -> Data {
        try await download("/receipts/export.csv", query: ["from": from, "to": to, "category": category])
    }
}
