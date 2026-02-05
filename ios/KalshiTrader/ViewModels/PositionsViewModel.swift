import Foundation

@MainActor
class PositionsViewModel: ObservableObject {
    @Published var positions: [Position] = []
    @Published var balance: Double = 0
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let api = APIClient.shared

    func loadPositions() async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await api.getPositions()
            positions = response.positions ?? []
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func loadBalance() async {
        do {
            let response = try await api.getBalance()
            balance = response.balance ?? 0
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadAll() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadPositions() }
            group.addTask { await self.loadBalance() }
        }
    }

    func cancelOrder(orderId: String) async {
        do {
            try await api.cancelOrder(orderId: orderId)
            await loadPositions()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
