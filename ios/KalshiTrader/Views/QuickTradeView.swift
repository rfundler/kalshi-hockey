import SwiftUI

struct QuickTradeView: View {
    let game: GameWithPrices
    @ObservedObject var viewModel: GameViewModel

    // Side A inputs
    @State private var sideAContracts = "10"
    @State private var sideALimit = "50"
    @State private var isBettingA = false

    // Side B inputs
    @State private var sideBContracts = "10"
    @State private var sideBLimit = "50"
    @State private var isBettingB = false

    var body: some View {
        VStack(spacing: 16) {
            Text(game.game.name)
                .font(.title)
                .fontWeight(.bold)
                .padding(.top)

            HStack(spacing: 16) {
                // Side A
                TeamBetCard(
                    teamName: game.game.sideA.teamName,
                    ticker: game.game.sideA.ticker,
                    contracts: $sideAContracts,
                    limitPrice: $sideALimit,
                    currentAsk: game.sideAAsk,
                    asks: game.sideAAsks,
                    isLoading: isBettingA,
                    color: .blue
                ) {
                    placeBet(side: "a", contracts: sideAContracts, limit: sideALimit, isLoading: $isBettingA)
                }

                // Side B
                TeamBetCard(
                    teamName: game.game.sideB.teamName,
                    ticker: game.game.sideB.ticker,
                    contracts: $sideBContracts,
                    limitPrice: $sideBLimit,
                    currentAsk: game.sideBAsk,
                    asks: game.sideBAsks,
                    isLoading: isBettingB,
                    color: .red
                ) {
                    placeBet(side: "b", contracts: sideBContracts, limit: sideBLimit, isLoading: $isBettingB)
                }
            }
            .padding(.horizontal)

            Spacer()

            // Status area
            if let error = viewModel.errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
                    .padding()
            }
        }
        .padding()
        .onAppear {
            // Pre-fill with saved values if available
            sideAContracts = String(game.game.sideA.size)
            sideALimit = String(Int(game.game.sideA.priceLimit))
            sideBContracts = String(game.game.sideB.size)
            sideBLimit = String(Int(game.game.sideB.priceLimit))
        }
        .alert("Bet Placed", isPresented: $viewModel.showBetConfirmation) {
            Button("OK") {}
        } message: {
            if let result = viewModel.lastBetResult {
                Text("Order \(result.status)\n\(result.size) contracts @ \(Int(result.price))¢")
            }
        }
    }

    private func placeBet(side: String, contracts: String, limit: String, isLoading: Binding<Bool>) {
        guard let contractsInt = Int(contracts), let limitInt = Int(limit) else { return }

        isLoading.wrappedValue = true

        // Immediate haptic on tap
        let impactGenerator = UIImpactFeedbackGenerator(style: .heavy)
        impactGenerator.impactOccurred()

        Task {
            await viewModel.placeBetWithParams(
                gameId: game.id,
                side: side,
                contracts: contractsInt,
                limitPrice: limitInt
            )
            isLoading.wrappedValue = false
        }
    }
}

struct TeamBetCard: View {
    let teamName: String
    let ticker: String
    @Binding var contracts: String
    @Binding var limitPrice: String
    let currentAsk: Double?
    let asks: [OrderBookLevel]
    let isLoading: Bool
    let color: Color
    let action: () -> Void

    @FocusState private var isContractsFocused: Bool
    @FocusState private var isLimitFocused: Bool

    private var limitInt: Int? { Int(limitPrice) }

    /// Total contracts available at or below the limit price
    private var availableContracts: Int {
        guard let limit = limitInt else { return 0 }
        return asks.filter { $0.price <= limit }.reduce(0) { $0 + $1.quantity }
    }

    var body: some View {
        VStack(spacing: 10) {
            // Team name header
            Text(teamName)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.white)

            // Current ask price
            if let ask = currentAsk {
                HStack(spacing: 4) {
                    Text("Ask:")
                        .font(.caption)
                    Text("\(Int(ask))¢")
                        .font(.caption)
                        .fontWeight(.bold)

                    if let limit = limitInt {
                        if limit >= Int(ask) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                                .font(.caption)
                        } else {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.yellow)
                                .font(.caption)
                        }
                    }
                }
                .foregroundColor(.white.opacity(0.9))
            }

            // Available contracts at limit
            if limitInt != nil {
                HStack(spacing: 4) {
                    Text("Available:")
                        .font(.caption)
                    Text("\(availableContracts)")
                        .font(.caption)
                        .fontWeight(.bold)
                    Text("@ ≤\(limitPrice)¢")
                        .font(.caption)
                }
                .foregroundColor(availableContracts > 0 ? .green : .yellow)
            }

            Divider()
                .background(Color.white.opacity(0.3))

            // Contracts input
            VStack(spacing: 4) {
                Text("Contracts")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))
                TextField("", text: $contracts)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.title3.bold())
                    .padding(8)
                    .background(Color.white.opacity(0.2))
                    .cornerRadius(8)
                    .foregroundColor(.white)
                    .focused($isContractsFocused)
            }

            // Limit price input
            VStack(spacing: 4) {
                Text("Limit (¢)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))
                TextField("", text: $limitPrice)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.title3.bold())
                    .padding(8)
                    .background(Color.white.opacity(0.2))
                    .cornerRadius(8)
                    .foregroundColor(.white)
                    .focused($isLimitFocused)
            }

            // BET button
            Button(action: {
                isContractsFocused = false
                isLimitFocused = false
                action()
            }) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: color))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.white)
                        .cornerRadius(10)
                } else {
                    Text("BET")
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundColor(color)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.white)
                        .cornerRadius(10)
                }
            }
            .disabled(isLoading || contracts.isEmpty || limitPrice.isEmpty)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(color)
        .cornerRadius(20)
    }
}
