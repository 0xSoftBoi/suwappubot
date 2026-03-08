/**
 * Cryptographic utilities for wallet key encryption.
 * 
 * Implements Fernet-compatible encryption using OpenSSL:
 * - PBKDF2 key derivation
 * - AES-128-CBC encryption with HMAC-SHA256
 * 
 * Compatible with Python's cryptography.fernet module.
 */

#include "suwappu_core.hpp"
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/hmac.h>
#include <openssl/sha.h>
#include <cstring>
#include <vector>
#include <stdexcept>
#include <ctime>

namespace suwappu {

namespace {

// Base64 encoding/decoding (URL-safe variant)
static const char base64_chars[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

std::string base64_encode(const unsigned char* data, size_t len) {
    std::string result;
    result.reserve(((len + 2) / 3) * 4);
    
    for (size_t i = 0; i < len; i += 3) {
        unsigned int n = data[i] << 16;
        if (i + 1 < len) n |= data[i + 1] << 8;
        if (i + 2 < len) n |= data[i + 2];
        
        result += base64_chars[(n >> 18) & 0x3F];
        result += base64_chars[(n >> 12) & 0x3F];
        result += (i + 1 < len) ? base64_chars[(n >> 6) & 0x3F] : '=';
        result += (i + 2 < len) ? base64_chars[n & 0x3F] : '=';
    }
    
    return result;
}

std::vector<unsigned char> base64_decode(const std::string& input) {
    // Build reverse lookup table
    static int lookup[256] = {-1};
    static bool initialized = false;
    
    if (!initialized) {
        for (int i = 0; i < 256; i++) lookup[i] = -1;
        for (int i = 0; i < 64; i++) lookup[(unsigned char)base64_chars[i]] = i;
        // Also handle standard base64 characters
        lookup['+'] = 62;
        lookup['/'] = 63;
        initialized = true;
    }
    
    std::vector<unsigned char> result;
    result.reserve((input.size() * 3) / 4);
    
    int val = 0, valb = -8;
    for (unsigned char c : input) {
        if (c == '=' || c == '\n' || c == '\r') continue;
        int v = lookup[c];
        if (v == -1) continue;
        
        val = (val << 6) + v;
        valb += 6;
        
        if (valb >= 0) {
            result.push_back((val >> valb) & 0xFF);
            valb -= 8;
        }
    }
    
    return result;
}

// PKCS7 padding
void pkcs7_pad(std::vector<unsigned char>& data, size_t block_size) {
    size_t padding = block_size - (data.size() % block_size);
    for (size_t i = 0; i < padding; i++) {
        data.push_back(static_cast<unsigned char>(padding));
    }
}

void pkcs7_unpad(std::vector<unsigned char>& data) {
    if (data.empty()) return;
    unsigned char padding = data.back();
    if (padding > 0 && padding <= 16) {
        data.resize(data.size() - padding);
    }
}

constexpr size_t SALT_SIZE = 16;
constexpr size_t KEY_SIZE = 32;  // 256 bits for Fernet
constexpr size_t IV_SIZE = 16;
constexpr int PBKDF2_ITERATIONS = 480000;

} // anonymous namespace

std::pair<std::string, std::string> derive_key(const std::string& password, const std::string& salt_input) {
    std::vector<unsigned char> salt;
    
    if (salt_input.empty()) {
        // Generate random salt
        salt.resize(SALT_SIZE);
        if (RAND_bytes(salt.data(), SALT_SIZE) != 1) {
            throw std::runtime_error("Failed to generate random salt");
        }
    } else {
        // Decode provided salt
        salt = base64_decode(salt_input);
        if (salt.size() < SALT_SIZE) {
            // Use raw bytes if not base64
            salt.assign(salt_input.begin(), salt_input.end());
        }
    }
    
    // Derive key using PBKDF2
    std::vector<unsigned char> key(KEY_SIZE);
    
    if (PKCS5_PBKDF2_HMAC(
            password.c_str(), password.size(),
            salt.data(), salt.size(),
            PBKDF2_ITERATIONS,
            EVP_sha256(),
            KEY_SIZE, key.data()) != 1) {
        throw std::runtime_error("PBKDF2 key derivation failed");
    }
    
    // Return base64-encoded key and salt
    std::string key_b64 = base64_encode(key.data(), key.size());
    std::string salt_b64 = base64_encode(salt.data(), salt.size());
    
    return {key_b64, salt_b64};
}

std::string encrypt_private_key(const std::string& private_key, const std::string& encryption_key) {
    // Generate salt and derive key
    auto [key_b64, salt_b64] = derive_key(encryption_key);
    std::vector<unsigned char> key = base64_decode(key_b64);
    std::vector<unsigned char> salt = base64_decode(salt_b64);
    
    // Generate random IV
    std::vector<unsigned char> iv(IV_SIZE);
    if (RAND_bytes(iv.data(), IV_SIZE) != 1) {
        throw std::runtime_error("Failed to generate IV");
    }
    
    // Prepare plaintext with padding
    std::vector<unsigned char> plaintext(private_key.begin(), private_key.end());
    pkcs7_pad(plaintext, 16);
    
    // Encrypt using AES-128-CBC (Fernet uses first 16 bytes of key for encryption)
    std::vector<unsigned char> ciphertext(plaintext.size() + 16);
    
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
        throw std::runtime_error("Failed to create cipher context");
    }
    
