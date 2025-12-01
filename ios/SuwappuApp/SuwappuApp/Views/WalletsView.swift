//
//  WalletsView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct WalletsView: View {
    @StateObject private var viewModel = WalletsViewModel()
    @EnvironmentObject var appState: AppState
    @State private var showingCreateWallet = false
    @State private var showingImportWallet = false
    
    var body: some View {
        NavigationView {
            List {
                ForEach(viewModel.wallets) { wallet in
                    WalletRowView(wallet: wallet)
                        .onTapGesture {
                            appState.setSelectedWallet(wallet)
                        }
                }
                .onDelete(perform: deleteWallets)
            }
            .navigationTitle("Wallets")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            showingCreateWallet = true
                        }) {
                            Label("Create Wallet", systemImage: "plus")
                        }
                        
                        Button(action: {
                            showingImportWallet = true
                        }) {
                            Label("Import Wallet", systemImage: "square.and.arrow.down")
                        }
                    } label: {
                        Image(systemName: "plus")
                            .foregroundColor(BrandColors.accent)
                    }
                }
            }
            .sheet(isPresented: $showingCreateWallet) {
                CreateWalletView()
            }
            .sheet(isPresented: $showingImportWallet) {
                ImportWalletView()
            }
            .refreshable {
                await viewModel.loadWallets()
            }
            .task {
                await viewModel.loadWallets()
            }
        }
    }
    
    private func deleteWallets(at offsets: IndexSet) {
        // TODO: Implement delete
    }
}

struct WalletRowView: View {
    let wallet: Wallet
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text(wallet.name)
                    .font(BrandTypography.headline)
                    .foregroundColor(BrandColors.textPrimary)
                Spacer()
                if wallet.isDefault {
                    Text("Default")
                        .font(BrandTypography.small)
                        .foregroundColor(BrandColors.accent)
                }
            }
            
            Text(wallet.address)
                .font(BrandTypography.caption)
                .foregroundColor(BrandColors.textSecondary)
            
            Text(wallet.chainType.rawValue.uppercased())
                .font(BrandTypography.small)
                .foregroundColor(BrandColors.textSecondary)
        }
        .padding(.vertical, Spacing.md)
    }
}

struct CreateWalletView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel = WalletsViewModel()
    @State private var walletName = "My Wallet"
    @State private var selectedChainType: ChainType = .evm
    
    var body: some View {
        NavigationView {
            Form {
                Section("Wallet Details") {
                    TextField("Wallet Name", text: $walletName)
                    
                    Picker("Chain Type", selection: $selectedChainType) {
                        Text("EVM").tag(ChainType.evm)
                        Text("Solana").tag(ChainType.solana)
                    }
                }
                
                    Button(action: {
                        Task {
                            await viewModel.createWallet(name: walletName, chainType: selectedChainType)
                            dismiss()
                        }
                    }) {
                        Text("Create Wallet")
                            .font(BrandTypography.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(BrandColors.accent)
                            .cornerRadius(12)
                    }
            }
            .navigationTitle("Create Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct ImportWalletView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel = WalletsViewModel()
    @State private var walletName = "Imported Wallet"
    @State private var privateKey = ""
    @State private var selectedChainType: ChainType = .evm
    
    var body: some View {
        NavigationView {
            Form {
                Section("Wallet Details") {
                    TextField("Wallet Name", text: $walletName)
                    
                    SecureField("Private Key", text: $privateKey)
                    
                    Picker("Chain Type", selection: $selectedChainType) {
                        Text("EVM").tag(ChainType.evm)
                        Text("Solana").tag(ChainType.solana)
                    }
                }
                
                Button(action: {
                    Task {
                        await viewModel.importWallet(name: walletName, privateKey: privateKey, chainType: selectedChainType)
                        dismiss()
                    }
                }) {
                    Text("Import Wallet")
                        .font(BrandTypography.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(privateKey.isEmpty ? Color.gray : BrandColors.accent)
                        .cornerRadius(12)
                }
                .disabled(privateKey.isEmpty)
            }
            .navigationTitle("Import Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    WalletsView()
        .environmentObject(AppState())
}

