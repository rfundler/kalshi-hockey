import Foundation

struct GameConfig: Codable, Identifiable {
    let id: String
    let name: String
    let sideA: GameSide
    let sideB: GameSide
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case sideA = "side_a"
        case sideB = "side_b"
        case createdAt = "created_at"
    }
}

struct OrderBookLevel: Codable {
    let price: Int
    let quantity: Int
}

struct GameWithPrices: Codable, Identifiable, Hashable {
    static func == (lhs: GameWithPrices, rhs: GameWithPrices) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    var id: String { game.id }
    let game: GameConfig
    let sideAAsk: Double?
    let sideBAsk: Double?
    let sideABid: Double?
    let sideBBid: Double?
    let sideAAsks: [OrderBookLevel]
    let sideBAsks: [OrderBookLevel]

    enum CodingKeys: String, CodingKey {
        case game
        case sideAAsk = "side_a_ask"
        case sideBAsk = "side_b_ask"
        case sideABid = "side_a_bid"
        case sideBBid = "side_b_bid"
        case sideAAsks = "side_a_asks"
        case sideBAsks = "side_b_asks"
    }

    /// Calculate total contracts available at or below the given limit price
    func availableContracts(forSide side: String, atLimit limit: Int) -> Int {
        let asks = side == "a" ? sideAAsks : sideBAsks
        return asks.filter { $0.price <= limit }.reduce(0) { $0 + $1.quantity }
    }
}

struct CreateGameRequest: Codable {
    let name: String
    let sideA: GameSide
    let sideB: GameSide

    enum CodingKeys: String, CodingKey {
        case name
        case sideA = "side_a"
        case sideB = "side_b"
    }
}
