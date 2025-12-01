//
//  ContentView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        Group {
            if authViewModel.isAuthenticated {
                MainTabView()
            } else {
                AuthView()
            }
        }
        .animation(.easeInOut, value: authViewModel.isAuthenticated)
    }
}

struct MainTabView: View {
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(0)
            
            SwapView()
                .tabItem {
                    Label("Swap", systemImage: "arrow.triangle.2.circlepath")
                }
                .tag(1)
            
            WalletsView()
                .tabItem {
                    Label("Wallets", systemImage: "wallet.pass.fill")
                }
                .tag(2)
            
            HistoryView()
                .tabItem {
                    Label("History", systemImage: "clock.fill")
                }
                .tag(3)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(4)
        }
        .tint(BrandColors.accent)
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthViewModel())
        .environmentObject(AppState())
}

