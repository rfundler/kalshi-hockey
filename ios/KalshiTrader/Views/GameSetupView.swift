import SwiftUI

struct GameSetupView: View {
    @ObservedObject var viewModel: GameViewModel
    @Binding var isPresented: Bool
    var onCreated: ((String) -> Void)?  // Callback with game ID

    // Lookup
    @State private var tickerInput = ""
    @State private var isLookingUp = false
    @State private var lookupError: String?

    // Auto-filled from lookup
    @State private var gameName = ""
    @State private var sideATicker = ""
    @State private var sideATeamName = ""
    @State private var sideBTicker = ""
    @State private var sideBTeamName = ""

    // Default settings
    @State private var defaultSize = "10"
    @State private var defaultLimit = "50"

    @State private var hasLookedUp = false
    @State private var isSubmitting = false

    var body: some View {
        NavigationView {
            Form {
                // Step 1: Enter ticker and lookup
                Section(header: Text("Step 1: Enter any ticker from the game")) {
                    HStack {
                        TextField("e.g., KXNBA-25JAN24-LAL", text: $tickerInput)
                            .autocapitalization(.allCharacters)
                            .disableAutocorrection(true)

                        Button(action: lookupMarket) {
                            if isLookingUp {
                                ProgressView()
                                    .frame(width: 60)
                            } else {
                                Text("Lookup")
                                    .frame(width: 60)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(tickerInput.isEmpty || isLookingUp)
                    }

                    if let error = lookupError {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }

                // Step 2: Show detected game (after lookup)
                if hasLookedUp {
                    Section(header: Text("Step 2: Confirm game")) {
                        HStack {
                            Text("Game")
                            Spacer()
                            TextField("Game name", text: $gameName)
                                .multilineTextAlignment(.trailing)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Side A")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            HStack {
                                Text(sideATeamName)
                                    .fontWeight(.medium)
                                Spacer()
                                Text(sideATicker)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Side B")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            HStack {
                                Text(sideBTeamName)
                                    .fontWeight(.medium)
                                Spacer()
                                Text(sideBTicker)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    Section(header: Text("Step 3: Default settings (optional)")) {
                        HStack {
                            Text("Default contracts")
                            Spacer()
                            TextField("", text: $defaultSize)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 60)
                        }
                        HStack {
                            Text("Default limit (¢)")
                            Spacer()
                            TextField("", text: $defaultLimit)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 60)
                        }

                        Text("You can change these on the trade screen")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Add Game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        isPresented = false
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Add") {
                        saveGame()
                    }
                    .disabled(!canSave || isSubmitting)
                }
            }
        }
    }

    private var canSave: Bool {
        hasLookedUp &&
        !sideATicker.isEmpty && !sideATeamName.isEmpty &&
        !sideBTicker.isEmpty && !sideBTeamName.isEmpty &&
        Int(defaultSize) != nil && Int(defaultLimit) != nil
    }

    private func lookupMarket() {
        isLookingUp = true
        lookupError = nil

        Task {
            do {
                let result = try await APIClient.shared.lookupRelatedMarket(ticker: tickerInput.uppercased())

                gameName = result.eventName
                sideATicker = result.sideA.ticker
                sideATeamName = result.sideA.teamName

                if let sideB = result.sideB {
                    sideBTicker = sideB.ticker
                    sideBTeamName = sideB.teamName
                } else {
                    lookupError = "No opposing market found"
                }

                hasLookedUp = true
            } catch {
                lookupError = "Failed: \(error.localizedDescription)"
            }

            isLookingUp = false
        }
    }

    private func saveGame() {
        guard let size = Int(defaultSize),
              let limit = Double(defaultLimit) else { return }

        isSubmitting = true

        let sideA = GameSide(
            ticker: sideATicker,
            teamName: sideATeamName,
            size: size,
            priceLimit: limit
        )

        let sideB = GameSide(
            ticker: sideBTicker,
            teamName: sideBTeamName,
            size: size,
            priceLimit: limit
        )

        Task {
            let created = await viewModel.createGame(
                name: gameName.isEmpty ? "\(sideATeamName) vs \(sideBTeamName)" : gameName,
                sideA: sideA,
                sideB: sideB
            )
            if let game = created {
                isPresented = false
                // Small delay to let sheet dismiss, then navigate
                try? await Task.sleep(nanoseconds: 300_000_000)
                onCreated?(game.id)
            }
            isSubmitting = false
        }
    }
}
