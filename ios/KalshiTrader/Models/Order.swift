import Foundation

struct OrderResponse: Codable {
    let orderId: String
    let ticker: String
    let side: String
    let size: Int
    let price: Double
    let status: String

    enum CodingKeys: String, CodingKey {
        case orderId = "order_id"
        case ticker
        case side
        case size
        case price
        case status
    }
}

struct Position: Codable, Identifiable {
    var id: String { ticker }
    let ticker: String
    let position: Int
    let avgPrice: Double
    let marketPrice: Double
    let pnl: Double

    enum CodingKeys: String, CodingKey {
        case ticker
        case position
        case avgPrice = "avg_price"
        case marketPrice = "market_price"
        case pnl
    }
}
