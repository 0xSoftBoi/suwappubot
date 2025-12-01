//
//  SwapViewModelTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

@MainActor
final class SwapViewModelTests: XCTestCase {
    var viewModel: SwapViewModel!
    
    override func setUp() {
        super.setUp()
        viewModel = SwapViewModel()
    }
    
    override func tearDown() {
        viewModel = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertNil(viewModel.fromChain)
        XCTAssertNil(viewModel.toChain)
        XCTAssertNil(viewModel.fromToken)
        XCTAssertNil(viewModel.toToken)
        XCTAssertEqual(viewModel.amount, "")
        XCTAssertNil(viewModel.selectedWallet)
        XCTAssertNil(viewModel.quote)
        XCTAssertFalse(viewModel.isLoadingQuote)
        XCTAssertFalse(viewModel.isExecutingSwap)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.slippage, 0.5)
    }
    
    func testCanGetQuote_WithAllFields() {
        // Given
        viewModel.fromChain = Chain.supportedChains.first
        viewModel.toChain = Chain.supportedChains.last
        viewModel.fromToken = Token.getTokens(for: "ethereum").first
        viewModel.toToken = Token.getTokens(for: "ethereum").last
        viewModel.amount = "100"
        viewModel.selectedWallet = Wallet(
            id: 1,
            userId: 1,
            name: "Test",
            address: "0x123",
            chainType: .evm,
            isActive: true,
            isDefault: true,
            createdAt: Date()
        )
        
        // Then
        XCTAssertTrue(viewModel.canGetQuote)
    }
    
    func testCanGetQuote_MissingFields() {
        // Given - missing chain
        viewModel.fromToken = Token.getTokens(for: "ethereum").first
        viewModel.amount = "100"
        
        // Then
        XCTAssertFalse(viewModel.canGetQuote)
    }
    
    func testCanGetQuote_EmptyAmount() {
        // Given
        viewModel.fromChain = Chain.supportedChains.first
        viewModel.toChain = Chain.supportedChains.last
        viewModel.fromToken = Token.getTokens(for: "ethereum").first
        viewModel.toToken = Token.getTokens(for: "ethereum").last
        viewModel.amount = ""
        
        // Then
        XCTAssertFalse(viewModel.canGetQuote)
    }
    
    func testReset() {
        // Given
        viewModel.fromChain = Chain.supportedChains.first
        viewModel.toChain = Chain.supportedChains.last
        viewModel.fromToken = Token.getTokens(for: "ethereum").first
        viewModel.amount = "100"
        viewModel.errorMessage = "Test error"
        
        // When
        viewModel.reset()
        
        // Then
        XCTAssertNil(viewModel.fromChain)
        XCTAssertNil(viewModel.toChain)
        XCTAssertNil(viewModel.fromToken)
        XCTAssertNil(viewModel.toToken)
        XCTAssertEqual(viewModel.amount, "")
        XCTAssertNil(viewModel.quote)
        XCTAssertNil(viewModel.errorMessage)
    }
}


