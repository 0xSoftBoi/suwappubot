/**
 * Math utilities for token amount conversions.
 * 
 * These functions handle the conversion between human-readable token amounts
 * (e.g., 1.5 ETH) and raw blockchain amounts (e.g., 1500000000000000000 wei).
 */

#include "suwappu_core.hpp"
#include <cmath>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>

namespace suwappu {

std::string to_raw_amount(double amount, int decimals) {
    // Handle edge cases
    if (amount <= 0) {
        return "0";
    }
    
    if (decimals < 0 || decimals > 77) {
        throw std::invalid_argument("Decimals must be between 0 and 77");
    }
    
    // Use string manipulation for precision
    // Split into integer and fractional parts
    double int_part;
    double frac_part = std::modf(amount, &int_part);
    
    // Convert integer part to string
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(0) << int_part;
    std::string result = oss.str();
    
    // Handle fractional part with proper precision
    if (frac_part > 0 && decimals > 0) {
        std::ostringstream frac_oss;
        frac_oss << std::fixed << std::setprecision(decimals) << frac_part;
        std::string frac_str = frac_oss.str();
        
        // Remove "0." prefix
        if (frac_str.size() > 2) {
            frac_str = frac_str.substr(2);
        } else {
            frac_str = "";
        }
        
        // Pad with zeros if needed
        while (frac_str.size() < static_cast<size_t>(decimals)) {
            frac_str += '0';
        }
        
        // Truncate to exact decimals
        if (frac_str.size() > static_cast<size_t>(decimals)) {
            frac_str = frac_str.substr(0, decimals);
        }
        
        result += frac_str;
    } else {
        // No fractional part, append zeros
        result += std::string(decimals, '0');
    }
    
    // Remove leading zeros (but keep at least one digit)
    size_t start = result.find_first_not_of('0');
    if (start == std::string::npos) {
        return "0";
    }
    
    return result.substr(start);
}

double to_human_amount(const std::string& raw_amount, int decimals) {
    if (raw_amount.empty() || raw_amount == "0") {
        return 0.0;
    }
    
    if (decimals < 0 || decimals > 77) {
        throw std::invalid_argument("Decimals must be between 0 and 77");
    }
    
    // Clean the input string
    std::string cleaned = raw_amount;
    
    // Remove "0x" prefix if present
    if (cleaned.size() >= 2 && cleaned[0] == '0' && (cleaned[1] == 'x' || cleaned[1] == 'X')) {
        // Parse as hex first
        try {
            unsigned long long hex_val = std::stoull(cleaned, nullptr, 16);
            cleaned = std::to_string(hex_val);
        } catch (...) {
            return 0.0;
        }
    }
    
    // Remove any whitespace
    cleaned.erase(std::remove_if(cleaned.begin(), cleaned.end(), ::isspace), cleaned.end());
    
    // Validate - only digits
    for (char c : cleaned) {
        if (!std::isdigit(c)) {
            throw std::invalid_argument("Invalid character in raw amount");
        }
    }
    
    // Handle case where string is shorter than decimals
    if (cleaned.size() <= static_cast<size_t>(decimals)) {
        // Pad with leading zeros
        cleaned = std::string(decimals - cleaned.size() + 1, '0') + cleaned;
    }
    
    // Insert decimal point
    size_t decimal_pos = cleaned.size() - decimals;
    std::string int_part = cleaned.substr(0, decimal_pos);
    std::string frac_part = cleaned.substr(decimal_pos);
    
    // Parse result
    std::string final_str = int_part + "." + frac_part;
    return std::stod(final_str);
}

int64_t parse_int(const std::string& value, int64_t default_val) {
    if (value.empty()) {
        return default_val;
    }
    
    try {
        std::string trimmed = value;
        
        // Trim whitespace
        size_t start = trimmed.find_first_not_of(" \t\n\r");
        size_t end = trimmed.find_last_not_of(" \t\n\r");
        
        if (start == std::string::npos) {
            return default_val;
        }
        
        trimmed = trimmed.substr(start, end - start + 1);
        
        // Check for hex prefix
        if (trimmed.size() >= 2 && trimmed[0] == '0' && (trimmed[1] == 'x' || trimmed[1] == 'X')) {
            return std::stoll(trimmed, nullptr, 16);
        }
        
        // Parse as decimal
        return std::stoll(trimmed, nullptr, 10);
    } catch (...) {
        return default_val;
    }
}

} // namespace suwappu

