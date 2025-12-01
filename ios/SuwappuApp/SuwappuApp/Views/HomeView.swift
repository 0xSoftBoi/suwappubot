//
//  HomeView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct HomeView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var portfolioViewModel = PortfolioViewModel()
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: Spacing.xl) {
                    // Portfolio Summary
                    PortfolioCardView(portfolio: portfolioViewModel.portfolio)
                        .padding(.top, Spacing.lg)
                    
                    // Quick Actions
                    QuickActionsView()
                    
                    // Recent Swaps
                    RecentSwapsView()
                }
                .padding(.horizontal, Spacing.lg)
            }
            .background(BrandColors.background)
            .refreshable {
                await portfolioViewModel.loadPortfolio()
            }
            .task {
                await portfolioViewModel.loadPortfolio()
            }
        }
    }
}

struct PortfolioCardView: View {
    let portfolio: Portfolio?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Total Portfolio Value")
                .font(.headline)
                .foregroundColor(.secondary)
            
            if let portfolio = portfolio {
                Text("$\(portfolio.totalUSD, specifier: "%.2f")")
                    .font(.system(size: 32, weight: .bold))
                
                HStack {
                    ForEach(Array(portfolio.chains.keys.prefix(3)), id: \.self) { chainId in
                        if let chain = Chain.getChain(byId: chainId) {
                            Text(chain.logoEmoji)
                                .font(.title2)
                        }
                    }
                    if portfolio.chains.count > 3 {
                        Text("+\(portfolio.chains.count - 3)")
                            .foregroundColor(.secondary)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct QuickActionsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Quick Actions")
                .font(BrandTypography.headline)
                .foregroundColor(BrandColors.textPrimary)
            
            HStack(spacing: Spacing.md) {
                QuickActionButton(icon: "arrow.triangle.2.circlepath", title: "Swap")
                QuickActionButton(icon: "wallet.pass.fill", title: "Wallets")
                QuickActionButton(icon: "bell.fill", title: "Alerts")
                QuickActionButton(icon: "chart.line.uptrend.xyaxis", title: "Portfolio")
            }
        }
    }
}

struct QuickActionButton: View {
    let icon: String
    let title: String
    
    var body: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(BrandColors.accent)
            
            Text(title)
                .font(BrandTypography.small)
                .foregroundColor(BrandColors.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.lg)
        .background(BrandColors.secondaryBackground)
        .cornerRadius(12)
    }
}

struct RecentSwapsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Recent Swaps")
                .font(BrandTypography.headline)
                .foregroundColor(BrandColors.textPrimary)
            
            // Placeholder for recent swaps
            Text("No recent swaps")
                .font(BrandTypography.body)
                .foregroundColor(BrandColors.textSecondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, Spacing.xl)
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AppState())
}

