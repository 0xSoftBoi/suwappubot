//
//  WalletsViewModel.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

@MainActor
class WalletsViewModel: ObservableObject {
    @Published var wallets: [Wallet] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService: APIServiceProtocol
    
    init(apiService: APIServiceProtocol = APIService.shared) {
        self.apiService = apiService
    }
    
    func loadWallets() async {
        isLoading = true
        errorMessage = nil
        
        do {
            wallets = try await apiService.getWallets()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func createWallet(name: String, chainType: ChainType) async {
        isLoading = true
        errorMessage = nil
        
        let request = CreateWalletRequest(name: name, chainType: chainType)
        
        do {
            let wallet = try await apiService.createWallet(request)
            wallets.append(wallet)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func importWallet(name: String, privateKey: String, chainType: ChainType) async {
        isLoading = true
        errorMessage = nil
        
        // TODO: Encrypt private key before sending
        let request = ImportWalletRequest(name: name, privateKey: privateKey, chainType: chainType)
        
        do {
            let wallet = try await apiService.importWallet(request)
            wallets.append(wallet)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
}


