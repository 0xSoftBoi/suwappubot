//
//  MockAPIService.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import Foundation
@testable import SuwappuApp

class MockAPIService: APIServiceProtocol {
    static let sharedMock = MockAPIService()
    
    var shouldFailLogin = false
    var shouldFailRegister = false
    var shouldFailGetWallets = false
    var shouldFailGetQuote = false
    var shouldFailExecuteSwap = false
    
    var loginResponse: AuthResponse?
    var registerResponse: AuthResponse?
    var walletsResponse: [Wallet]?
    var quoteResponse: SwapQuote?
    var swapResponse: SwapTransaction?
    
    private var storedAccessToken: String?
    
    func setAccessToken(_ token: String) {
        storedAccessToken = token
    }
    
    func clearAccessToken() {
        storedAccessToken = nil
    }
    
    func login(email: String, password: String) async throws -> AuthResponse {
        if shouldFailLogin {
            throw APIError.unauthorized
        }
        
        if let response = loginResponse {
            return response
        }
        
        return AuthResponse(
            accessToken: "mock_access_token",
            refreshToken: "mock_refresh_token",
            user: User(
                id: 1,
                email: email,
                username: "testuser",
                firstName: "Test",
                lastName: "User",
                defaultSlippage: 50,
                notificationsEnabled: true,
                twoFAEnabled: false,
                twoFAThreshold: 1000,
                createdAt: Date(),
                updatedAt: Date(),
                lastActiveAt: Date()
            ),
            expiresIn: 3600
        )
    }
    
    func register(_ request: RegisterRequest) async throws -> AuthResponse {
        if shouldFailRegister {
            throw APIError.serverError("Registration failed")
        }
        
        if let response = registerResponse {
            return response
        }
        
        return AuthResponse(
            accessToken: "mock_access_token",
            refreshToken: "mock_refresh_token",
            user: User(
                id: 1,
                email: request.email,
                username: request.username,
                firstName: request.firstName,
                lastName: request.lastName,
                defaultSlippage: 50,
                notificationsEnabled: true,
                twoFAEnabled: false,
                twoFAThreshold: 1000,
                createdAt: Date(),
                updatedAt: Date(),
                lastActiveAt: Date()
            ),
            expiresIn: 3600
        )
    }
    
    func refreshToken(refreshToken: String) async throws -> AuthResponse {
        return AuthResponse(
            accessToken: "mock_access_token_refreshed",
            refreshToken: "mock_refresh_token_refreshed",
            user: User(
                id: 1,
                email: "test@example.com",
                username: "testuser",
                firstName: "Test",
                lastName: "User",
                defaultSlippage: 50,
                notificationsEnabled: true,
                twoFAEnabled: false,
                twoFAThreshold: 1000,
                createdAt: Date(),
                updatedAt: Date(),
                lastActiveAt: Date()
            ),
            expiresIn: 3600
        )
    }
    
    func getWallets() async throws -> [Wallet] {
        if shouldFailGetWallets {
            throw APIError.serverError("Failed to fetch wallets")
        }
        
        if let wallets = walletsResponse {
            return wallets
        }
        
        return [
            Wallet(
                id: 1,
                userId: 1,
                name: "Test Wallet",
                address: "0x1234567890123456789012345678901234567890",
                chainType: .evm,
                isActive: true,
                isDefault: true,
                createdAt: Date()
            )
        ]
    }
    
    func createWallet(_ request: CreateWalletRequest) async throws -> Wallet {
        return Wallet(
            id: Int.random(in: 2...999),
            userId: 1,
            name: request.name,
            address: "0x\(UUID().uuidString.prefix(32))",
            chainType: request.chainType,
            isActive: true,
            isDefault: false,
            createdAt: Date()
        )
    }
    
    func importWallet(_ request: ImportWalletRequest) async throws -> Wallet {
        return Wallet(
            id: Int.random(in: 1000...1999),
            userId: 1,
            name: request.name,
            address: "0x\(UUID().uuidString.prefix(32))",
            chainType: request.chainType,
            isActive: true,
            isDefault: false,
            createdAt: Date()
        )
    }
    
    func getWalletBalance(walletId: Int) async throws -> WalletBalance {
        let token = Token(
            id: "usdc",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            chainId: "ethereum",
            logoURL: nil,
            priceUSD: 1.0
        )
        
        let balance = TokenBalance(
            id: "usdc-\(walletId)",
            token: token,
            balance: "1000000",
            balanceHuman: 1_000.0,
            balanceUSD: 1_000.0,
            chainId: "ethereum"
        )
        
        return WalletBalance(
            walletId: walletId,
            chainId: "ethereum",
            tokens: [balance],
            totalUSD: 1_000.0
        )
    }
    
    func deleteWallet(walletId: Int) async throws {
        // No-op for mock
    }
    
    func getQuote(_ request: SwapQuoteRequest) async throws -> SwapQuote {
        if shouldFailGetQuote {
            throw APIError.serverError("Failed to get quote")
        }
        
        if let quote = quoteResponse {
            return quote
        }
        
        return SwapQuote(
            provider: "lifi",
            fromChain: request.fromChain,
            toChain: request.toChain,
            fromToken: request.fromToken,
            toToken: request.toToken,
            fromAmount: "1000000",
            fromAmountHuman: request.amount,
            toAmount: "995000",
            toAmountHuman: request.amount * 0.995,
            toAmountMin: "990000",
            gasCostUSD: 5.0,
            feeCostUSD: 2.0,
            totalCostUSD: 7.0,
            estimatedTime: 300,
            priceImpact: 0.5,
            exchangeRate: 0.995,
            expiresIn: 30,
            timestamp: Date()
        )
    }
    
