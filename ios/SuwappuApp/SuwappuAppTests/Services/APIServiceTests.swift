//
//  APIServiceTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

final class APIServiceTests: XCTestCase {
    var apiService: MockAPIService!
    
    override func setUp() {
        super.setUp()
        apiService = MockAPIService.sharedMock
        apiService.shouldFailLogin = false
        apiService.shouldFailRegister = false
    }
    
    override func tearDown() {
        apiService = nil
        super.tearDown()
    }
    
    func testSetAndClearAccessToken() {
        // Given
        let token = "test_token_123"
        
        // When
        apiService.setAccessToken(token)
        
        // Then
        // Note: In real implementation, you'd verify token is stored
        // For now, we test the mock behavior
        apiService.clearAccessToken()
    }
    
    func testLogin_Success() async throws {
        // Given
        let email = "test@example.com"
        let password = "password123"
        apiService.shouldFailLogin = false
        
        // When
        let response = try await apiService.login(email: email, password: password)
        
        // Then
        XCTAssertNotNil(response.accessToken)
        XCTAssertNotNil(response.refreshToken)
        XCTAssertEqual(response.user.email, email)
    }
    
    func testLogin_Failure() async {
        // Given
        let email = "test@example.com"
        let password = "wrongpassword"
        apiService.shouldFailLogin = true
        
        // When/Then
        do {
            _ = try await apiService.login(email: email, password: password)
            XCTFail("Should have thrown an error")
        } catch {
            XCTAssertTrue(error is APIError)
        }
    }
    
    func testRegister_Success() async throws {
        // Given
        let request = RegisterRequest(
            email: "newuser@example.com",
            password: "password123",
            username: "newuser",
            firstName: "New",
            lastName: "User"
        )
        apiService.shouldFailRegister = false
        
        // When
        let response = try await apiService.register(request)
        
        // Then
        XCTAssertNotNil(response.accessToken)
        XCTAssertEqual(response.user.email, request.email)
        XCTAssertEqual(response.user.username, request.username)
    }
    
    func testGetWallets_Success() async throws {
        // Given
        apiService.shouldFailGetWallets = false
        
        // When
        let wallets = try await apiService.getWallets()
        
        // Then
        XCTAssertFalse(wallets.isEmpty)
        XCTAssertEqual(wallets.first?.name, "Test Wallet")
    }
    
    func testGetQuote_Success() async throws {
        // Given
        let request = SwapQuoteRequest(
            fromChain: "ethereum",
            toChain: "polygon",
            fromToken: "USDT",
            toToken: "USDC",
            amount: 1000.0,
            fromAddress: "0x123",
            toAddress: nil,
            slippage: 0.5
        )
        apiService.shouldFailGetQuote = false
        
        // When
        let quote = try await apiService.getQuote(request)
        
        // Then
        XCTAssertEqual(quote.fromChain, request.fromChain)
        XCTAssertEqual(quote.toChain, request.toChain)
        XCTAssertEqual(quote.fromToken, request.fromToken)
        XCTAssertEqual(quote.toToken, request.toToken)
        XCTAssertGreaterThan(quote.toAmountHuman, 0)
    }
    
    func testExecuteSwap_Success() async throws {
        // Given
        let quote = SwapQuote(
            provider: "lifi",
            fromChain: "ethereum",
            toChain: "polygon",
            fromToken: "USDT",
            toToken: "USDC",
            fromAmount: "1000000",
            fromAmountHuman: 1000.0,
            toAmount: "995000",
            toAmountHuman: 995.0,
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
        
        let request = ExecuteSwapRequest(
            quote: quote,
            walletId: 1
        )
        apiService.shouldFailExecuteSwap = false
        
        // When
        let swap = try await apiService.executeSwap(request)
        
        // Then
        XCTAssertNotNil(swap.txHash)
        XCTAssertEqual(swap.fromChain, quote.fromChain)
        XCTAssertEqual(swap.toChain, quote.toChain)
    }
}


