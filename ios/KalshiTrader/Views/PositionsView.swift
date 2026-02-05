import SwiftUI

struct PositionsView: View {
    @StateObject private var viewModel = PositionsViewModel()

    var body: some View {
        NavigationView {
            Group {
                if viewModel.isLoading && viewModel.positions.isEmpty {
                    ProgressView("Loading positions...")
                } else if viewModel.positions.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "tray")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        Text("No positions")
                            .font(.headline)
                    }
                } else {
                    List {
                        Section {
                            HStack {
                                Text("Balance")
                                Spacer()
                                Text(String(format: "$%.2f", viewModel.balance / 100))
                                    .fontWeight(.semibold)
                            }
                        }

                        Section(header: Text("Positions")) {
                            ForEach(viewModel.positions) { position in
                                PositionRowView(position: position)
                            }
                        }
                    }
                    .refreshable {
                        await viewModel.loadAll()
                    }
                }
            }
            .navigationTitle("Positions")
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
        .task {
            await viewModel.loadAll()
        }
    }
}

struct PositionRowView: View {
    let position: Position

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(position.ticker)
                .font(.headline)

            HStack {
                VStack(alignment: .leading) {
                    Text("Position: \(position.position)")
                        .font(.subheadline)
                    Text("Avg: \(Int(position.avgPrice))¢")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing) {
                    Text(String(format: "$%.2f", position.pnl / 100))
                        .font(.headline)
                        .foregroundColor(position.pnl >= 0 ? .green : .red)
                    Text("P&L")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
