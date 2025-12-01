//
//  AuthViewModel.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService: APIServiceProtocol
    private let keychainService: KeychainService
    private let authService: AuthService
    
    init(
        apiService: APIServiceProtocol = APIService.shared,
        keychainService: KeychainService = .shared,
        authService: AuthService = .shared
    ) {
        self.apiService = apiService
        self.keychainService = keychainService
        self.authService = authService
        checkAuthenticationStatus()
    }
    
    func checkAuthenticationStatus() {
        if let token = keychainService.getAccessToken() {
            apiService.setAccessToken(token)
            // TODO: Validate token by fetching user profile
            // For now, assume authenticated if token exists
            isAuthenticated = true
        }
    }
    
    func login(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await apiService.login(email: email, password: password)
            
            // Save tokens
            keychainService.saveAccessToken(response.accessToken)
            keychainService.saveRefreshToken(response.refreshToken)
            apiService.setAccessToken(response.accessToken)
            
            currentUser = response.user
            isAuthenticated = true
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func register(_ request: RegisterRequest) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await apiService.register(request)
            
            // Save tokens
            keychainService.saveAccessToken(response.accessToken)
            keychainService.saveRefreshToken(response.refreshToken)
            apiService.setAccessToken(response.accessToken)
            
            currentUser = response.user
            isAuthenticated = true
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func logout() {
        keychainService.clearTokens()
        apiService.clearAccessToken()
        currentUser = nil
        isAuthenticated = false
    }
    
    func authenticateWithBiometrics() async -> Bool {
        return await authService.authenticateWithBiometrics(reason: "Authenticate to access your wallet")
    }
}


