//
//  PortfolioViewModel.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

struct Portfolio: Codable {
    let totalUSD: Double
    let tokens: [TokenBalance]
    let chains: [String: Double]
}

@MainActor
class PortfolioViewModel: ObservableObject {
    @Published var portfolio: Portfolio?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService: APIServiceProtocol
    
    init(apiService: APIServiceProtocol = APIService.shared) {
        self.apiService = apiService
    }
    
    func loadPortfolio() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await apiService.getPortfolio()
            portfolio = Portfolio(
                totalUSD: response.totalUSD,
                tokens: response.tokens,
                chains: response.chains
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
}


