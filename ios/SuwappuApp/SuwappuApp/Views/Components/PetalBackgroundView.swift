//
//  PetalBackgroundView.swift
//  SuwappuApp
//
//  Created on [Date]
//  Minimalist version - subtle accent background
//

import SwiftUI

struct PetalBackgroundView: View {
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Clean background
                BrandColors.background
                
                // Subtle gradient accent at top
                LinearGradient(
                    colors: [
                        BrandColors.accent.opacity(0.05),
                        Color.clear
                    ],
                    startPoint: .top,
                    endPoint: .center
                )
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Animated Petal (Optional, minimal version)

struct AnimatedPetal: View {
    let delay: Double
    let duration: Double
    let startX: CGFloat
    
    @State private var offset: CGFloat = -50
    @State private var rotation: Double = 0
    @State private var opacity: Double = 0
    
    var body: some View {
        Text("🌸")
            .font(.system(size: 20))
            .opacity(opacity)
            .rotationEffect(.degrees(rotation))
            .offset(x: startX, y: offset)
            .onAppear {
                withAnimation(
                    .easeInOut(duration: duration)
                    .repeatForever(autoreverses: false)
                    .delay(delay)
                ) {
                    offset = UIScreen.main.bounds.height + 50
                    rotation = 360
                }
                withAnimation(.easeIn(duration: 1).delay(delay)) {
                    opacity = 0.6
                }
            }
    }
}

// MARK: - Full Petal Background (with animation)

struct FullPetalBackgroundView: View {
    let petalCount: Int
    
    init(petalCount: Int = 8) {
        self.petalCount = petalCount
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                BrandColors.background
                
                // Subtle top gradient
                LinearGradient(
                    colors: [
                        BrandColors.accent.opacity(0.08),
                        Color.clear
                    ],
                    startPoint: .top,
                    endPoint: .center
                )
                
                // Falling petals
                ForEach(0..<petalCount, id: \.self) { index in
                    AnimatedPetal(
                        delay: Double(index) * 0.8,
                        duration: Double.random(in: 8...12),
                        startX: CGFloat.random(in: 0...geometry.size.width)
                    )
                }
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Sakura Logo

struct SakuraLogo: View {
    let size: CGFloat
    
    init(size: CGFloat = 60) {
        self.size = size
    }
    
    var body: some View {
        ZStack {
            Circle()
                .fill(BrandColors.accent.opacity(0.1))
                .frame(width: size, height: size)
            
            Text("🌸")
                .font(.system(size: size * 0.5))
        }
    }
}

#Preview {
    PetalBackgroundView()
}
