import Foundation

// MARK: - Auth, profile

struct User: Codable, Equatable {
    var userId: Int
    var email: String
    var currency: String
    var displayName: String?
    var country: String?
    var isAdmin: Bool?
}

struct MeResponse: Decodable { let user: User }
struct LoginResponse: Decodable { let token: String; let user: User }

struct Profile: Decodable, Equatable {
    var userId: Int
    var email: String
    var displayName: String?
    var country: String?
    var currency: String
    var createdAt: String?
    var receiptCount: Int
}

struct ProfileResponse: Decodable { let profile: Profile }

struct Country: Decodable, Identifiable, Hashable {
    let code: String
    let name: String
    let currency: String
    var id: String { code }

    var flag: String {
        code.uppercased().unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) }.map(String.init).joined()
    }
}

struct CountriesResponse: Decodable {
    let countries: [Country]
    let currencies: [String]
}

// MARK: - Receipts

struct LineItem: Codable, Equatable {
    var itemId: Int?
    var description: String
    var quantity: Double
    var price: Double // negative = discount
}

struct Receipt: Decodable, Identifiable, Equatable {
    var receiptId: Int
    var merchantName: String
    var transactionDate: String
    var currency: String
    var subtotal: Double?
    var taxAmount: Double?
    var totalAmount: Double
    var category: String
    var imageKey: String?
    var imageUrl: String?
    var lineItems: [LineItem]?
    var id: Int { receiptId }
}

struct ReceiptsResponse: Decodable {
    let receipts: [Receipt]
    let count: Int
    let sum: Double
}

struct ReceiptResponse: Decodable { let receipt: Receipt }

struct Draft: Decodable {
    var merchantName: String
    var transactionDate: String?
    var currency: String
    var totalAmount: Double?
    var taxAmount: Double?
    var category: String
    var lineItems: [LineItem]
}

struct ParseResponse: Decodable {
    let imageKey: String
    let imageHash: String
    let imageUrl: String?
    let draft: Draft
    let duplicateOf: Int?
}

struct ReceiptInput: Encodable {
    var merchantName: String
    var transactionDate: String
    var currency: String
    var totalAmount: Double
    var taxAmount: Double?
    var category: String
    var imageKey: String?
    var imageHash: String?
    var lineItems: [LineItem]
}

// MARK: - Analytics

struct CategoryTotal: Decodable, Identifiable, Equatable {
    let category: String
    let total: Double
    let count: Int
    var id: String { category }
}

struct MerchantTotal: Decodable, Identifiable, Equatable {
    let merchantName: String
    let total: Double
    let visits: Int
    var id: String { merchantName }
}

struct Monthly: Decodable, Equatable {
    let month: String
    let currency: String
    let total: Double
    let previousTotal: Double
    let changePct: Int?
    let budget: Double?
    let categories: [CategoryTotal]
    let topMerchants: [MerchantTotal]
}

struct RecurringExpense: Decodable, Identifiable, Equatable {
    let merchantName: String
    let currency: String
    let averageAmount: Double
    let cadence: String
    let occurrenceCount: Int
    let lastCharged: String
    let expectedDate: String
    var id: String { "\(merchantName)-\(currency)-\(cadence)" }
}

struct RecurringExpensesResponse: Decodable { let expenses: [RecurringExpense] }

struct DayGroup: Decodable, Identifiable, Equatable {
    let date: String
    let total: Double
    let receipts: [Receipt]
    var id: String { date }
}

struct Daily: Decodable { let month: String; let days: [DayGroup] }

struct MonthTotal: Decodable, Identifiable, Equatable {
    let month: Int
    let total: Double
    var id: Int { month }
}

struct YearCategory: Decodable, Identifiable, Equatable {
    let category: String
    let total: Double
    let previousTotal: Double
    let changePct: Int?
    var id: String { category }
}

struct Yearly: Decodable, Equatable {
    let year: String
    let currency: String
    let total: Double
    let months: [MonthTotal]
    let categories: [YearCategory]
}

struct BudgetBody: Encodable { let month: String; let amount: Double }
struct BudgetResponse: Decodable { let month: String; let amount: Double }

// MARK: - Insights

struct KeyInsight: Decodable, Identifiable, Equatable {
    let title: String
    let detail: String
    let type: String
    var id: String { title + detail }

    // The AI occasionally omits `detail` or `type` (older cached digests); don't let that hide the whole card
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "tip"
    }

    private enum CodingKeys: String, CodingKey { case title, detail, type }
}

struct Insights: Decodable, Equatable {
    let summaryHeadline: String
    let spendingVelocity: String
    let keyInsights: [KeyInsight]
    let suggestedBudgetAdjustment: String?
}

struct InsightsResponse: Decodable { let insights: Insights? }
struct RefreshBody: Encodable { let force: Bool }

struct ProfileUpdate: Encodable {
    let displayName: String
    let country: String
    let currency: String
}

struct DeleteAccountBody: Encodable { let password: String }
