//
//  SwapView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct SwapView: View {
    @StateObject private var viewModel = SwapViewModel()
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: Spacing.xl) {
                    // From Token Selection
                    TokenInputCard(
                        title: "From",
                        chain: $viewModel.fromChain,
                        token: $viewModel.fromToken,
                        amount: $viewModel.amount,
                        showAmountInput: true
                    )
                    
                    // Minimal swap button
                    Button(action: {
                        swapTokens()
                    }) {
                        Image(systemName: "arrow.up.arrow.down")
                            .font(.title3)
                            .foregroundColor(BrandColors.accent)
                            .frame(width: 48, height: 48)
                            .background(BrandColors.secondaryBackground)
                            .clipShape(Circle())
                    }
                    .padding(.vertical, Spacing.sm)
                    
                    // To Token Selection
                    TokenInputCard(
                        title: "To",
                        chain: $viewModel.toChain,
                        token: $viewModel.toToken,
                        amount: .constant(""),
                        showAmountInput: false
                    )
                    
                    // Quote Display
                    if let quote = viewModel.quote {
                        QuoteView(quote: quote)
                    }
                    
                    // Get Quote Button
                    Button(action: {
                        Task {
                            await viewModel.getQuote()
                        }
                    }) {
                        Group {
                            if viewModel.isLoadingQuote {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Get Quote")
                                    .font(BrandTypography.headline)
                                    .foregroundColor(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(viewModel.canGetQuote ? BrandColors.accent : Color.gray)
                        .cornerRadius(12)
                    }
                    .disabled(!viewModel.canGetQuote || viewModel.isLoadingQuote)
                    
                    if let error = viewModel.errorMessage {
                        Text(error)
                            .foregroundColor(.red)
                            .font(BrandTypography.small)
                            .padding(.top, Spacing.sm)
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.xl)
            }
            .background(BrandColors.background)
            .navigationTitle("Swap")
        }
    }
    
    private func swapTokens() {
        let tempChain = viewModel.fromChain
        let tempToken = viewModel.fromToken
        
        viewModel.fromChain = viewModel.toChain
        viewModel.fromToken = viewModel.toToken
        viewModel.toChain = tempChain
        viewModel.toToken = tempToken
    }
}

// MARK: - Token Input Card

struct TokenInputCard: View {
    let title: String
    @Binding var chain: Chain?
    @Binding var token: Token?
    @Binding var amount: String
    let showAmountInput: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(title)
                .font(BrandTypography.caption)
                .foregroundColor(BrandColors.textSecondary)
            
            // Chain Selection
            NavigationLink(destination: ChainSelectionView(selectedChain: $chain)) {
                HStack {
                    if let chain = chain {
                        Text(chain.logoEmoji)
                            .font(.title3)
                        Text(chain.displayName)
                            .font(BrandTypography.body)
                            .foregroundColor(BrandColors.textPrimary)
                    } else {
                        Text("Select Chain")
                            .font(BrandTypography.body)
                            .foregroundColor(BrandColors.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(BrandColors.textSecondary)
                }
                .padding(Spacing.lg)
                .background(BrandColors.secondaryBackground)
                .cornerRadius(12)
            }
            
            // Token Selection
            if let selectedChain = chain {
                NavigationLink(destination: TokenListView(chain: selectedChain, selectedToken: $token)) {
                    HStack {
                        if let token = token {
                            Text(token.symbol)
                                .font(BrandTypography.body)
                                .foregroundColor(BrandColors.textPrimary)
                        } else {
                            Text("Select Token")
                                .font(BrandTypography.body)
                                .foregroundColor(BrandColors.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(BrandColors.textSecondary)
                    }
                    .padding(Spacing.lg)
                    .background(BrandColors.secondaryBackground)
                    .cornerRadius(12)
                }
            }
            
            // Amount Input
            if showAmountInput {
                TextField("Amount", text: $amount)
                    .font(BrandTypography.title)
                    .keyboardType(.decimalPad)
                    .padding(.top, Spacing.md)
            }
        }
    }
}

// MARK: - Chain Selection View

struct ChainSelectionView: View {
    @Binding var selectedChain: Chain?
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        List(Chain.supportedChains) { chain in
            Button(action: {
                selectedChain = chain
                dismiss()
            }) {
                HStack {
                    Text(chain.logoEmoji)
                        .font(.title3)
                    Text(chain.displayName)
                        .font(BrandTypography.body)
                        .foregroundColor(BrandColors.textPrimary)
                    Spacer()
                    if selectedChain?.id == chain.id {
                        Image(systemName: "checkmark")
                            .font(.caption)
                            .foregroundColor(BrandColors.accent)
                    }
                }
            }
        }
        .navigationTitle("Select Chain")
    }
}

// MARK: - Token List View

struct TokenListView: View {
    let chain: Chain
    @Binding var selectedToken: Token?
    @Environment(\.dismiss) var dismiss
    
