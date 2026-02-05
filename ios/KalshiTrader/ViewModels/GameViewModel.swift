import Foundation
import SwiftUI

@MainActor
class GameViewModel: ObservableObject {
    @Published var games: [GameWithPrices] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var lastBetResult: OrderResponse?
    @Published var showBetConfirmation = false

    private let api = APIClient.shared
    private var refreshTask: Task<Void, Never>?

    func loadGames() async {
        isLoading = true
        errorMessage = nil

        do {
            games = try await api.listGames()
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    @discardableResult
    func createGame(name: String, sideA: GameSide, sideB: GameSide) async -> GameConfig? {
        do {
            let request = CreateGameRequest(name: name, sideA: sideA, sideB: sideB)
            let created = try await api.createGame(request)
            await loadGames()
            return created
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deleteGame(id: String) async {
        do {
            try await api.deleteGame(id: id)
            await loadGames()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func placeBet(gameId: String, side: String) async {
        do {
            let result = try await api.placeBet(gameId: gameId, side: side, contracts: nil, limitPrice: nil)
            lastBetResult = result
            showBetConfirmation = true

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Refresh prices
            await loadGames()
        } catch {
            errorMessage = error.localizedDescription

            // Error haptic
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.error)
        }
    }

    func placeBetWithParams(gameId: String, side: String, contracts: Int, limitPrice: Int) async {
        do {
            let result = try await api.placeBet(gameId: gameId, side: side, contracts: contracts, limitPrice: limitPrice)
            lastBetResult = result
            showBetConfirmation = true

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Refresh prices
            await loadGames()
        } catch {
            errorMessage = error.localizedDescription

            // Error haptic
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.error)
        }
    }

    func startAutoRefresh() {
        refreshTask = Task {
            while !Task.isCancelled {
                await loadGames()
                try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
            }
        }
    }

    func stopAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }
}
