//
//  SakuraButton.swift
//  SuwappuApp
//
//  Created on [Date]
//  Minimalist button styles
//

import SwiftUI

// MARK: - Primary Button Style

struct SakuraButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(BrandTypography.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(isEnabled ? BrandColors.accent : Color.gray)
            .cornerRadius(12)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Secondary Button Style

struct SakuraSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(BrandTypography.headline)
            .foregroundColor(isEnabled ? BrandColors.accent : .gray)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(BrandColors.secondaryBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(BrandColors.accent.opacity(0.3), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Text Button Style

struct SakuraTextButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(BrandTypography.body)
            .foregroundColor(BrandColors.accent)
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Convenience Extension

extension View {
    func sakuraButtonStyle() -> some View {
        self.buttonStyle(SakuraButtonStyle())
    }
    
    func sakuraSecondaryButtonStyle() -> some View {
        self.buttonStyle(SakuraSecondaryButtonStyle())
    }
    
    func sakuraTextButtonStyle() -> some View {
        self.buttonStyle(SakuraTextButtonStyle())
    }
}

#Preview {
    VStack(spacing: 20) {
        Button("Primary Button") {}
            .buttonStyle(SakuraButtonStyle())
        
        Button("Secondary Button") {}
            .buttonStyle(SakuraSecondaryButtonStyle())
        
        Button("Text Button") {}
            .buttonStyle(SakuraTextButtonStyle())
        
        Button("Disabled") {}
            .buttonStyle(SakuraButtonStyle())
            .disabled(true)
    }
    .padding()
}
