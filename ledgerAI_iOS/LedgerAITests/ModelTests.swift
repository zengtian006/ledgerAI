import XCTest
@testable import LedgerAI

final class ModelTests: XCTestCase {
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func testDecodesParseResponseWithNullsAndDiscount() throws {
        let json = """
        {"image_key":"receipts/1/a.jpg","image_hash":"abc","image_url":"https://x/y.jpg","duplicate_of":null,
         "draft":{"merchant_name":"Tesco","transaction_date":null,"currency":"GBP","total_amount":null,"tax_amount":2.5,
                  "category":"Groceries","line_items":[{"description":"Milk","quantity":2,"price":3.2},{"description":"Coupon","quantity":1,"price":-1.5}]}}
        """
        let parsed = try decoder.decode(ParseResponse.self, from: Data(json.utf8))
        XCTAssertEqual(parsed.imageKey, "receipts/1/a.jpg")
        XCTAssertNil(parsed.duplicateOf)
        XCTAssertNil(parsed.draft.totalAmount)
        XCTAssertEqual(parsed.draft.lineItems.last?.price, -1.5)
    }

    func testDecodesMonthlyWithoutBudgetOrChange() throws {
        let json = """
        {"month":"2026-11","currency":"USD","total":57.95,"previous_total":0,"change_pct":null,"budget":null,
         "categories":[{"category":"Dining","total":8.45,"count":1}],
         "top_merchants":[{"merchant_name":"Pret","total":8.45,"visits":1}]}
        """
        let monthly = try decoder.decode(Monthly.self, from: Data(json.utf8))
        XCTAssertNil(monthly.changePct)
        XCTAssertNil(monthly.budget)
        XCTAssertEqual(monthly.topMerchants.first?.merchantName, "Pret")
    }

    func testDecodesReceiptDetail() throws {
        let json = """
        {"receipt_id":7,"merchant_name":"Corner Cafe","transaction_date":"2026-11-01","currency":"GBP","subtotal":null,
         "tax_amount":null,"total_amount":20,"category":"Dining","status":"verified","image_key":null,"image_url":null,
         "line_items":[{"item_id":1,"description":"Latte","quantity":1,"price":3.5}]}
        """
        let receipt = try decoder.decode(Receipt.self, from: Data(json.utf8))
        XCTAssertEqual(receipt.receiptId, 7)
        XCTAssertEqual(receipt.lineItems?.count, 1)
        XCTAssertNil(receipt.taxAmount)
    }

    func testInsightsDecode() throws {
        let json = """
        {"insights":{"summary_headline":"On pace","spending_velocity":"high_alert","key_insights":[{"title":"Dup","detail":"x","type":"anomaly"}]}}
        """
        let response = try decoder.decode(InsightsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.insights?.keyInsights.count, 1)
        XCTAssertNil(response.insights?.suggestedBudgetAdjustment)
    }

    func testInsightItemMissingDetailStillDecodes() throws {
        let json = #"{"insights":{"summary_headline":"h","spending_velocity":"normal","key_insights":[{"title":"Only a title"}]}}"#
        let response = try decoder.decode(InsightsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.insights?.keyInsights.first?.detail, "")
        XCTAssertEqual(response.insights?.keyInsights.first?.type, "tip")
    }

    func testCountryFlag() {
        XCTAssertEqual(Country(code: "JP", name: "Japan", currency: "JPY").flag, "🇯🇵")
    }
}

final class FormattingTests: XCTestCase {
    func testShiftMonthAcrossYears() {
        XCTAssertEqual(Fmt.shiftMonth("2026-01", by: -1), "2025-12")
        XCTAssertEqual(Fmt.shiftMonth("2026-12", by: 1), "2027-01")
    }

    func testMonthLastDay() {
        XCTAssertEqual(Fmt.monthLastDay("2026-02"), "2026-02-28")
        XCTAssertEqual(Fmt.monthLastDay("2028-02"), "2028-02-29")
        XCTAssertEqual(Fmt.monthLastDay("2026-11"), "2026-11-30")
    }

    func testNumberParsing() {
        XCTAssertEqual(Fmt.number("12,50"), 12.5)
        XCTAssertEqual(Fmt.number(" -2 "), -2)
        XCTAssertNil(Fmt.number(""))
        XCTAssertNil(Fmt.number("abc"))
    }

    func testPlainNumbers() {
        XCTAssertEqual(Fmt.plain(3), "3")
        XCTAssertEqual(Fmt.plain(2.5), "2.5")
    }

    func testIsoRoundTrip() {
        let date = Fmt.date(from: "2026-11-03")
        XCTAssertNotNil(date)
        XCTAssertEqual(Fmt.iso(from: date!), "2026-11-03")
    }
}

final class ReceiptFormTests: XCTestCase {
    private func draft(total: Double? = 12.5) -> Draft {
        Draft(merchantName: "Tesco", transactionDate: "2026-11-03", currency: "GBP", totalAmount: total, taxAmount: nil,
              category: "Groceries", lineItems: [LineItem(itemId: nil, description: "Coupon", quantity: 1, price: -2)])
    }

    func testBuildsInputKeepingNegativeDiscountPrice() throws {
        let form = ReceiptForm(draft: draft(), fallbackCurrency: "GBP")
        let input = try form.input(imageKey: "k", imageHash: "h")
        XCTAssertEqual(input.totalAmount, 12.5)
        XCTAssertEqual(input.transactionDate, "2026-11-03")
        XCTAssertEqual(input.lineItems.first?.price, -2)
        XCTAssertNil(input.taxAmount)
    }

    func testRejectsNegativeOrMissingTotal() {
        var form = ReceiptForm(draft: draft(), fallbackCurrency: "GBP")
        form.total = "-1"
        XCTAssertThrowsError(try form.input(imageKey: nil, imageHash: nil))
        form.total = ""
        XCTAssertThrowsError(try form.input(imageKey: nil, imageHash: nil))
    }

    func testRejectsEmptyMerchantAndDropsBlankItems() throws {
        var form = ReceiptForm(draft: draft(), fallbackCurrency: "GBP")
        form.items.append(LineItemForm())
        XCTAssertEqual(try form.input(imageKey: nil, imageHash: nil).lineItems.count, 1)
        form.merchant = "  "
        XCTAssertThrowsError(try form.input(imageKey: nil, imageHash: nil))
    }

    func testUnknownCategoryFallsBackToOther() {
        var d = draft()
        d.category = "Mystery"
        XCTAssertEqual(ReceiptForm(draft: d, fallbackCurrency: "GBP").category, "Other")
    }

    func testEncodesSnakeCaseForAPI() throws {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let form = ReceiptForm(draft: draft(), fallbackCurrency: "GBP")
        let data = try encoder.encode(try form.input(imageKey: "k", imageHash: nil))
        let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertNotNil(object["merchant_name"])
        XCTAssertNotNil(object["line_items"])
        XCTAssertNotNil(object["image_key"])
        XCTAssertNil(object["image_hash"]) // nil values are omitted, matching the web client
    }
}
