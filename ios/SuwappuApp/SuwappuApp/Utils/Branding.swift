//
//  Branding.swift
//  SuwappuApp
//
//  Created on [Date]
//  Minimalist Design System
//

import SwiftUI

// MARK: - Brand Colors (Minimalist Sakura Theme)

struct BrandColors {
    // Subtle pink accent - used sparingly
    static let accent = Color(red: 0.95, green: 0.7, blue: 0.8)           // #F2B3CC - Subtle pink
    
    // Neutral colors
    static let background = Color(.systemBackground)
    static let secondaryBackground = Color(.secondarySystemBackground)
    static let textPrimary = Color.primary
    static let textSecondary = Color.secondary
    
    // Minimal gradient for buttons only
    static let buttonGradient = LinearGradient(
        colors: [accent, accent.opacity(0.8)],
        startPoint: .leading,
        endPoint: .trailing
    )
}

// MARK: - Brand Typography

struct BrandTypography {
    static let largeTitle = Font.system(size: 34, weight: .light, design: .default)
    static let title = Font.system(size: 28, weight: .regular, design: .default)
    static let headline = Font.system(size: 17, weight: .semibold, design: .default)
    static let body = Font.system(size: 17, weight: .regular, design: .default)
    static let caption = Font.system(size: 15, weight: .regular, design: .default)
    static let small = Font.system(size: 13, weight: .regular, design: .default)
}

// MARK: - Spacing

struct Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 48
}

// MARK: - Petal Icon/Emoji

struct PetalIcon {
    static let single = "🌸"
    static let multiple = "🌺"
    static let falling = "💮"
    static let branch = "🌿"
}

// MARK: - Brand Theme Modifier

struct SakuraTheme: ViewModifier {
    func body(content: Content) -> some View {
        content
            .tint(BrandColors.accent)
    }
}

extension View {
    func sakuraTheme() -> some View {
        modifier(SakuraTheme())
    }
}

