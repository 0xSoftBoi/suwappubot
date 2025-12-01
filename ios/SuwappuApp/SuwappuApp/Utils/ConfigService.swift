//
//  ConfigService.swift
//  SuwappuApp
//

import Foundation

enum ConfigKey: String {
    case apiBaseURL = "API_BASE_URL"
}

final class ConfigService {
    static let shared = ConfigService()
    
    private let values: [String: Any]
    
    init(bundle: Bundle = .main) {
        if let url = bundle.url(forResource: "Config", withExtension: "plist"),
           let data = try? Data(contentsOf: url),
           let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
           let dictionary = plist as? [String: Any] {
            values = dictionary
        } else {
            assertionFailure("Config.plist is missing from the app bundle.")
            values = [:]
        }
    }
    
    func string(_ key: ConfigKey) -> String {
        guard let value = values[key.rawValue] as? String, !value.isEmpty else {
            fatalError("Missing or empty value for config key \(key.rawValue)")
        }
        return value
    }
}


