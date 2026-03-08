#pragma once

#include <string>
#include <cstdint>
#include <chrono>
#include <stdexcept>

namespace suwappu {

// ============================================================================
// Math Utilities
// ============================================================================

/**
 * Convert human-readable amount to raw token amount string.
 * @param amount Human-readable amount (e.g., 1.5)
 * @param decimals Token decimals (e.g., 18 for ETH)
 * @return Raw amount as string (e.g., "1500000000000000000")
 */
std::string to_raw_amount(double amount, int decimals);

/**
 * Convert raw token amount to human-readable float.
 * @param raw_amount Raw amount string (e.g., "1500000000000000000")
 * @param decimals Token decimals (e.g., 18)
 * @return Human-readable amount (e.g., 1.5)
 */
double to_human_amount(const std::string& raw_amount, int decimals);

/**
 * Parse an integer that may be hex or decimal string.
 * @param value String value (e.g., "0x1234" or "4660")
 * @param default_val Default value if parsing fails
 * @return Parsed integer
 */
int64_t parse_int(const std::string& value, int64_t default_val = 0);

// ============================================================================
// Validation
// ============================================================================

class SwapError : public std::runtime_error {
public:
    explicit SwapError(const std::string& msg) : std::runtime_error(msg) {}
};

class NativeQuoteValidator {
public:
    static constexpr int DEFAULT_EXPIRY_SECONDS = 30;

    /**
     * Validate quote freshness.
     * @param timestamp_seconds Unix timestamp when quote was created
     * @param max_age_seconds Maximum allowed age
     * @return true if valid
     * @throws SwapError if expired
     */
    static bool validate_freshness(int64_t timestamp_seconds, int max_age_seconds = DEFAULT_EXPIRY_SECONDS);

    /**
     * Validate slippage tolerance.
     * @param slippage_bps Slippage in basis points (50 = 0.5%)
     * @param max_slippage_bps Maximum allowed slippage
     * @return true if valid
     * @throws SwapError if too high
     */
    static bool validate_slippage(int slippage_bps, int max_slippage_bps = 1000);

    /**
     * Validate balance is sufficient.
     * @param balance Current balance
     * @param required Required amount
     * @param token_symbol Token symbol for error message
     * @return true if sufficient
     * @throws SwapError if insufficient
     */
    static bool validate_balance(double balance, double required, const std::string& token_symbol);

    /**
     * Validate gas is sufficient.
     * @param native_balance Current native token balance
     * @param gas_estimate_usd Estimated gas cost in USD
     * @param chain_name Chain name for calculation
     * @param buffer_multiplier Safety buffer (e.g., 1.2 for 20%)
     * @return true if sufficient
     * @throws SwapError if insufficient
     */
    static bool validate_gas(double native_balance, double gas_estimate_usd, 
                            const std::string& chain_name, double buffer_multiplier = 1.2);
};

// ============================================================================
// Cryptography
// ============================================================================

/**
 * Derive encryption key from password using PBKDF2.
 * @param password The password/key to derive from
 * @param salt 16-byte salt (generated if empty)
 * @return Pair of (derived_key, salt)
 */
std::pair<std::string, std::string> derive_key(const std::string& password, const std::string& salt = "");

/**
 * Encrypt a private key using Fernet-compatible encryption.
 * @param private_key The private key to encrypt
 * @param encryption_key The master encryption key
 * @return Encrypted data as base64 string
 */
std::string encrypt_private_key(const std::string& private_key, const std::string& encryption_key);

/**
 * Decrypt an encrypted private key.
 * @param encrypted_data The encrypted data (base64 string)
 * @param encryption_key The master encryption key
 * @return Decrypted private key
 */
std::string decrypt_private_key(const std::string& encrypted_data, const std::string& encryption_key);

} // namespace suwappu

