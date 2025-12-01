//
//  Token.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

struct Token: Identifiable, Codable, Hashable {
    let id: String
    let symbol: String
    let name: String
    let decimals: Int
    let chainId: String
    let address: String
    let logoUrl: String?
    
    var displayName: String {
        return "\(symbol) - \(name)"
    }
    
    static let supportedTokens: [String: [Token]] = [
        "ethereum": [
            Token(id: "usdt_eth", symbol: "USDT", name: "Tether USD", decimals: 6, chainId: "ethereum", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", logoUrl: nil),
            Token(id: "usdc_eth", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", logoUrl: nil),
            Token(id: "dai_eth", symbol: "DAI", name: "Dai Stablecoin", decimals: 18, chainId: "ethereum", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", logoUrl: nil)
        ],
        "bsc": [
            Token(id: "usdt_bsc", symbol: "USDT", name: "Tether USD", decimals: 18, chainId: "bsc", address: "0x55d398326f99059fF775485246999027B3197955", logoUrl: nil),
            Token(id: "busd_bsc", symbol: "BUSD", name: "Binance USD", decimals: 18, chainId: "bsc", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", logoUrl: nil)
        ],
        "polygon": [
            Token(id: "usdt_poly", symbol: "USDT", name: "Tether USD", decimals: 6, chainId: "polygon", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", logoUrl: nil),
            Token(id: "usdc_poly", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "polygon", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", logoUrl: nil)
        ],
        "arbitrum": [
            Token(id: "usdt_arb", symbol: "USDT", name: "Tether USD", decimals: 6, chainId: "arbitrum", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", logoUrl: nil),
            Token(id: "usdc_arb", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "arbitrum", address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", logoUrl: nil)
        ],
        "optimism": [
            Token(id: "usdt_opt", symbol: "USDT", name: "Tether USD", decimals: 6, chainId: "optimism", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", logoUrl: nil),
            Token(id: "usdc_opt", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "optimism", address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", logoUrl: nil)
        ],
        "base": [
            Token(id: "usdc_base", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", logoUrl: nil)
        ],
        "solana": [
            Token(id: "usdt_sol", symbol: "USDT", name: "Tether USD", decimals: 6, chainId: "solana", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", logoUrl: nil),
            Token(id: "usdc_sol", symbol: "USDC", name: "USD Coin", decimals: 6, chainId: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", logoUrl: nil)
        ]
    ]
    
    static func getTokens(for chainId: String) -> [Token] {
        return supportedTokens[chainId] ?? []
    }
    
    static func getToken(symbol: String, chainId: String) -> Token? {
        return getTokens(for: chainId).first { $0.symbol.uppercased() == symbol.uppercased() }
    }
}


