//
//  AuthViewModelTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
@testable import SuwappuApp

@MainActor
final class AuthViewModelTests: XCTestCase {
    var viewModel: AuthViewModel!
    var mockKeychain: MockKeychainService!
    
    override func setUp() {
        super.setUp()
        mockKeychain = MockKeychainService.sharedMock
        mockKeychain.clearTokens()
        viewModel = AuthViewModel()
    }
    
    override func tearDown() {
        mockKeychain.clearTokens()
        viewModel = nil
        mockKeychain = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }
    
    func testCheckAuthenticationStatus_WithToken() {
        // Given
        mockKeychain.saveAccessToken("test_token")
        
        // When
        viewModel.checkAuthenticationStatus()
        
        // Then
        XCTAssertTrue(viewModel.isAuthenticated)
    }
    
    func testCheckAuthenticationStatus_WithoutToken() {
        // Given
        mockKeychain.clearTokens()
        
        // When
        viewModel.checkAuthenticationStatus()
        
        // Then
        XCTAssertFalse(viewModel.isAuthenticated)
    }
    
    func testLogin_Success() async {
        // Given
        let email = "test@example.com"
        let password = "password123"
        
        // When
        await viewModel.login(email: email, password: password)
        
        // Then
        XCTAssertTrue(viewModel.isAuthenticated)
        XCTAssertNotNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentUser?.email, email)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertNotNil(mockKeychain.getAccessToken())
    }
    
    func testLogin_Failure() async {
        // Given
        let email = "test@example.com"
        let password = "wrongpassword"
        // Note: In real implementation, you'd inject MockAPIService
        
        // When
        await viewModel.login(email: email, password: password)
        
        // Then
        // This will fail with real API, but demonstrates test structure
        // In real tests, you'd mock APIService to return error
    }
    
    func testRegister_Success() async {
        // Given
        let request = RegisterRequest(
            email: "newuser@example.com",
            password: "password123",
            username: "newuser",
            firstName: "New",
            lastName: "User"
        )
        
        // When
        await viewModel.register(request)
        
        // Then
        XCTAssertTrue(viewModel.isAuthenticated)
        XCTAssertNotNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentUser?.email, request.email)
        XCTAssertFalse(viewModel.isLoading)
    }
    
    func testLogout() {
        // Given
        mockKeychain.saveAccessToken("test_token")
        viewModel.isAuthenticated = true
        
        // When
        viewModel.logout()
        
        // Then
        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertNil(mockKeychain.getAccessToken())
    }
    
    func testLoadingState_DuringLogin() async {
        // Given
        let email = "test@example.com"
        let password = "password123"
        
        // When
        let task = Task {
            await viewModel.login(email: email, password: password)
        }
        
        // Then - check loading state immediately
        // Note: This is tricky with async, but demonstrates concept
        await task.value
        
        XCTAssertFalse(viewModel.isLoading)
    }
}


