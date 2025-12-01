//
//  APIService.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

protocol APIServiceProtocol {
    func setAccessToken(_ token: String)
    func clearAccessToken()
    
    func login(email: String, password: String) async throws -> AuthResponse
    func register(_ request: RegisterRequest) async throws -> AuthResponse
    func refreshToken(refreshToken: String) async throws -> AuthResponse
    
    func getWallets() async throws -> [Wallet]
    func createWallet(_ request: CreateWalletRequest) async throws -> Wallet
    func importWallet(_ request: ImportWalletRequest) async throws -> Wallet
    func getWalletBalance(walletId: Int) async throws -> WalletBalance
    func deleteWallet(walletId: Int) async throws
    
    func getQuote(_ request: SwapQuoteRequest) async throws -> SwapQuote
    func executeSwap(_ request: ExecuteSwapRequest) async throws -> SwapTransaction
    func getSwaps(page: Int, pageSize: Int) async throws -> SwapHistoryResponse
    func getSwap(id: Int) async throws -> SwapTransaction
    func getSwapStatus(id: Int) async throws -> SwapTransaction
    
    func getPortfolio() async throws -> PortfolioResponse
}

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, message: String?)
    case decodingError(Error)
    case networkError(Error)
    case unauthorized
    case serverError(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode, let message):
            return message ?? "HTTP Error: \(statusCode)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .unauthorized:
            return "Unauthorized. Please login again."
        case .serverError(let message):
            return "Server error: \(message)"
        }
    }
}

class APIService: APIServiceProtocol {
    static let shared = APIService()
    
    private let baseURL: String
    private let session: URLSession
    private var accessToken: String?
    
    private init() {
        self.baseURL = ConfigService.shared.string(.apiBaseURL)
        
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)
    }
    
    func setAccessToken(_ token: String) {
        self.accessToken = token
    }
    
    func clearAccessToken() {
        self.accessToken = nil
    }
    
    // MARK: - Authentication
    
    func login(email: String, password: String) async throws -> AuthResponse {
        let request = LoginRequest(email: email, password: password)
        return try await performRequest(
            endpoint: "/auth/login",
            method: "POST",
            body: request,
            responseType: AuthResponse.self
        )
    }
    
    func register(_ request: RegisterRequest) async throws -> AuthResponse {
        return try await performRequest(
            endpoint: "/auth/register",
            method: "POST",
            body: request,
            responseType: AuthResponse.self
        )
    }
    
    func refreshToken(refreshToken: String) async throws -> AuthResponse {
        struct RefreshRequest: Codable {
            let refreshToken: String
        }
        let request = RefreshRequest(refreshToken: refreshToken)
        return try await performRequest(
            endpoint: "/auth/refresh",
            method: "POST",
            body: request,
            responseType: AuthResponse.self,
            requiresAuth: false
        )
    }
    
    // MARK: - Wallets
    
    func getWallets() async throws -> [Wallet] {
        return try await performRequest(
            endpoint: "/wallets",
            method: "GET",
            responseType: [Wallet].self
        )
    }
    
    func createWallet(_ request: CreateWalletRequest) async throws -> Wallet {
        return try await performRequest(
            endpoint: "/wallets",
            method: "POST",
            body: request,
            responseType: Wallet.self
        )
    }
    
    func importWallet(_ request: ImportWalletRequest) async throws -> Wallet {
        return try await performRequest(
            endpoint: "/wallets/import",
            method: "POST",
            body: request,
            responseType: Wallet.self
        )
    }
    
    func getWalletBalance(walletId: Int) async throws -> WalletBalance {
        return try await performRequest(
            endpoint: "/wallets/\(walletId)/balance",
            method: "GET",
            responseType: WalletBalance.self
        )
    }
    
    func deleteWallet(walletId: Int) async throws {
        _ = try await performRequest(
            endpoint: "/wallets/\(walletId)",
            method: "DELETE",
            responseType: EmptyResponse.self
        )
    }
    
    // MARK: - Swaps
    
    func getQuote(_ request: SwapQuoteRequest) async throws -> SwapQuote {
        return try await performRequest(
            endpoint: "/quotes",
            method: "POST",
            body: request,
            responseType: SwapQuote.self
        )
    }
    
    func executeSwap(_ request: ExecuteSwapRequest) async throws -> SwapTransaction {
        return try await performRequest(
            endpoint: "/swaps",
            method: "POST",
            body: request,
            responseType: SwapTransaction.self
        )
    }
    
    func getSwaps(page: Int = 1, pageSize: Int = 20) async throws -> SwapHistoryResponse {
        return try await performRequest(
            endpoint: "/swaps?page=\(page)&pageSize=\(pageSize)",
            method: "GET",
            responseType: SwapHistoryResponse.self
        )
    }
    
    func getSwap(id: Int) async throws -> SwapTransaction {
        return try await performRequest(
            endpoint: "/swaps/\(id)",
            method: "GET",
            responseType: SwapTransaction.self
        )
    }
    
    func getSwapStatus(id: Int) async throws -> SwapTransaction {
        return try await performRequest(
            endpoint: "/swaps/\(id)/status",
            method: "GET",
            responseType: SwapTransaction.self
        )
    }
    
    // MARK: - Portfolio
    
    func getPortfolio() async throws -> PortfolioResponse {
        return try await performRequest(
            endpoint: "/portfolio",
            method: "GET",
            responseType: PortfolioResponse.self
        )
    }
    
    // MARK: - Generic Request
    
    private func performRequest<U: Codable>(
        endpoint: String,
        method: String,
        responseType: U.Type,
        requiresAuth: Bool = true
    ) async throws -> U {
        return try await performRequest(
            endpoint: endpoint,
            method: method,
            body: Optional<EmptyRequest>.none,
            responseType: responseType,
            requiresAuth: requiresAuth
        )
    }
    
    private func performRequest<T: Codable, U: Codable>(
        endpoint: String,
        method: String,
        body: T?,
        responseType: U.Type,
        requiresAuth: Bool = true
    ) async throws -> U {
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if requiresAuth {
            guard let token = accessToken else {
                throw APIError.unauthorized
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        if let body = body {
            do {
                request.httpBody = try JSONEncoder().encode(body)
            } catch {
                throw APIError.decodingError(error)
            }
        }
        
        do {
            let (data, response) = try await session.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            
            guard (200...299).contains(httpResponse.statusCode) else {
                let errorMessage = try? JSONDecoder().decode(ErrorResponse.self, from: data).message
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
            }
            
            do {
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                return try decoder.decode(U.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
}

// MARK: - Response Types

struct EmptyRequest: Codable {}
struct EmptyResponse: Codable {}

struct ErrorResponse: Codable {
    let message: String
    let code: String?
}

struct PortfolioResponse: Codable {
    let totalUSD: Double
    let tokens: [TokenBalance]
    let chains: [String: Double] // Chain ID -> USD value
}

