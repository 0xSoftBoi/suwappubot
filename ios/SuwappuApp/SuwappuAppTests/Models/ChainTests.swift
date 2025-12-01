//
//  ChainTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

final class ChainTests: XCTestCase {
    
    func testGetChainById() {
        // When
        let chain = Chain.getChain(byId: "ethereum")
        
        // Then
        XCTAssertNotNil(chain)
        XCTAssertEqual(chain?.id, "ethereum")
        XCTAssertEqual(chain?.displayName, "Ethereum")
    }
    
    func testGetChainById_Invalid() {
        // When
        let chain = Chain.getChain(byId: "invalid_chain")
        
        // Then
        XCTAssertNil(chain)
    }
    
    func testGetChainByName() {
        // When
        let chain = Chain.getChain(byName: "ethereum")
        
        // Then
        XCTAssertNotNil(chain)
        XCTAssertEqual(chain?.id, "ethereum")
    }
    
    func testGetChainByName_CaseInsensitive() {
        // When
        let chain = Chain.getChain(byName: "ETHEREUM")
        
        // Then
        XCTAssertNotNil(chain)
        XCTAssertEqual(chain?.id, "ethereum")
    }
    
    func testSupportedChains_NotEmpty() {
        // Then
        XCTAssertFalse(Chain.supportedChains.isEmpty)
    }
    
    func testSupportedChains_ContainsEthereum() {
        // When
        let hasEthereum = Chain.supportedChains.contains { $0.id == "ethereum" }
        
        // Then
        XCTAssertTrue(hasEthereum)
    }
    
    func testSupportedChains_ContainsSolana() {
        // When
        let hasSolana = Chain.supportedChains.contains { $0.id == "solana" }
        
        // Then
        XCTAssertTrue(hasSolana)
    }
    
    func testChainProperties() {
        // Given
        let chain = Chain.supportedChains.first!
        
        // Then
        XCTAssertFalse(chain.id.isEmpty)
        XCTAssertFalse(chain.name.isEmpty)
        XCTAssertFalse(chain.displayName.isEmpty)
        XCTAssertFalse(chain.nativeToken.isEmpty)
        XCTAssertFalse(chain.explorerUrl.isEmpty)
    }
}


