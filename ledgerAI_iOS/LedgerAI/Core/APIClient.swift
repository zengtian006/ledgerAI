import Foundation

struct APIError: LocalizedError, Equatable {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Talks to the same REST API as the web app (`/api/...`). Tokens come from `tokenProvider`.
final class APIClient {
    static let shared = APIClient()

    var tokenProvider: () async throws -> String? = { nil }
    var onUnauthorized: () -> Void = {}

    private let session: URLSession
    private let baseURL: URL

    let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    init(session: URLSession = APIClient.defaultSession(), baseURL: URL = AppConfig.apiBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    static func defaultSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60 // receipt scans call Gemini
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }

    // MARK: - Typed helpers

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try decode(try await send("GET", path, query: query).0)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try decode(try await send("POST", path, body: try encoder.encode(body)).0)
    }

    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try decode(try await send("PUT", path, body: try encoder.encode(body)).0)
    }

    func delete(_ path: String, query: [String: String?] = [:]) async throws {
        _ = try await send("DELETE", path, query: query)
    }

    func delete<B: Encodable>(_ path: String, body: B) async throws {
        _ = try await send("DELETE", path, body: try encoder.encode(body))
    }

    func download(_ path: String, query: [String: String?] = [:]) async throws -> Data {
        try await send("GET", path, query: query).0
    }

    /// Uploads one image as multipart form data (field "image"), as the web app does.
    func upload<T: Decodable>(_ path: String, imageData: Data, filename: String = "receipt.jpg") async throws -> T {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"\(filename)\"\r\nContent-Type: image/jpeg\r\n\r\n")
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n")
        let data = try await send("POST", path, body: body, contentType: "multipart/form-data; boundary=\(boundary)").0
        return try decode(data)
    }

    // MARK: - Core

    func send(_ method: String, _ path: String, query: [String: String?] = [:], body: Data? = nil,
              contentType: String = "application/json") async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(url: baseURL.appending(path: "api" + path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value in value.flatMap { $0.isEmpty ? nil : URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { components.queryItems = items.sorted { $0.name < $1.name } }

        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }

        let token = try await tokenProvider()
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, message: "Invalid response") }

        if http.statusCode == 401, token != nil { onUnauthorized() }
        guard (200..<300).contains(http.statusCode) else {
            struct Failure: Decodable { let error: String?; let details: [String]? }
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            throw APIError(status: http.statusCode, message: failure?.details?.first ?? failure?.error ?? "Request failed (\(http.statusCode))")
        }
        return (data, http)
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        if T.self == EmptyResponse.self, data.isEmpty { return EmptyResponse() as! T }
        return try decoder.decode(T.self, from: data)
    }
}

struct EmptyResponse: Decodable {}

private extension Data {
    mutating func append(_ string: String) { append(Data(string.utf8)) }
}
