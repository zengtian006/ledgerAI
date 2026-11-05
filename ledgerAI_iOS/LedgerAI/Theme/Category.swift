import SwiftUI

/// The seven receipt categories, with the same colours as the web app, rendered as Settings-style icon tiles.
enum Category {
    static let all = ["Groceries", "Dining", "Transport", "Utilities", "Entertainment", "Shopping", "Other"]

    static func color(_ name: String) -> Color {
        switch name {
        case "Groceries": return Color(red: 0.204, green: 0.78, blue: 0.349)
        case "Dining": return Color(red: 1.0, green: 0.584, blue: 0.0)
        case "Transport": return Color(red: 0.0, green: 0.478, blue: 1.0)
        case "Utilities": return Color(red: 1.0, green: 0.8, blue: 0.0)
        case "Entertainment": return Color(red: 0.686, green: 0.322, blue: 0.871)
        case "Shopping": return Color(red: 1.0, green: 0.176, blue: 0.333)
        default: return Color(red: 0.557, green: 0.557, blue: 0.576)
        }
    }

    static func symbol(_ name: String) -> String {
        switch name {
        case "Groceries": return "cart.fill"
        case "Dining": return "fork.knife"
        case "Transport": return "bus.fill"
        case "Utilities": return "bolt.fill"
        case "Entertainment": return "film.fill"
        case "Shopping": return "bag.fill"
        default: return "doc.text.fill"
        }
    }
}

struct CategoryIcon: View {
    let category: String
    var size: CGFloat = 30

    var body: some View {
        Image(systemName: Category.symbol(category))
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Category.color(category), in: RoundedRectangle(cornerRadius: size * 0.23, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Red/green change indicator used for month-over-month and year-over-year comparisons.
struct ChangeLabel: View {
    let pct: Int?

    var body: some View {
        if let pct {
            Label("\(abs(pct))%", systemImage: pct > 0 ? "arrow.up" : pct < 0 ? "arrow.down" : "minus")
                .font(.footnote.weight(.medium))
                .foregroundStyle(pct > 0 ? Color.red : pct < 0 ? Color.green : Color.secondary)
                .labelStyle(.titleAndIcon)
        } else {
            Text("new").font(.footnote).foregroundStyle(.secondary)
        }
    }
}
