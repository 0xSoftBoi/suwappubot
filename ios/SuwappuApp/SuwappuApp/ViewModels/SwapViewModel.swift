//
//  SwapViewModel.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

@MainActor
class SwapViewModel: ObservableObject {
    @Published var fromChain: Chain?
    @Published var toChain: Chain?
    @Published var fromToken: Token?
    @Published var toToken: Token?
    @Published var amount: String = ""
    @Published var selectedWallet: Wallet?
    
    @Published var quote: SwapQuote?
    @Published var isLoadingQuote = false
    @Published var isExecutingSwap = false
    @Published var currentSwap: SwapTransaction?
    @Published var errorMessage: String?
    
    @Published var slippage: Double = 0.5 // Default 0.5%
    
    private let apiService: APIServiceProtocol
    
    init(apiService: APIServiceProtocol = APIService.shared) {
        self.apiService = apiService
    }
    
    var canGetQuote: Bool {
        return fromChain != nil &&
               toChain != nil &&
               fromToken != nil &&
               toToken != nil &&
               !amount.isEmpty &&
               Double(amount) != nil &&
               selectedWallet != nil
    }
    
    func getQuote() async {
        guard canGetQuote,
              let fromChain = fromChain,
              let toChain = toChain,
              let fromToken = fromToken,
              let toToken = toToken,
              let amountValue = Double(amount),
              let wallet = selectedWallet else {
            return
        }
        
        isLoadingQuote = true
        errorMessage = nil
        
        let request = SwapQuoteRequest(
            fromChain: fromChain.id,
            toChain: toChain.id,
            fromToken: fromToken.symbol,
            toToken: toToken.symbol,
            amount: amountValue,
            fromAddress: wallet.address,
            toAddress: nil,
            slippage: slippage
        )
        
        do {
            quote = try await apiService.getQuote(request)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoadingQuote = false
    }
    
    func executeSwap() async -> Bool {
        guard let quote = quote,
              let wallet = selectedWallet else {
            return false
        }
        
        isExecutingSwap = true
        errorMessage = nil
        
        let request = ExecuteSwapRequest(
            quote: quote,
            walletId: wallet.id
        )
        
        do {
            currentSwap = try await apiService.executeSwap(request)
            isExecutingSwap = false
            return true
        } catch {
            errorMessage = error.localizedDescription
            isExecutingSwap = false
            return false
        }
    }
    
    func reset() {
        fromChain = nil
        toChain = nil
        fromToken = nil
        toToken = nil
        amount = ""
        quote = nil
        errorMessage = nil
    }
}


