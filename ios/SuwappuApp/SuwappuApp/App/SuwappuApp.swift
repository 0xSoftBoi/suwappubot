//
//  SuwappuApp.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

@main
struct SuwappuApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var appState = AppState()
    
    init() {
        // Configure app-wide appearance
        setupAppearance()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authViewModel)
                .environmentObject(appState)
                .onAppear {
                    setupApp()
                }
        }
    }
    
    private func setupApp() {
        // Initialize app services
        KeychainService.shared.initialize()
        NotificationService.shared.requestAuthorization()
    }
    
    private func setupAppearance() {
        // Minimalist navigation bar
        let appearance = UINavigationBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundColor = UIColor(BrandColors.background)
        appearance.titleTextAttributes = [.foregroundColor: UIColor(BrandColors.textPrimary)]
        appearance.largeTitleTextAttributes = [.foregroundColor: UIColor(BrandColors.textPrimary)]
        
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = UIColor(BrandColors.accent)
        
        // Minimalist tab bar
        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithDefaultBackground()
        tabBarAppearance.backgroundColor = UIColor(BrandColors.background)
        tabBarAppearance.selectionIndicatorTintColor = UIColor(BrandColors.accent)
        
        UITabBar.appearance().standardAppearance = tabBarAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance
        UITabBar.appearance().tintColor = UIColor(BrandColors.accent)
        UITabBar.appearance().unselectedItemTintColor = UIColor.gray
    }
}
