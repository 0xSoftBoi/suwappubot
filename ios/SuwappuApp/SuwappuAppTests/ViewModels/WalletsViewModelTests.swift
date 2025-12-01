//
//  WalletsViewModelTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

@MainActor
final class WalletsViewModelTests: XCTestCase {
    var viewModel: WalletsViewModel!
    
    override func setUp() {
        super.setUp()
        viewModel = WalletsViewModel()
    }
    
    override func tearDown() {
        viewModel = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertTrue(viewModel.wallets.isEmpty)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }
    
    func testLoadWallets_Success() async {
        // Given
        // Note: Would need to inject MockAPIService
        
        // When
        await viewModel.loadWallets()
        
        // Then
        // In real implementation with mock, verify wallets are loaded
        XCTAssertFalse(viewModel.isLoading)
    }
    
    func testCreateWallet() async {
        // Given
        let name = "New Wallet"
        let chainType = ChainType.evm
        
        // When
        await viewModel.createWallet(name: name, chainType: chainType)
        
        // Then
        XCTAssertFalse(viewModel.isLoading)
        // In real implementation, verify wallet is added to list
    }
    
    func testImportWallet() async {
        // Given
        let name = "Imported Wallet"
        let privateKey = "0x1234567890abcdef"
        let chainType = ChainType.evm
        
        // When
        await viewModel.importWallet(name: name, privateKey: privateKey, chainType: chainType)
        
        // Then
        XCTAssertFalse(viewModel.isLoading)
        // In real implementation, verify wallet is added
    }
}


