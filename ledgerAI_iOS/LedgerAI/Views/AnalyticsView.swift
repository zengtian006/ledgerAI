import Charts
import SwiftUI

struct AnalyticsView: View {
    @Binding var dataVersion: Int
    @State private var vm = AnalyticsViewModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("View", selection: $vm.mode) {
                        ForEach(AnalyticsViewModel.Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)

                    stepper.listRowBackground(Color.clear)
                }

                if let error = vm.error {
                    Section { Text(error).foregroundStyle(.red).font(.subheadline) }
                }

                switch vm.mode {
                case .daily: dailyContent
                case .monthly: monthlyContent
                case .yearly: yearlyContent
                }

                exportSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Analytics")
            .refreshable { await vm.load() }
            .overlay { if vm.loading && vm.isEmpty { ProgressView() } }
            .task(id: "\(vm.reloadKey)-\(dataVersion)") { await vm.load() }
        }
        .sheet(item: $vm.review) { item in
            ReviewView(session: item) { changed in
                vm.review = nil
                if changed { dataVersion += 1 }
            }
        }
        .sheet(item: $vm.shareItem) { ShareSheet(items: [$0.url]).presentationDetents([.medium, .large]) }
    }

    private var stepper: some View {
        HStack {
            Button { vm.step(-1) } label: { Image(systemName: "chevron.left").fontWeight(.semibold) }
                .accessibilityLabel("Previous")
            Spacer()
            Text(vm.mode == .yearly ? String(vm.year) : Fmt.monthLabel(vm.month)).font(.headline)
            Spacer()
            Button { vm.step(1) } label: { Image(systemName: "chevron.right").fontWeight(.semibold) }
                .disabled(!vm.canGoForward).accessibilityLabel("Next")
        }
        .buttonStyle(.borderless)
    }

    // MARK: Daily

    @ViewBuilder private var dailyContent: some View {
        if let daily = vm.daily {
            if daily.days.isEmpty {
                Section { EmptyNote(text: "No expenses this month.") }
            } else {
                ForEach(daily.days) { day in
                    Section {
                        ForEach(day.receipts) { receipt in
                            Button { Task { await vm.open(receipt) } } label: { ReceiptRow(receipt: receipt, showDate: false) }
                                .buttonStyle(.plain)
                        }
                    } header: {
                        HStack {
                            Text(Fmt.dayLabel(day.date))
                            Spacer()
                            Text(Fmt.money(day.total, day.receipts.first?.currency ?? "GBP")).monospacedDigit()
                        }
                    }
                }
            }
        }
    }

    // MARK: Monthly

    @ViewBuilder private var monthlyContent: some View {
        if let m = vm.monthly {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Total spend").font(.footnote).foregroundStyle(.secondary)
                    Text(Fmt.money(m.total, m.currency)).font(.system(size: 34, weight: .bold)).monospacedDigit()
                    HStack(spacing: 8) {
                        Text("Last month \(Fmt.money(m.previousTotal, m.currency))")
                        ChangeLabel(pct: m.changePct)
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    if let budget = m.budget {
                        Text("Budget \(Fmt.money(budget, m.currency)) · \(m.total > budget ? "\(Fmt.money(m.total - budget, m.currency)) over" : "\(Fmt.money(budget - m.total, m.currency)) left")")
                            .font(.footnote).foregroundStyle(m.total > budget ? .red : .secondary)
                    }
                }
            }

            if m.categories.isEmpty {
                Section { EmptyNote(text: "No expenses this month.") }
            } else {
                Section("By category") {
                    ZStack {
                        Chart(m.categories) { c in
                            SectorMark(angle: .value("Total", c.total), innerRadius: .ratio(0.62), angularInset: 2)
                                .cornerRadius(4)
                                .foregroundStyle(Category.color(c.category))
                        }
                        VStack {
                            Text("Total").font(.caption).foregroundStyle(.secondary)
                            Text(Fmt.money(m.total, m.currency)).font(.headline).monospacedDigit()
                        }
                    }
                    .frame(height: 210).padding(.vertical, 6)

                    ForEach(m.categories) { c in
                        HStack {
                            Circle().fill(Category.color(c.category)).frame(width: 12, height: 12)
                            Text(c.category)
                            Spacer()
                            Text("\(Int((c.total / max(m.total, 0.01) * 100).rounded()))%").font(.footnote).foregroundStyle(.secondary)
                            Text(Fmt.money(c.total, m.currency)).monospacedDigit().frame(minWidth: 90, alignment: .trailing)
                        }
                    }
                }

                Section("Top merchants") {
                    ForEach(m.topMerchants) { merchant in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(merchant.merchantName).lineLimit(1)
                                Text(merchant.visits == 1 ? "1 visit" : "\(merchant.visits) visits").font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Fmt.money(merchant.total, m.currency)).monospacedDigit()
                        }
                    }
                }

            }

            Section {
                if let error = vm.recurringError {
                    Text(error).foregroundStyle(.red)
                } else if let expenses = vm.recurringExpenses {
                    if expenses.isEmpty {
                        EmptyNote(text: "No likely recurring expenses found yet. Add at least three similar charges to help identify a pattern.")
                    } else {
                        ForEach(expenses) { expense in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(expense.merchantName).lineLimit(1)
                                    Text("\(expense.cadence) · next expected \(expense.expectedDate)")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(Fmt.money(expense.averageAmount, expense.currency)).monospacedDigit()
                            }
                        }
                    }
                } else {
                    ProgressView()
                }
            } header: {
                Text("Likely recurring")
            } footer: {
                Text("Estimates based on at least three similar charges; check dates and amounts before relying on them.")
            }
        }
    }

    // MARK: Yearly

    @ViewBuilder private var yearlyContent: some View {
        if let y = vm.yearly {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: "Total for " + y.year).font(.footnote).foregroundStyle(.secondary)
                    Text(Fmt.money(y.total, y.currency)).font(.system(size: 34, weight: .bold)).monospacedDigit()
                }
                Chart(visibleMonths(y)) { month in
                    AreaMark(x: .value("Month", Calendar.current.shortMonthSymbols[month.month - 1]), y: .value("Spend", month.total))
                        .foregroundStyle(LinearGradient(colors: [.blue.opacity(0.35), .blue.opacity(0)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Month", Calendar.current.shortMonthSymbols[month.month - 1]), y: .value("Spend", month.total))
                        .foregroundStyle(.blue).interpolationMethod(.monotone)
                }
                .chartXAxis { AxisMarks { AxisValueLabel().font(.system(size: 9)) } }
                .frame(height: 190)
            }

            Section {
                if y.categories.isEmpty {
                    EmptyNote(text: "No data for this year.")
                } else {
                    ForEach(y.categories) { c in
                        HStack(spacing: 12) {
                            CategoryIcon(category: c.category)
                            Text(c.category)
                            Spacer()
                            ChangeLabel(pct: c.changePct)
                            Text(Fmt.money(c.total, y.currency)).monospacedDigit().frame(minWidth: 90, alignment: .trailing)
                        }
                    }
                }
            } header: {
                Text(verbatim: "Change vs " + String((Int(y.year) ?? 0) - 1))
            }
        }
    }

    /// Hide months that haven't happened yet in the current year instead of plotting zeros.
    private func visibleMonths(_ y: Yearly) -> [MonthTotal] {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        guard Int(y.year) == now.year, let current = now.month else { return y.months }
        return y.months.filter { $0.month <= current }
    }

    // MARK: Export

    private var exportSection: some View {
        Section("Export") {
            Picker("Category", selection: $vm.category) {
                Text("All").tag("")
                ForEach(Category.all, id: \.self) { Text($0).tag($0) }
            }
            Button(vm.exporting ? "Exporting…" : "Export as CSV") { Task { await vm.export() } }.disabled(vm.exporting)
        }
    }
}

struct EmptyNote: View {
    let text: String
    var body: some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 8)
    }
}

extension AnalyticsViewModel {
    var isEmpty: Bool {
        switch mode {
        case .daily: return daily == nil
        case .monthly: return monthly == nil
        case .yearly: return yearly == nil
        }
    }
}
