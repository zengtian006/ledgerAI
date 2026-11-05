import Foundation

struct LineItemForm: Identifiable, Equatable {
    var id = UUID()
    var description = ""
    var quantity = "1"
    var price = "0"
}

/// Editable text/Date form state for the review sheet.
struct ReceiptForm: Equatable {
    var merchant = ""
    var date = Date()
    var currency = "GBP"
    var total = ""
    var tax = ""
    var category = "Other"
    var items: [LineItemForm] = []

    init(currency: String) { self.currency = currency }

    init(draft: Draft, fallbackCurrency: String) {
        merchant = draft.merchantName
        date = draft.transactionDate.flatMap(Fmt.date(from:)) ?? Date()
        currency = draft.currency.isEmpty ? fallbackCurrency : draft.currency
        total = draft.totalAmount.map(Fmt.plain) ?? ""
        tax = draft.taxAmount.map(Fmt.plain) ?? ""
        category = Category.all.contains(draft.category) ? draft.category : "Other"
        items = draft.lineItems.map(Self.item)
    }

    init(receipt: Receipt) {
        merchant = receipt.merchantName
        date = Fmt.date(from: receipt.transactionDate) ?? Date()
        currency = receipt.currency
        total = Fmt.plain(receipt.totalAmount)
        tax = receipt.taxAmount.map(Fmt.plain) ?? ""
        category = receipt.category
        items = (receipt.lineItems ?? []).map(Self.item)
    }

    private static func item(_ i: LineItem) -> LineItemForm {
        LineItemForm(description: i.description, quantity: Fmt.plain(i.quantity), price: Fmt.plain(i.price))
    }

    enum Invalid: LocalizedError {
        case merchant, total
        var errorDescription: String? {
            switch self {
            case .merchant: return "Enter the merchant name."
            case .total: return "Total must be a number, 0 or more."
            }
        }
    }

    func input(imageKey: String?, imageHash: String?) throws -> ReceiptInput {
        guard !merchant.trimmed.isEmpty else { throw Invalid.merchant }
        guard let totalValue = Fmt.number(total), totalValue >= 0 else { throw Invalid.total }
        return ReceiptInput(
            merchantName: merchant.trimmed,
            transactionDate: Fmt.iso(from: date),
            currency: currency.trimmed.uppercased(),
            totalAmount: totalValue,
            taxAmount: Fmt.number(tax),
            category: category,
            imageKey: imageKey,
            imageHash: imageHash,
            lineItems: items
                .filter { !$0.description.trimmed.isEmpty }
                .map { LineItem(itemId: nil, description: $0.description.trimmed, quantity: Fmt.number($0.quantity) ?? 1, price: Fmt.number($0.price) ?? 0) }
        )
    }
}

/// What the review sheet is showing: a freshly scanned draft, or an existing receipt being edited.
struct ReviewSession: Identifiable {
    let id = UUID()
    var receiptId: Int?
    var imageURL: URL?
    var imageKey: String?
    var imageHash: String?
    var duplicateOf: Int?
    var form: ReceiptForm

    var isEditing: Bool { receiptId != nil }
}
