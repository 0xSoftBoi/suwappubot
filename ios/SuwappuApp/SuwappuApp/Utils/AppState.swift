//
//  AppState.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import SwiftUI

class AppState: ObservableObject {
    @Published var wallets: [Wallet] = []
    @Published var selectedWallet: Wallet?
    @Published var isLoading = false
    
    func setSelectedWallet(_ wallet: Wallet?) {
        selectedWallet = wallet
    }
}


