//
//  HistoryView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct HistoryView: View {
    @StateObject private var viewModel = HistoryViewModel()
    
    var body: some View {
        NavigationView {
            List {
                ForEach(viewModel.swaps) { swap in
                    SwapRowView(swap: swap)
                }
            }
            .navigationTitle("History")
            .refreshable {
                await viewModel.loadSwaps()
            }
            .task {
                await viewModel.loadSwaps()
            }
        }
    }
}

struct SwapRowView: View {
    let swap: SwapTransaction
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text("\(swap.fromToken) → \(swap.toToken)")
                    .font(BrandTypography.headline)
                    .foregroundColor(BrandColors.textPrimary)
                Spacer()
                StatusBadge(status: swap.status)
            }
            
            Text("\(swap.fromChain) → \(swap.toChain)")
                .font(BrandTypography.caption)
                .foregroundColor(BrandColors.textSecondary)
            
            if let fromAmount = Double(swap.fromAmount) {
                Text("\(fromAmount, specifier: "%.4f") \(swap.fromToken)")
                    .font(BrandTypography.body)
                    .foregroundColor(BrandColors.textPrimary)
            }
            
            if let txHash = swap.txHash {
                Link("View on Explorer", destination: URL(string: getExplorerURL(for: swap.fromChain, txHash: txHash))!)
                    .font(BrandTypography.small)
                    .foregroundColor(BrandColors.accent)
            }
        }
        .padding(.vertical, Spacing.md)
    }
    
    private func getExplorerURL(for chainId: String, txHash: String) -> String {
        if let chain = Chain.getChain(byId: chainId) {
            return "\(chain.explorerUrl)/tx/\(txHash)"
        }
        return ""
    }
}

struct StatusBadge: View {
    let status: SwapStatus
    
    var color: Color {
        switch status {
        case .completed:
            return BrandColors.accent
        case .failed, .cancelled:
            return .red
        case .pending, .confirming, .submitted:
            return .orange
        default:
            return .gray
        }
    }
    
    var body: some View {
        Text(status.displayName)
            .font(BrandTypography.small)
            .foregroundColor(color)
    }
}

#Preview {
    HistoryView()
}

