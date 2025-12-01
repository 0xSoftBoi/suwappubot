/**
 * Quote validation logic.
 * 
 * Validates swap quotes before execution to prevent failed transactions
 * and protect users from bad trades.
 */

#include "suwappu_core.hpp"
#include <chrono>
#include <sstream>
#include <iomanip>
#include <unordered_map>

namespace suwappu {

bool NativeQuoteValidator::validate_freshness(int64_t timestamp_seconds, int max_age_seconds) {
    // Get current time
    auto now = std::chrono::system_clock::now();
    auto now_seconds = std::chrono::duration_cast<std::chrono::seconds>(
        now.time_since_epoch()
    ).count();
    
    int64_t age_seconds = now_seconds - timestamp_seconds;
    
    if (age_seconds > max_age_seconds) {
        std::ostringstream oss;
        oss << "Quote expired. Quote is " << age_seconds << " seconds old "
            << "(max " << max_age_seconds << "s). Please get a new quote.";
        throw SwapError(oss.str());
    }
    
    return true;
}

bool NativeQuoteValidator::validate_slippage(int slippage_bps, int max_slippage_bps) {
    if (slippage_bps > max_slippage_bps) {
        double slippage_pct = slippage_bps / 100.0;
        double max_pct = max_slippage_bps / 100.0;
        
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(1)
            << "Slippage tolerance too high (" << slippage_pct << "%). "
            << "Maximum allowed: " << max_pct << "%. "
            << "This protects you from bad trades.";
        throw SwapError(oss.str());
    }
    
    return true;
}

bool NativeQuoteValidator::validate_balance(double balance, double required, 
                                           const std::string& token_symbol) {
    if (balance < required) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(4)
            << "Insufficient " << token_symbol << " balance. "
            << "Have: " << balance << ", Need: " << required;
        throw SwapError(oss.str());
    }
    
    return true;
}

bool NativeQuoteValidator::validate_gas(double native_balance, double gas_estimate_usd,
                                       const std::string& chain_name, double buffer_multiplier) {
    // Approximate native token prices (USD)
    // In production, these would come from a price feed
    static const std::unordered_map<std::string, std::pair<double, std::string>> chain_config = {
        {"ethereum", {2000.0, "ETH"}},
        {"polygon", {1.0, "MATIC"}},
        {"bsc", {300.0, "BNB"}},
        {"arbitrum", {2000.0, "ETH"}},
        {"optimism", {2000.0, "ETH"}},
        {"base", {2000.0, "ETH"}},
        {"avalanche", {35.0, "AVAX"}},
        {"solana", {100.0, "SOL"}},
    };
    
    // Find chain config
    auto it = chain_config.find(chain_name);
    double native_price_usd = 1.0;
    std::string native_token = "TOKEN";
    
    if (it != chain_config.end()) {
        native_price_usd = it->second.first;
        native_token = it->second.second;
    }
    
    // Calculate required gas in native token
    double required_gas = (gas_estimate_usd / native_price_usd) * buffer_multiplier;
    
    // Use a minimum floor
    if (required_gas < 0.0001) {
        required_gas = 0.001 * buffer_multiplier;
    }
    
    if (native_balance < required_gas) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(6)
            << "Insufficient gas. Need more " << native_token
            << " for transaction fees. "
            << "Estimated: " << required_gas << " " << native_token;
        throw SwapError(oss.str());
    }
    
    return true;
}

} // namespace suwappu

