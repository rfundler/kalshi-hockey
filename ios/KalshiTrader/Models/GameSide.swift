import Foundation

struct GameSide: Codable, Identifiable {
    var id: String { ticker }
    let ticker: String
    let teamName: String
    let size: Int
    let priceLimit: Double

    enum CodingKeys: String, CodingKey {
        case ticker
        case teamName = "team_name"
        case size
        case priceLimit = "price_limit"
    }
}
