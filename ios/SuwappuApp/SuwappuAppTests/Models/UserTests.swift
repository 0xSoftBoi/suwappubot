//
//  UserTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

final class UserTests: XCTestCase {
    
    func testDisplayName_WithFirstNameAndLastName() {
        // Given
        let user = User(
            id: 1,
            email: "test@example.com",
            username: "testuser",
            firstName: "John",
            lastName: "Doe",
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // Then
        XCTAssertEqual(user.displayName, "John Doe")
    }
    
    func testDisplayName_WithFirstNameOnly() {
        // Given
        let user = User(
            id: 1,
            email: "test@example.com",
            username: "testuser",
            firstName: "John",
            lastName: nil,
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // Then
        XCTAssertEqual(user.displayName, "John")
    }
    
    func testDisplayName_WithUsernameOnly() {
        // Given
        let user = User(
            id: 1,
            email: "test@example.com",
            username: "testuser",
            firstName: nil,
            lastName: nil,
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // Then
        XCTAssertEqual(user.displayName, "testuser")
    }
    
    func testDisplayName_WithEmailOnly() {
        // Given
        let user = User(
            id: 1,
            email: "test@example.com",
            username: nil,
            firstName: nil,
            lastName: nil,
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // Then
        XCTAssertEqual(user.displayName, "test@example.com")
    }
    
    func testDisplayName_Fallback() {
        // Given
        let user = User(
            id: 123,
            email: nil,
            username: nil,
            firstName: nil,
            lastName: nil,
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // Then
        XCTAssertEqual(user.displayName, "User 123")
    }
    
    func testUserCodable() throws {
        // Given
        let user = User(
            id: 1,
            email: "test@example.com",
            username: "testuser",
            firstName: "John",
            lastName: "Doe",
            defaultSlippage: 50,
            notificationsEnabled: true,
            twoFAEnabled: false,
            twoFAThreshold: 1000,
            createdAt: Date(),
            updatedAt: Date(),
            lastActiveAt: Date()
        )
        
        // When
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(user)
        
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decodedUser = try decoder.decode(User.self, from: data)
        
        // Then
        XCTAssertEqual(decodedUser.id, user.id)
        XCTAssertEqual(decodedUser.email, user.email)
        XCTAssertEqual(decodedUser.username, user.username)
        XCTAssertEqual(decodedUser.firstName, user.firstName)
        XCTAssertEqual(decodedUser.lastName, user.lastName)
    }
}


