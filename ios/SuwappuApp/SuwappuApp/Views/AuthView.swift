//
//  AuthView.swift
//  SuwappuApp
//
//  Created on [Date]
//

import SwiftUI

struct AuthView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var isLoginMode = true
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var username = ""
    @State private var firstName = ""
    @State private var lastName = ""
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Spacer()
                
                // Minimalist header
                VStack(spacing: Spacing.md) {
                    Text("Suwappu")
                        .font(BrandTypography.largeTitle)
                        .foregroundColor(BrandColors.textPrimary)
                    
                    Text("Cross-chain swaps")
                        .font(BrandTypography.body)
                        .foregroundColor(BrandColors.textSecondary)
                }
                .padding(.bottom, Spacing.xxl)
                
                // Clean form
                VStack(spacing: Spacing.lg) {
                    if !isLoginMode {
                        TextField("Username", text: $username)
                            .textFieldStyle(.plain)
                            .autocapitalization(.none)
                            .padding(.vertical, Spacing.md)
                            .overlay(
                                Rectangle()
                                    .frame(height: 1)
                                    .foregroundColor(Color(.separator)),
                                alignment: .bottom
                            )
                        
                        TextField("First Name", text: $firstName)
                            .textFieldStyle(.plain)
                            .padding(.vertical, Spacing.md)
                            .overlay(
                                Rectangle()
                                    .frame(height: 1)
                                    .foregroundColor(Color(.separator)),
                                alignment: .bottom
                            )
                        
                        TextField("Last Name", text: $lastName)
                            .textFieldStyle(.plain)
                            .padding(.vertical, Spacing.md)
                            .overlay(
                                Rectangle()
                                    .frame(height: 1)
                                    .foregroundColor(Color(.separator)),
                                alignment: .bottom
                            )
                    }
                    
                    TextField("Email", text: $email)
                        .textFieldStyle(.plain)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .padding(.vertical, Spacing.md)
                        .overlay(
                            Rectangle()
                                .frame(height: 1)
                                .foregroundColor(Color(.separator)),
                            alignment: .bottom
                        )
                    
                    SecureField("Password", text: $password)
                        .textFieldStyle(.plain)
                        .padding(.vertical, Spacing.md)
                        .overlay(
                            Rectangle()
                                .frame(height: 1)
                                .foregroundColor(Color(.separator)),
                            alignment: .bottom
                        )
                    
                    if !isLoginMode {
                        SecureField("Confirm Password", text: $confirmPassword)
                            .textFieldStyle(.plain)
                            .padding(.vertical, Spacing.md)
                            .overlay(
                                Rectangle()
                                    .frame(height: 1)
                                    .foregroundColor(Color(.separator)),
                                alignment: .bottom
                            )
                    }
                    
                    if let error = authViewModel.errorMessage {
                        Text(error)
                            .foregroundColor(.red)
                            .font(BrandTypography.small)
                            .padding(.top, Spacing.sm)
                    }
                    
                    Button(action: {
                        Task {
                            if isLoginMode {
                                await authViewModel.login(email: email, password: password)
                            } else {
                                let request = RegisterRequest(
                                    email: email,
                                    password: password,
                                    username: username.isEmpty ? nil : username,
                                    firstName: firstName.isEmpty ? nil : firstName,
                                    lastName: lastName.isEmpty ? nil : lastName
                                )
                                await authViewModel.register(request)
                            }
                        }
                    }) {
                        Group {
                            if authViewModel.isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text(isLoginMode ? "Login" : "Register")
                                    .font(BrandTypography.headline)
                                    .foregroundColor(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(BrandColors.accent)
                        .cornerRadius(12)
                    }
                    .disabled(authViewModel.isLoading || email.isEmpty || password.isEmpty)
                    .padding(.top, Spacing.lg)
                    
                    Button(action: {
                        isLoginMode.toggle()
                    }) {
                        Text(isLoginMode ? "Create account" : "Sign in")
                            .font(BrandTypography.body)
                            .foregroundColor(BrandColors.accent)
                    }
                    .padding(.top, Spacing.md)
                }
                .padding(.horizontal, Spacing.xl)
                
                Spacer()
            }
            .background(BrandColors.background)
            .navigationBarHidden(true)
        }
    }
}

#Preview {
    AuthView()
        .environmentObject(AuthViewModel())
}