    func executeSwap(_ request: ExecuteSwapRequest) async throws -> SwapTransaction {
        if shouldFailExecuteSwap {
            throw APIError.serverError("Swap execution failed")
        }
        
        if let swap = swapResponse {
            return swap
        }
        
        return SwapTransaction(
            id: 1,
            userId: 1,
            fromChain: request.quote.fromChain,
            fromToken: request.quote.fromToken,
            fromAmount: request.quote.fromAmount,
            fromAmountUSD: request.quote.fromAmountHuman,
            toChain: request.quote.toChain,
            toToken: request.quote.toToken,
            toAmount: request.quote.toAmount,
            toAmountUSD: request.quote.toAmountHuman,
            status: .submitted,
            txHash: "0xabcdef1234567890",
            bridgeTxHash: nil,
            destinationTxHash: nil,
            routeProvider: request.quote.provider,
            gasFee: request.quote.gasCostUSD,
            bridgeFee: request.quote.feeCostUSD,
            slippage: Int(request.quote.priceImpact * 100),
            createdAt: Date(),
            updatedAt: Date(),
            completedAt: nil,
            errorMessage: nil
        )
    }
    
    func getSwaps(page: Int, pageSize: Int) async throws -> SwapHistoryResponse {
        let swap = swapResponse ?? SwapTransaction(
            id: 1,
            userId: 1,
            fromChain: "ethereum",
            fromToken: "USDC",
            fromAmount: "1000000",
            fromAmountUSD: 1_000,
            toChain: "polygon",
            toToken: "USDC",
            toAmount: "995000",
            toAmountUSD: 995,
            status: .completed,
            txHash: "0xabcdef1234567890",
            bridgeTxHash: nil,
            destinationTxHash: nil,
            routeProvider: "lifi",
            gasFee: 3,
            bridgeFee: 2,
            slippage: 50,
            createdAt: Date(),
            updatedAt: Date(),
            completedAt: Date(),
            errorMessage: nil
        )
        
        return SwapHistoryResponse(
            swaps: [swap],
            total: 1,
            page: page,
            pageSize: pageSize
        )
    }
    
    func getSwap(id: Int) async throws -> SwapTransaction {
        if let swap = swapResponse {
            return swap
        }
        return try await executeSwap(
            ExecuteSwapRequest(
                quote: SwapQuote(
                    provider: "lifi",
                    fromChain: "ethereum",
                    toChain: "polygon",
                    fromToken: "USDC",
                    toToken: "USDC",
                    fromAmount: "1000000",
                    fromAmountHuman: 1_000,
                    toAmount: "995000",
                    toAmountHuman: 995,
                    toAmountMin: "990000",
                    gasCostUSD: 3,
                    feeCostUSD: 2,
                    totalCostUSD: 5,
                    estimatedTime: 300,
                    priceImpact: 0.5,
                    exchangeRate: 0.995,
                    expiresIn: 30,
                    timestamp: Date()
                ),
                walletId: 1
            )
        )
    }
    
    func getSwapStatus(id: Int) async throws -> SwapTransaction {
        var swap = try await getSwap(id: id)
        swap = SwapTransaction(
            id: swap.id,
            userId: swap.userId,
            fromChain: swap.fromChain,
            fromToken: swap.fromToken,
            fromAmount: swap.fromAmount,
            fromAmountUSD: swap.fromAmountUSD,
            toChain: swap.toChain,
            toToken: swap.toToken,
            toAmount: swap.toAmount,
            toAmountUSD: swap.toAmountUSD,
            status: .completed,
            txHash: swap.txHash,
            bridgeTxHash: swap.bridgeTxHash,
            destinationTxHash: swap.destinationTxHash,
            routeProvider: swap.routeProvider,
            gasFee: swap.gasFee,
            bridgeFee: swap.bridgeFee,
            slippage: swap.slippage,
            createdAt: swap.createdAt,
            updatedAt: Date(),
            completedAt: Date(),
            errorMessage: swap.errorMessage
        )
        return swap
    }
    
    func getPortfolio() async throws -> PortfolioResponse {
        let token = Token(
            id: "eth",
            symbol: "ETH",
            name: "Ethereum",
            decimals: 18,
            chainId: "ethereum",
            logoURL: nil,
            priceUSD: 3500
        )
        
        let balance = TokenBalance(
            id: "eth-main",
            token: token,
            balance: "2000000000000000000",
            balanceHuman: 2,
            balanceUSD: 7_000,
            chainId: "ethereum"
        )
        
        return PortfolioResponse(
            totalUSD: 7_000,
            tokens: [balance],
            chains: ["ethereum": 7_000]
        )
    }
}

class MockKeychainService: KeychainService {
    static let sharedMock = MockKeychainService()
    
    private var storage: [String: String] = [:]
    
    override func saveAccessToken(_ token: String) -> Bool {
        storage["accessToken"] = token
        return true
    }
    
    override func getAccessToken() -> String? {
        return storage["accessToken"]
    }
    
    override func saveRefreshToken(_ token: String) -> Bool {
        storage["refreshToken"] = token
        return true
    }
    
    override func getRefreshToken() -> String? {
        return storage["refreshToken"]
    }
    
    override func clearTokens() {
        storage.removeAll()
    }
    
    override func savePrivateKey(walletId: Int, encryptedKey: String) -> Bool {
        storage["wallet_\(walletId)_key"] = encryptedKey
        return true
    }
    
    override func getPrivateKey(walletId: Int) -> String? {
        return storage["wallet_\(walletId)_key"]
    }
    
    override func deletePrivateKey(walletId: Int) {
        storage.removeValue(forKey: "wallet_\(walletId)_key")
    }
}


