//
//  HistoryViewModelTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

@MainActor
final class HistoryViewModelTests: XCTestCase {
    var viewModel: HistoryViewModel!
    
    override func setUp() {
        super.setUp()
        viewModel = HistoryViewModel()
    }
    
    override func tearDown() {
        viewModel = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertTrue(viewModel.swaps.isEmpty)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }
    
    func testLoadSwaps() async {
        // Given
        // Note: Would need to inject MockAPIService
        
        // When
        await viewModel.loadSwaps()
        
        // Then
        XCTAssertFalse(viewModel.isLoading)
        // In real implementation with mock, verify swaps are loaded
    }
}


