//
//  KeychainService.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import Security

class KeychainService {
    static let shared = KeychainService()
    
    private let service = "com.suwappu.app"
    
    private init() {}
    
    func initialize() {
        // Keychain is ready to use
    }
    
    // MARK: - Token Storage
    
    @discardableResult
    func saveAccessToken(_ token: String) -> Bool {
        return save(key: "accessToken", value: token)
    }
    
    func getAccessToken() -> String? {
        return get(key: "accessToken")
    }
    
    @discardableResult
    func saveRefreshToken(_ token: String) -> Bool {
        return save(key: "refreshToken", value: token)
    }
    
    func getRefreshToken() -> String? {
        return get(key: "refreshToken")
    }
    
    func clearTokens() {
        delete(key: "accessToken")
        delete(key: "refreshToken")
    }
    
    // MARK: - Wallet Private Keys
    
    @discardableResult
    func savePrivateKey(walletId: Int, encryptedKey: String) -> Bool {
        return save(key: "wallet_\(walletId)_key", value: encryptedKey)
    }
    
    func getPrivateKey(walletId: Int) -> String? {
        return get(key: "wallet_\(walletId)_key")
    }
    
    func deletePrivateKey(walletId: Int) {
        delete(key: "wallet_\(walletId)_key")
    }
    
    // MARK: - Generic Keychain Operations
    
    private func save(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else {
            return false
        }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        
        // Delete existing item first
        SecItemDelete(query as CFDictionary)
        
        // Add new item
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }
    
    private func get(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return value
    }
    
    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}

