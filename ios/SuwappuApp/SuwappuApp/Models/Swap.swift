//
//  Swap.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

enum SwapStatus: String, Codable {
    case pending = "pending"
    case quoteReceived = "quote_received"
    case awaitingApproval = "awaiting_approval"
    case approved = "approved"
    case executing = "executing"
    case submitted = "submitted"
    case confirming = "confirming"
    case completed = "completed"
    case failed = "failed"
    case cancelled = "cancelled"
    
    var displayName: String {
        switch self {
        case .pending: return "Pending"
        case .quoteReceived: return "Quote Received"
        case .awaitingApproval: return "Awaiting Approval"
        case .approved: return "Approved"
        case .executing: return "Executing"
        case .submitted: return "Submitted"
        case .confirming: return "Confirming"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }
    
    var isCompleted: Bool {
        return self == .completed
    }
    
    var isFailed: Bool {
        return self == .failed || self == .cancelled
    }
    
    var isPending: Bool {
        return [.pending, .quoteReceived, .awaitingApproval, .approved, .executing, .submitted, .confirming].contains(self)
    }
}

struct SwapTransaction: Identifiable, Codable {
    let id: Int
    let userId: Int
    let fromChain: String
    let fromToken: String
    let fromAmount: String
    let fromAmountUSD: Double?
    let toChain: String
    let toToken: String
    let toAmount: String?
    let toAmountUSD: Double?
    let status: SwapStatus
    let txHash: String?
    let bridgeTxHash: String?
    let destinationTxHash: String?
    let routeProvider: String?
    let gasFee: Double?
    let bridgeFee: Double?
    let slippage: Int
    let createdAt: Date
    let updatedAt: Date
    let completedAt: Date?
    let errorMessage: String?
    
    var isCrossChain: Bool {
        return fromChain != toChain
    }
}

struct SwapQuote: Codable {
    let provider: String // "lifi", "jupiter", "layerzero", "ccip"
    let fromChain: String
    let toChain: String
    let fromToken: String
    let toToken: String
    let fromAmount: String
    let fromAmountHuman: Double
    let toAmount: String
    let toAmountHuman: Double
    let toAmountMin: String
    let gasCostUSD: Double
    let feeCostUSD: Double
    let totalCostUSD: Double
    let estimatedTime: Int // seconds
    let priceImpact: Double
    let exchangeRate: Double
    let expiresIn: Int // seconds
    let timestamp: Date
}

struct SwapQuoteRequest: Codable {
    let fromChain: String
    let toChain: String
    let fromToken: String
    let toToken: String
    let amount: Double
    let fromAddress: String
    let toAddress: String?
    let slippage: Double // percentage
}

struct ExecuteSwapRequest: Codable {
    let quote: SwapQuote
    let walletId: Int
}

struct SwapHistoryResponse: Codable {
    let swaps: [SwapTransaction]
    let total: Int
    let page: Int
    let pageSize: Int
}


