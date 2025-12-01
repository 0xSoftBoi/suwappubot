//
//  HistoryViewModel.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

@MainActor
class HistoryViewModel: ObservableObject {
    @Published var swaps: [SwapTransaction] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService: APIServiceProtocol
    
    init(apiService: APIServiceProtocol = APIService.shared) {
        self.apiService = apiService
    }
    
    func loadSwaps() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await apiService.getSwaps()
            swaps = response.swaps
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
}


