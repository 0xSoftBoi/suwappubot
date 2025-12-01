//
//  User.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation

struct User: Codable, Identifiable {
    let id: Int
    let email: String?
    let username: String?
    let firstName: String?
    let lastName: String?
    let defaultSlippage: Int // In basis points
    let notificationsEnabled: Bool
    let twoFAEnabled: Bool
    let twoFAThreshold: Int // USD threshold
    let createdAt: Date
    let updatedAt: Date
    let lastActiveAt: Date
    
    var displayName: String {
        if let firstName = firstName, let lastName = lastName {
            return "\(firstName) \(lastName)"
        } else if let firstName = firstName {
            return firstName
        } else if let username = username {
            return username
        } else if let email = email {
            return email
        }
        return "User \(id)"
    }
}

struct AuthResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let user: User
    let expiresIn: Int
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct RegisterRequest: Codable {
    let email: String
    let password: String
    let username: String?
    let firstName: String?
    let lastName: String?
}


