//
//  KeychainServiceTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

final class KeychainServiceTests: XCTestCase {
    var keychain: MockKeychainService!
    
    override func setUp() {
        super.setUp()
        keychain = MockKeychainService.sharedMock
        keychain.clearTokens()
    }
    
    override func tearDown() {
        keychain.clearTokens()
        keychain = nil
        super.tearDown()
    }
    
    func testSaveAndGetAccessToken() {
        // Given
        let token = "test_access_token_123"
        
        // When
        let saved = keychain.saveAccessToken(token)
        let retrieved = keychain.getAccessToken()
        
        // Then
        XCTAssertTrue(saved)
        XCTAssertEqual(retrieved, token)
    }
    
    func testSaveAndGetRefreshToken() {
        // Given
        let token = "test_refresh_token_456"
        
        // When
        let saved = keychain.saveRefreshToken(token)
        let retrieved = keychain.getRefreshToken()
        
        // Then
        XCTAssertTrue(saved)
        XCTAssertEqual(retrieved, token)
    }
    
    func testClearTokens() {
        // Given
        keychain.saveAccessToken("token1")
        keychain.saveRefreshToken("token2")
        
        // When
        keychain.clearTokens()
        
        // Then
        XCTAssertNil(keychain.getAccessToken())
        XCTAssertNil(keychain.getRefreshToken())
    }
    
    func testSaveAndGetPrivateKey() {
        // Given
        let walletId = 1
        let encryptedKey = "encrypted_private_key_123"
        
        // When
        let saved = keychain.savePrivateKey(walletId: walletId, encryptedKey: encryptedKey)
        let retrieved = keychain.getPrivateKey(walletId: walletId)
        
        // Then
        XCTAssertTrue(saved)
        XCTAssertEqual(retrieved, encryptedKey)
    }
    
    func testDeletePrivateKey() {
        // Given
        let walletId = 1
        keychain.savePrivateKey(walletId: walletId, encryptedKey: "test_key")
        
        // When
        keychain.deletePrivateKey(walletId: walletId)
        
        // Then
        XCTAssertNil(keychain.getPrivateKey(walletId: walletId))
    }
    
    func testMultipleWallets() {
        // Given
        let wallet1Id = 1
        let wallet2Id = 2
        let key1 = "key1"
        let key2 = "key2"
        
        // When
        keychain.savePrivateKey(walletId: wallet1Id, encryptedKey: key1)
        keychain.savePrivateKey(walletId: wallet2Id, encryptedKey: key2)
        
        // Then
        XCTAssertEqual(keychain.getPrivateKey(walletId: wallet1Id), key1)
        XCTAssertEqual(keychain.getPrivateKey(walletId: wallet2Id), key2)
    }
}