    int len = 0, ciphertext_len = 0;
    
    // Use first 16 bytes for AES-128
    if (EVP_EncryptInit_ex(ctx, EVP_aes_128_cbc(), nullptr, key.data() + 16, iv.data()) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Failed to initialize encryption");
    }
    
    // Disable auto-padding since we handle it
    EVP_CIPHER_CTX_set_padding(ctx, 0);
    
    if (EVP_EncryptUpdate(ctx, ciphertext.data(), &len, plaintext.data(), plaintext.size()) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Encryption failed");
    }
    ciphertext_len = len;
    
    if (EVP_EncryptFinal_ex(ctx, ciphertext.data() + len, &len) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Encryption finalization failed");
    }
    ciphertext_len += len;
    ciphertext.resize(ciphertext_len);
    
    EVP_CIPHER_CTX_free(ctx);
    
    // Compute HMAC-SHA256 (first 16 bytes of key for signing)
    // Fernet format: version || timestamp || iv || ciphertext
    std::vector<unsigned char> fernet_data;
    
    // Version byte (0x80 for Fernet)
    fernet_data.push_back(0x80);
    
    // Timestamp (8 bytes, big-endian)
    uint64_t timestamp = static_cast<uint64_t>(std::time(nullptr));
    for (int i = 7; i >= 0; i--) {
        fernet_data.push_back((timestamp >> (i * 8)) & 0xFF);
    }
    
    // IV
    fernet_data.insert(fernet_data.end(), iv.begin(), iv.end());
    
    // Ciphertext
    fernet_data.insert(fernet_data.end(), ciphertext.begin(), ciphertext.end());
    
    // HMAC
    unsigned char hmac[32];
    unsigned int hmac_len;
    HMAC(EVP_sha256(), key.data(), 16, fernet_data.data(), fernet_data.size(), hmac, &hmac_len);
    
    // Final token: fernet_data || hmac
    fernet_data.insert(fernet_data.end(), hmac, hmac + hmac_len);
    
    // Prepend salt and encode
    std::vector<unsigned char> final_data;
    final_data.insert(final_data.end(), salt.begin(), salt.end());
    final_data.insert(final_data.end(), fernet_data.begin(), fernet_data.end());
    
    return base64_encode(final_data.data(), final_data.size());
}

std::string decrypt_private_key(const std::string& encrypted_data, const std::string& encryption_key) {
    // Decode the data
    std::vector<unsigned char> data = base64_decode(encrypted_data);
    
    if (data.size() < SALT_SIZE + 1 + 8 + IV_SIZE + 16 + 32) {
        throw std::runtime_error("Invalid encrypted data: too short");
    }
    
    // Extract salt
    std::vector<unsigned char> salt(data.begin(), data.begin() + SALT_SIZE);
    
    // Derive key using the same salt
    std::string salt_b64 = base64_encode(salt.data(), salt.size());
    auto [key_b64, _] = derive_key(encryption_key, salt_b64);
    std::vector<unsigned char> key = base64_decode(key_b64);
    
    // Parse Fernet token
    size_t offset = SALT_SIZE;
    
    // Version
    unsigned char version = data[offset++];
    if (version != 0x80) {
        throw std::runtime_error("Invalid Fernet version");
    }
    
    // Skip timestamp (8 bytes)
    offset += 8;
    
    // Extract IV
    std::vector<unsigned char> iv(data.begin() + offset, data.begin() + offset + IV_SIZE);
    offset += IV_SIZE;
    
    // Extract ciphertext (everything except last 32 bytes which is HMAC)
    size_t ciphertext_len = data.size() - offset - 32;
    std::vector<unsigned char> ciphertext(data.begin() + offset, data.begin() + offset + ciphertext_len);
    
    // Verify HMAC
    std::vector<unsigned char> fernet_data(data.begin() + SALT_SIZE, data.end() - 32);
    unsigned char expected_hmac[32];
    unsigned int hmac_len;
    HMAC(EVP_sha256(), key.data(), 16, fernet_data.data(), fernet_data.size(), expected_hmac, &hmac_len);
    
    std::vector<unsigned char> actual_hmac(data.end() - 32, data.end());
    if (std::memcmp(expected_hmac, actual_hmac.data(), 32) != 0) {
        throw std::runtime_error("HMAC verification failed - data may be corrupted or wrong key");
    }
    
    // Decrypt
    std::vector<unsigned char> plaintext(ciphertext.size());
    
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
        throw std::runtime_error("Failed to create cipher context");
    }
    
    int len = 0, plaintext_len = 0;
    
    if (EVP_DecryptInit_ex(ctx, EVP_aes_128_cbc(), nullptr, key.data() + 16, iv.data()) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Failed to initialize decryption");
    }
    
    EVP_CIPHER_CTX_set_padding(ctx, 0);
    
    if (EVP_DecryptUpdate(ctx, plaintext.data(), &len, ciphertext.data(), ciphertext.size()) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Decryption failed");
    }
    plaintext_len = len;
    
    if (EVP_DecryptFinal_ex(ctx, plaintext.data() + len, &len) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        throw std::runtime_error("Decryption finalization failed");
    }
    plaintext_len += len;
    plaintext.resize(plaintext_len);
    
    EVP_CIPHER_CTX_free(ctx);
    
    // Remove PKCS7 padding
    pkcs7_unpad(plaintext);
    
    return std::string(plaintext.begin(), plaintext.end());
}

} // namespace suwappu

