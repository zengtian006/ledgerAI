import SwiftUI

/// Bottom-sheet review of a scanned receipt (new) or an existing one (edit).
struct ReviewView: View {
    let session: ReviewSession
    /// Called with `true` when something was saved or deleted.
    let onFinish: (Bool) -> Void

    @State private var form: ReceiptForm
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    @FocusState private var focused: Bool

    private let api = APIClient.shared

    init(session: ReviewSession, onFinish: @escaping (Bool) -> Void) {
        self.session = session
        self.onFinish = onFinish
        _form = State(initialValue: session.form)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let url = session.imageURL {
                    Section {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image): image.resizable().scaledToFit()
                            case .failure: Label("Receipt image unavailable", systemImage: "photo").foregroundStyle(.secondary)
                            default: ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                            }
                        }
                        .frame(maxHeight: 220).frame(maxWidth: .infinity)
                    }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }

                if session.duplicateOf != nil {
                    Section {
                        Label("This image looks identical to a receipt you already saved.", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange).font(.subheadline)
                    }
                }

                Section {
                    LabeledContent("Merchant") {
                        TextField("Merchant", text: $form.merchant).multilineTextAlignment(.trailing).focused($focused)
                    }
                    DatePicker("Date", selection: $form.date, displayedComponents: .date)
                    Picker("Category", selection: $form.category) {
                        ForEach(Category.all, id: \.self) { name in Label(name, systemImage: Category.symbol(name)).tag(name) }
                    }
                } header: {
                    if !session.isEditing { Text("Pre-filled by AI · please double-check") }
                }

                Section {
                    LabeledContent("Total") {
                        TextField("0.00", text: $form.total).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .fontWeight(.semibold).focused($focused)
                    }
                    LabeledContent("Tax") {
                        TextField("Optional", text: $form.tax).keyboardType(.decimalPad).multilineTextAlignment(.trailing).focused($focused)
                    }
                    LabeledContent("Currency") {
                        TextField("GBP", text: $form.currency).textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .multilineTextAlignment(.trailing).focused($focused)
                    }
                }

                Section("Items") {
                    ForEach($form.items) { $item in
                        HStack(spacing: 8) {
                            TextField("Description", text: $item.description).focused($focused)
                            TextField("1", text: $item.quantity).keyboardType(.decimalPad).multilineTextAlignment(.center)
                                .frame(width: 36).foregroundStyle(.secondary).focused($focused)
                            // numbersAndPunctuation keeps the minus key, so discounts can be negative
                            TextField("0.00", text: $item.price).keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing)
                                .frame(width: 70).focused($focused)
                        }
                    }
                    .onDelete { form.items.remove(atOffsets: $0) }
                    Button { form.items.append(LineItemForm()) } label: { Label("Add item", systemImage: "plus.circle.fill") }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.subheadline) }
                }

                if session.isEditing {
                    Section {
                        Button("Delete Receipt", role: .destructive) { confirmDelete = true }.disabled(busy)
                    }
                }
            }
            .navigationTitle(session.isEditing ? "Edit Receipt" : "Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Save", action: save).fontWeight(.semibold) }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focused = false }
                }
            }
            .confirmationDialog("Delete this receipt?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete Receipt", role: .destructive) { Task { await delete() } }
            }
            .interactiveDismissDisabled(busy)
        }
        .presentationDetents([.large])
    }

    private func cancel() {
        if !session.isEditing, let key = session.imageKey { Task { await api.discardImage(key: key) } }
        onFinish(false)
    }

    private func save() {
        Task {
            busy = true
            error = nil
            defer { busy = false }
            do {
                let input = try form.input(imageKey: session.isEditing ? nil : session.imageKey,
                                           imageHash: session.isEditing ? nil : session.imageHash)
                if let id = session.receiptId { try await api.updateReceipt(id: id, input) } else { try await api.saveReceipt(input) }
                onFinish(true)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func delete() async {
        guard let id = session.receiptId else { return }
        busy = true
        defer { busy = false }
        do {
            try await api.deleteReceipt(id: id)
            onFinish(true)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
