import Foundation

/// Money and date helpers. Dates from the API are plain "YYYY-MM-DD" / "YYYY-MM" strings (local calendar days).
enum Fmt {
    static func money(_ amount: Double, _ currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.locale = .current
        return f.string(from: NSNumber(value: amount)) ?? "\(currency) \(String(format: "%.2f", amount))"
    }

    private static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func date(from iso: String) -> Date? { isoDay.date(from: iso) }
    static func iso(from date: Date) -> String { isoDay.string(from: date) }
    static func todayISO() -> String { iso(from: Date()) }

    static func currentMonth() -> String { String(todayISO().prefix(7)) }

    static func shiftMonth(_ month: String, by delta: Int) -> String {
        guard let start = date(from: month + "-01"),
              let moved = Calendar.current.date(byAdding: .month, value: delta, to: start) else { return month }
        return String(iso(from: moved).prefix(7))
    }

    static func monthLabel(_ month: String) -> String {
        guard let d = date(from: month + "-01") else { return month }
        return d.formatted(.dateTime.month(.wide).year())
    }

    static func dayLabel(_ iso: String) -> String {
        guard let d = date(from: iso) else { return iso }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func monthLastDay(_ month: String) -> String {
        guard let start = date(from: month + "-01"),
              let range = Calendar.current.range(of: .day, in: .month, for: start) else { return month + "-28" }
        return "\(month)-\(String(format: "%02d", range.count))"
    }

    static func memberSince(_ isoTimestamp: String?, abbreviated: Bool = false) -> String? {
        guard let isoTimestamp, let d = ISO8601DateFormatter().date(from: isoTimestamp) ?? ISO8601DateFormatter.withFraction.date(from: isoTimestamp) else { return nil }
        return abbreviated ? d.formatted(.dateTime.month(.abbreviated).year()) : d.formatted(.dateTime.month(.wide).year())
    }

    /// Parses user-typed decimals, accepting both "12.50" and "12,50".
    static func number(_ text: String) -> Double? {
        let cleaned = text.trimmed.replacingOccurrences(of: ",", with: ".")
        return cleaned.isEmpty ? nil : Double(cleaned)
    }

    static func plain(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
