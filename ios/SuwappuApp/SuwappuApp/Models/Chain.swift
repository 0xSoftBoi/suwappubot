//
//  Chain.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

enum ChainType: String, Codable {
    case evm = "evm"
    case solana = "solana"
}

struct Chain: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let displayName: String
    let chainType: ChainType
    let nativeToken: String
    let nativeDecimals: Int
    let explorerUrl: String
    let logoEmoji: String
    let chainId: ChainId
    
    enum ChainId: Codable, Hashable {
        case evm(Int)
        case solana(String)
        
        var value: String {
            switch self {
            case .evm(let int):
                return String(int)
            case .solana(let string):
                return string
            }
        }
    }
    
    static let supportedChains: [Chain] = [
        Chain(
            id: "ethereum",
            name: "ethereum",
            displayName: "Ethereum",
            chainType: .evm,
            nativeToken: "ETH",
            nativeDecimals: 18,
            explorerUrl: "https://etherscan.io",
            logoEmoji: "🔷",
            chainId: .evm(1)
        ),
        Chain(
            id: "bsc",
            name: "bsc",
            displayName: "BNB Chain",
            chainType: .evm,
            nativeToken: "BNB",
            nativeDecimals: 18,
            explorerUrl: "https://bscscan.com",
            logoEmoji: "🟡",
            chainId: .evm(56)
        ),
        Chain(
            id: "polygon",
            name: "polygon",
            displayName: "Polygon",
            chainType: .evm,
            nativeToken: "MATIC",
            nativeDecimals: 18,
            explorerUrl: "https://polygonscan.com",
            logoEmoji: "🟣",
            chainId: .evm(137)
        ),
        Chain(
            id: "arbitrum",
            name: "arbitrum",
            displayName: "Arbitrum",
            chainType: .evm,
            nativeToken: "ETH",
            nativeDecimals: 18,
            explorerUrl: "https://arbiscan.io",
            logoEmoji: "🔵",
            chainId: .evm(42161)
        ),
        Chain(
            id: "optimism",
            name: "optimism",
            displayName: "Optimism",
            chainType: .evm,
            nativeToken: "ETH",
            nativeDecimals: 18,
            explorerUrl: "https://optimistic.etherscan.io",
            logoEmoji: "🔴",
            chainId: .evm(10)
        ),
        Chain(
            id: "base",
            name: "base",
            displayName: "Base",
            chainType: .evm,
            nativeToken: "ETH",
            nativeDecimals: 18,
            explorerUrl: "https://basescan.org",
            logoEmoji: "🔵",
            chainId: .evm(8453)
        ),
        Chain(
            id: "solana",
            name: "solana",
            displayName: "Solana",
            chainType: .solana,
            nativeToken: "SOL",
            nativeDecimals: 9,
            explorerUrl: "https://solscan.io",
            logoEmoji: "🟢",
            chainId: .solana("solana")
        )
    ]
    
    static func getChain(byId id: String) -> Chain? {
        return supportedChains.first { $0.id == id }
    }
    
    static func getChain(byName name: String) -> Chain? {
        return supportedChains.first { $0.name.lowercased() == name.lowercased() }
    }
}


