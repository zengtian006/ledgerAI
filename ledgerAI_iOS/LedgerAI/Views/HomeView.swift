import PhotosUI
import SwiftUI

struct HomeView: View {
    @Environment(SessionStore.self) private var session
    @Binding var dataVersion: Int

    @State private var vm = HomeViewModel()
    @State private var showCamera = false
    @State private var showCameraUnavailable = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var editingBudget = false
    @State private var budgetText = ""

    private var currency: String { vm.summary?.currency ?? session.user?.currency ?? "GBP" }

    var body: some View {
        NavigationStack {
            List {
                totalsSection
                scanSection
                budgetSection
                InsightsSection(insights: vm.insights, loading: vm.insightsLoading, refreshing: vm.refreshingInsights) {
                    Task { await vm.refreshInsights() }
                }
                recentSection
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .navigationTitle(Fmt.monthLabel(vm.month)) // large title, like Analytics and Account
            .refreshable { await vm.load() }
            .task(id: dataVersion) { await vm.load() }
        }
        .sheet(item: $vm.review) { item in
            ReviewView(session: item) { changed in
                vm.review = nil
                if changed { dataVersion += 1 }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in Task { await vm.scan(image: image, fallbackCurrency: currency) } }.ignoresSafeArea()
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    await vm.scan(data: data, fallbackCurrency: currency)
                } else {
                    vm.error = "Could not load that photo."
                }
                pickedPhoto = nil
            }
        }
        .alert("Camera not available", isPresented: $showCameraUnavailable) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This device has no camera (for example the Simulator). Choose a photo from your library instead.")
        }
    }

    // MARK: Sections

    private var totalsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.money(vm.summary?.total ?? 0, currency))
                    .font(.system(size: 40, weight: .bold)).monospacedDigit()
                    .minimumScaleFactor(0.6).lineLimit(1)
                if let pct = vm.summary?.changePct {
                    Text("\(pct > 0 ? "↑" : "↓") \(abs(pct))% vs last month")
                        .font(.subheadline).foregroundStyle(pct > 0 ? .red : .green)
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
        }
    }

    private var scanSection: some View {
        Section {
            VStack(spacing: 10) {
                Button {
                    if CameraPicker.isAvailable { showCamera = true } else { showCameraUnavailable = true }
                } label: {
                    HStack(spacing: 8) {
                        Spacer()
                        if vm.scanning {
                            ProgressView().tint(.white)
                            Text("Reading receipt…")
                        } else {
                            Image(systemName: "camera.fill").imageScale(.large)
                            Text("Snap Receipt")
                        }
                        Spacer()
                    }
                    .font(.headline).foregroundStyle(.white).frame(minHeight: 28) // white on the blue button; the accent tint made the icon vanish
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(vm.scanning)

                PhotosPicker(selection: $pickedPhoto, matching: .images) {
                    HStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle")
                        Text("Choose from Library")
                    }
                    .frame(maxWidth: .infinity, minHeight: 24)
                }
                .buttonStyle(.bordered).controlSize(.large)
                .disabled(vm.scanning)
            }
            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)

            if let error = vm.error {
                Text(error).font(.footnote).foregroundStyle(.red).listRowBackground(Color.red.opacity(0.08))
            }
        }
    }

    private var budgetSection: some View {
        Section("Budget") {
            if editingBudget {
                HStack {
                    TextField("Monthly budget", text: $budgetText).keyboardType(.decimalPad)
                    Button("Done") {
                        if let amount = Fmt.number(budgetText), amount >= 0 {
                            Task { await vm.saveBudget(amount); dataVersion += 1 }
                        }
                        editingBudget = false
                    }.fontWeight(.semibold)
                    Button("Cancel", role: .cancel) { editingBudget = false }
                }
            } else if let budget = vm.summary?.budget, let total = vm.summary?.total {
                Button {
                    budgetText = Fmt.plain(budget)
                    editingBudget = true
                } label: {
                    BudgetRow(budget: budget, total: total, currency: currency)
                }
                .buttonStyle(.plain)
            } else {
                Button("Set Monthly Budget") { budgetText = ""; editingBudget = true }
            }
        }
    }

    private var recentSection: some View {
        Section("Recent") {
            if vm.recent.isEmpty {
                Text("No receipts yet. Tap “Snap Receipt” to start.")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 8)
            } else {
                ForEach(vm.recent) { receipt in
                    Button { Task { await vm.open(receipt) } } label: { ReceiptRow(receipt: receipt) }
                        .buttonStyle(.plain)
                }
            }
        }
    }
}

