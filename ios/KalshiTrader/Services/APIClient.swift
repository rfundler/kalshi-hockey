import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case networkError(Error)
    case decodingError(Error)
    case serverError(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .serverError(let code, let message):
            return "Server error \(code): \(message)"
        }
    }
}

class APIClient {
    static let shared = APIClient()

    private var baseURL: String {
        UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:8000"
    }

    private let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 10
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    // MARK: - Games

    func listGames() async throws -> [GameWithPrices] {
        return try await get("/games")
    }

    func getGame(id: String) async throws -> GameWithPrices {
        return try await get("/games/\(id)")
    }

    func createGame(_ request: CreateGameRequest) async throws -> GameConfig {
        return try await post("/games", body: request)
    }

    func deleteGame(id: String) async throws {
        let _: EmptyResponse = try await delete("/games/\(id)")
    }

    // MARK: - Market Lookup

    func lookupRelatedMarket(ticker: String) async throws -> RelatedMarketResponse {
        return try await get("/markets/\(ticker)/related")
    }

    // MARK: - Betting

    func placeBet(gameId: String, side: String, contracts: Int?, limitPrice: Int?) async throws -> OrderResponse {
        let body = BetRequest(contracts: contracts, limitPrice: limitPrice)
        return try await post("/games/\(gameId)/bet/\(side)", body: body)
    }

    // MARK: - Portfolio

    func getPositions() async throws -> PositionsResponse {
        return try await get("/positions")
    }

    func getBalance() async throws -> BalanceResponse {
        return try await get("/balance")
    }

    func cancelOrder(orderId: String) async throws {
        let _: EmptyResponse = try await delete("/order/\(orderId)")
    }

    // MARK: - Private

    private func get<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        return try await execute(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        return try await execute(request)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        return try await execute(request)
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.networkError(URLError(.badServerResponse))
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8) ?? "Unknown error"
                throw APIError.serverError(httpResponse.statusCode, message)
            }

            return try decoder.decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }
}

// Helper types
struct EmptyRequest: Encodable {}
struct EmptyResponse: Decodable {}

struct BetRequest: Encodable {
    let contracts: Int?
    let limitPrice: Int?

    enum CodingKeys: String, CodingKey {
        case contracts
        case limitPrice = "limit_price"
    }
}

struct PositionsResponse: Decodable {
    let positions: [Position]?
}

struct BalanceResponse: Decodable {
    let balance: Double?
}

struct RelatedMarketSide: Decodable {
    let ticker: String
    let teamName: String

    enum CodingKeys: String, CodingKey {
        case ticker
        case teamName = "team_name"
    }
}

struct RelatedMarketResponse: Decodable {
    let eventName: String
    let sideA: RelatedMarketSide
    let sideB: RelatedMarketSide?

    enum CodingKeys: String, CodingKey {
        case eventName = "event_name"
        case sideA = "side_a"
        case sideB = "side_b"
    }
}
