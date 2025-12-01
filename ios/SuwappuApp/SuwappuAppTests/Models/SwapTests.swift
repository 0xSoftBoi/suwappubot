//
//  SwapTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

final class SwapTests: XCTestCase {
    
    func testSwapStatus_IsCompleted() {
        // Given
        let status = SwapStatus.completed
        
        // Then
        XCTAssertTrue(status.isCompleted)
        XCTAssertFalse(status.isFailed)
        XCTAssertFalse(status.isPending)
    }
    
    func testSwapStatus_IsFailed() {
        // Given
        let status = SwapStatus.failed
        
        // Then
        XCTAssertTrue(status.isFailed)
        XCTAssertFalse(status.isCompleted)
        XCTAssertFalse(status.isPending)
    }
    
    func testSwapStatus_IsPending() {
        // Given
        let status = SwapStatus.pending
        
        // Then
        XCTAssertTrue(status.isPending)
        XCTAssertFalse(status.isCompleted)
        XCTAssertFalse(status.isFailed)
    }
    
    func testSwapTransaction_IsCrossChain() {
        // Given
        let swap = SwapTransaction(
            id: 1,
            userId: 1,
            fromChain: "ethereum",
            fromToken: "USDT",
            fromAmount: "1000000",
            fromAmountUSD: 1000.0,
            toChain: "polygon",
            toToken: "USDC",
            toAmount: "995000",
            toAmountUSD: 995.0,
            status: .pending,
            txHash: nil,
            bridgeTxHash: nil,
            destinationTxHash: nil,
            routeProvider: "lifi",
            gasFee: 5.0,
            bridgeFee: 2.0,
            slippage: 50,
            createdAt: Date(),
            updatedAt: Date(),
            completedAt: nil,
            errorMessage: nil
        )
        
        // Then
        XCTAssertTrue(swap.isCrossChain)
    }
    
    func testSwapTransaction_IsNotCrossChain() {
        // Given
        let swap = SwapTransaction(
            id: 1,
            userId: 1,
            fromChain: "ethereum",
            fromToken: "USDT",
            fromAmount: "1000000",
            fromAmountUSD: 1000.0,
            toChain: "ethereum",
            toToken: "USDC",
            toAmount: "995000",
            toAmountUSD: 995.0,
            status: .pending,
            txHash: nil,
            bridgeTxHash: nil,
            destinationTxHash: nil,
            routeProvider: "lifi",
            gasFee: 5.0,
            bridgeFee: 2.0,
            slippage: 50,
            createdAt: Date(),
            updatedAt: Date(),
            completedAt: nil,
            errorMessage: nil
        )
        
        // Then
        XCTAssertFalse(swap.isCrossChain)
    }
    
    func testSwapQuote_Codable() throws {
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
        
        // When
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(quote)
        
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decodedQuote = try decoder.decode(SwapQuote.self, from: data)
        
        // Then
        XCTAssertEqual(decodedQuote.provider, quote.provider)
        XCTAssertEqual(decodedQuote.fromChain, quote.fromChain)
        XCTAssertEqual(decodedQuote.toChain, quote.toChain)
        XCTAssertEqual(decodedQuote.fromAmountHuman, quote.fromAmountHuman, accuracy: 0.01)
        XCTAssertEqual(decodedQuote.toAmountHuman, quote.toAmountHuman, accuracy: 0.01)
    }
}


