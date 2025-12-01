//
//  Wallet.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

struct Wallet: Identifiable, Codable {
    let id: Int
    let userId: Int
    let name: String
    let address: String
    let chainType: ChainType
    let isActive: Bool
    let isDefault: Bool
    let createdAt: Date
    
    // Note: encryptedPrivateKey should never be sent to/from API
    // It's stored locally in Keychain only
}

struct WalletBalance: Codable {
    let walletId: Int
    let chainId: String
    let tokens: [TokenBalance]
    let totalUSD: Double
}

struct TokenBalance: Codable, Identifiable {
    let id: String
    let token: Token
    let balance: String // Raw balance string
    let balanceHuman: Double // Human-readable balance
    let balanceUSD: Double
    let chainId: String
}

struct CreateWalletRequest: Codable {
    let name: String
    let chainType: ChainType
}

struct ImportWalletRequest: Codable {
    let name: String
    let privateKey: String // Will be encrypted before sending
    let chainType: ChainType
}