    var tokens: [Token] {
        Token.getTokens(for: chain.id)
    }
    
    var body: some View {
        List(tokens) { token in
            Button(action: {
                selectedToken = token
                dismiss()
            }) {
                HStack {
                    Text(token.symbol)
                        .font(BrandTypography.headline)
                        .foregroundColor(BrandColors.textPrimary)
                    Text(token.name)
                        .font(BrandTypography.body)
                        .foregroundColor(BrandColors.textSecondary)
                    Spacer()
                    if selectedToken?.id == token.id {
                        Image(systemName: "checkmark")
                            .font(.caption)
                            .foregroundColor(BrandColors.accent)
                    }
                }
            }
        }
        .navigationTitle("Select Token")
    }
}

// MARK: - Quote View

struct QuoteView: View {
    let quote: SwapQuote
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Quote")
                .font(BrandTypography.headline)
                .foregroundColor(BrandColors.textPrimary)
                .padding(.bottom, Spacing.sm)
            
            VStack(spacing: Spacing.md) {
                HStack {
                    Text("You send")
                        .font(BrandTypography.caption)
                        .foregroundColor(BrandColors.textSecondary)
                    Spacer()
                    Text("\(quote.fromAmountHuman, specifier: "%.4f") \(quote.fromToken)")
                        .font(BrandTypography.body)
                        .foregroundColor(BrandColors.textPrimary)
                }
                
                HStack {
                    Text("You receive")
                        .font(BrandTypography.caption)
                        .foregroundColor(BrandColors.textSecondary)
                    Spacer()
                    Text("\(quote.toAmountHuman, specifier: "%.4f") \(quote.toToken)")
                        .font(BrandTypography.headline)
                        .foregroundColor(BrandColors.textPrimary)
                }
                
                Divider()
                    .padding(.vertical, Spacing.sm)
                
                HStack {
                    Text("Total Cost")
                        .font(BrandTypography.caption)
                        .foregroundColor(BrandColors.textSecondary)
                    Spacer()
                    Text("$\(quote.totalCostUSD, specifier: "%.2f")")
                        .font(BrandTypography.body)
                        .foregroundColor(BrandColors.textPrimary)
                }
                
                if quote.priceImpact > 0 {
                    HStack {
                        Text("Price Impact")
                            .font(BrandTypography.caption)
                            .foregroundColor(BrandColors.textSecondary)
                        Spacer()
                        Text("\(quote.priceImpact, specifier: "%.2f")%")
                            .font(BrandTypography.caption)
                            .foregroundColor(quote.priceImpact > 1 ? .red : BrandColors.textSecondary)
                    }
                }
            }
        }
        .padding(Spacing.xl)
        .background(BrandColors.secondaryBackground)
        .cornerRadius(16)
    }
}

#Preview {
    SwapView()
        .environmentObject(AppState())
}
