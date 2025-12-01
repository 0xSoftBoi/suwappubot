//
//  SakuraCard.swift
//  SuwappuApp
//
//  Created on [Date]
//  Minimalist card component
//

import SwiftUI

// MARK: - Card View

struct SakuraCard<Content: View>: View {
    let content: Content
    var showAccent: Bool
    
    init(showAccent: Bool = false, @ViewBuilder content: () -> Content) {
        self.showAccent = showAccent
        self.content = content()
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if showAccent {
                HStack {
                    Text("🌸")
                        .font(.caption)
                    Spacer()
                }
            }
            
            content
        }
        .padding(Spacing.xl)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(BrandColors.secondaryBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.gray.opacity(0.1), lineWidth: 1)
        )
    }
}

// MARK: - Info Card

struct InfoCard: View {
    let title: String
    let value: String
    let subtitle: String?
    
    init(title: String, value: String, subtitle: String? = nil) {
        self.title = title
        self.value = value
        self.subtitle = subtitle
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(BrandTypography.caption)
                .foregroundColor(BrandColors.textSecondary)
            
            Text(value)
                .font(BrandTypography.title)
                .foregroundColor(BrandColors.textPrimary)
            
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(BrandTypography.small)
                    .foregroundColor(BrandColors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.lg)
        .background(BrandColors.secondaryBackground)
        .cornerRadius(12)
    }
}

// MARK: - List Row Card

struct ListRowCard<Content: View>: View {
    let content: Content
    
    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }
    
    var body: some View {
        HStack {
            content
        }
        .padding(Spacing.lg)
        .background(BrandColors.secondaryBackground)
        .cornerRadius(12)
    }
}

#Preview {
    VStack(spacing: 20) {
        SakuraCard(showAccent: true) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Card Title")
                    .font(BrandTypography.headline)
                Text("Card content goes here")
                    .font(BrandTypography.body)
                    .foregroundColor(BrandColors.textSecondary)
            }
        }
        
        InfoCard(
            title: "Total Balance",
            value: "$12,345.67",
            subtitle: "+2.5% today"
        )
        
        ListRowCard {
            Text("🌸")
            Text("List Item")
                .font(BrandTypography.body)
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundColor(BrandColors.textSecondary)
        }
    }
    .padding()
}