struct BudgetRow: View {
    let budget: Double
    let total: Double
    let currency: String

    private var over: Bool { total > budget }
    private var fraction: Double { budget > 0 ? min(1, total / budget) : 0 }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text(Fmt.money(budget, currency))
                Spacer()
                Text(over ? "\(Fmt.money(total - budget, currency)) over" : "\(Fmt.money(budget - total, currency)) left")
                    .foregroundStyle(over ? .red : .secondary)
            }
            ProgressView(value: fraction)
                .tint(over ? .red : fraction > 0.8 ? .orange : .green)
        }
        .contentShape(Rectangle())
    }
}

struct ReceiptRow: View {
    let receipt: Receipt
    var showDate = true

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(category: receipt.category)
            VStack(alignment: .leading, spacing: 1) {
                Text(receipt.merchantName).lineLimit(1)
                Text(showDate ? "\(receipt.category) · \(Fmt.dayLabel(receipt.transactionDate))" : receipt.category)
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Text(Fmt.money(receipt.totalAmount, receipt.currency)).monospacedDigit()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }
}

struct InsightsSection: View {
    let insights: Insights?
    let loading: Bool
    let refreshing: Bool
    let onRefresh: () -> Void

    private func tint(_ velocity: String) -> Color {
        switch velocity {
        case "under_control": return .green
        case "high_alert": return .red
        default: return .blue
        }
    }

    private func label(_ velocity: String) -> String {
        switch velocity {
        case "under_control": return "Under control"
        case "high_alert": return "High alert"
        default: return "On track"
        }
    }

    private func icon(_ type: String) -> (String, Color) {
        switch type {
        case "anomaly": return ("exclamationmark.triangle.fill", .orange)
        case "trend": return ("chart.line.uptrend.xyaxis", .blue)
        case "savings_opportunity": return ("dollarsign.circle.fill", .green)
        default: return ("lightbulb.fill", .yellow)
        }
    }

    var body: some View {
        Section {
            if loading && insights == nil {
                Text("Analysing your spending…").foregroundStyle(.secondary)
            } else if let insights {
                Text(insights.summaryHeadline).font(.headline)
                ForEach(insights.keyInsights) { item in
                    let (symbol, color) = icon(item.type)
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 30, height: 30).background(color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.subheadline.weight(.medium))
                            if !item.detail.isEmpty { Text(item.detail).font(.footnote).foregroundStyle(.secondary) }
                        }
                    }
                }
                if let adjustment = insights.suggestedBudgetAdjustment {
                    Text(adjustment).font(.footnote).foregroundStyle(Color.accentColor)
                }
                Button(refreshing ? "Refreshing…" : "Refresh Insights", action: onRefresh).disabled(refreshing)
            } else {
                Text("Add a receipt to get your first insights.").foregroundStyle(.secondary)
            }
        } header: {
            HStack {
                Label("AI Insights", systemImage: "sparkles")
                Spacer()
                if let insights {
                    Text(label(insights.spendingVelocity))
                        .font(.caption.weight(.semibold)).textCase(nil)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(tint(insights.spendingVelocity).opacity(0.15), in: Capsule())
                        .foregroundStyle(tint(insights.spendingVelocity))
                }
            }
        }
    }
}
