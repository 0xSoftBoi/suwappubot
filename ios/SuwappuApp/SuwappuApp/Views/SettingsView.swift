//
//  SettingsView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    
    var body: some View {
        NavigationView {
            List {
                Section("Account") {
                    if let user = authViewModel.currentUser {
                        HStack {
                            Text("Email")
                            Spacer()
                            Text(user.email ?? "N/A")
                                .foregroundColor(.secondary)
                        }
                        
                        HStack {
                            Text("Username")
                            Spacer()
                            Text(user.username ?? "N/A")
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Section("Preferences") {
                    NavigationLink("Slippage Tolerance") {
                        Text("Slippage Settings")
                    }
                    
                    NavigationLink("Notifications") {
                        Text("Notification Settings")
                    }
                }
                
                Section("Security") {
                    NavigationLink("Two-Factor Authentication") {
                        Text("2FA Settings")
                    }
                    
                    Button(action: {
                        authViewModel.logout()
                    }) {
                        Text("Logout")
                            .foregroundColor(.red)
                    }
                }
                
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                    
                    Link("Privacy Policy", destination: URL(string: "https://suwappu.com/privacy")!)
                    Link("Terms of Service", destination: URL(string: "https://suwappu.com/terms")!)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AuthViewModel())
}

