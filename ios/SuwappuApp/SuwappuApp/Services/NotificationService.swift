//
//  NotificationService.swift
//  SuwappuApp
//
//  Created on [Date]
//

import Foundation
import UserNotifications

class NotificationService {
    static let shared = NotificationService()
    
    private init() {}
    
    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                print("Notification permission granted")
            } else {
                print("Notification permission denied")
            }
        }
    }
    
    func scheduleNotification(title: String, body: String, identifier: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        
        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil // Immediate
        )
        
        UNUserNotificationCenter.current().add(request)
    }
    
    func scheduleSwapNotification(swapId: Int, status: SwapStatus) {
        let title: String
        let body: String
        
        switch status {
        case .completed:
            title = "Swap Completed"
            body = "Your swap has been completed successfully"
        case .failed:
            title = "Swap Failed"
            body = "Your swap has failed. Please check the details."
        default:
            return
        }
        
        scheduleNotification(
            title: title,
            body: body,
            identifier: "swap_\(swapId)"
        )
    }
}


