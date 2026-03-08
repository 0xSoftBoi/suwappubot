/**
 * suwappu_core - High-performance C++ extension for Suwappu Bot
 * 
 * This module provides fast implementations of:
 * - Token amount conversions (decimal math)
 * - Quote validation
 * - Encryption/decryption
 */

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include "suwappu_core.hpp"

namespace py = pybind11;

// Custom exception for swap errors
static PyObject* SwapErrorException = nullptr;

void translate_swap_error(const suwappu::SwapError& e) {
    PyErr_SetString(SwapErrorException, e.what());
}

PYBIND11_MODULE(suwappu_core, m) {
    m.doc() = "High-performance C++ core for Suwappu cross-chain swap bot";

    // Register custom exception
    SwapErrorException = PyErr_NewException("suwappu_core.SwapError", nullptr, nullptr);
    py::register_exception_translator([](std::exception_ptr p) {
        try {
            if (p) std::rethrow_exception(p);
        } catch (const suwappu::SwapError& e) {
            PyErr_SetString(SwapErrorException, e.what());
        }
    });
    m.attr("SwapError") = py::handle(SwapErrorException);

    // ========================================================================
    // Math utilities
    // ========================================================================
    m.def("to_raw_amount", &suwappu::to_raw_amount,
          py::arg("amount"), py::arg("decimals"),
          R"doc(
          Convert human-readable amount to raw token amount string.
          
          Args:
              amount: Human-readable amount (e.g., 1.5)
              decimals: Token decimals (e.g., 18 for ETH)
              
          Returns:
              Raw amount as string (e.g., "1500000000000000000")
          )doc");

    m.def("to_human_amount", &suwappu::to_human_amount,
          py::arg("raw_amount"), py::arg("decimals"),
          R"doc(
          Convert raw token amount to human-readable float.
          
          Args:
              raw_amount: Raw amount string (e.g., "1500000000000000000")
              decimals: Token decimals (e.g., 18)
              
          Returns:
              Human-readable amount (e.g., 1.5)
          )doc");

    m.def("parse_int", &suwappu::parse_int,
          py::arg("value"), py::arg("default_val") = 0,
          R"doc(
          Parse an integer from hex or decimal string.
          
          Args:
              value: String value (e.g., "0x1234" or "4660")
              default_val: Default if parsing fails
              
          Returns:
              Parsed integer
          )doc");

    // ========================================================================
    // Validation
    // ========================================================================
    py::class_<suwappu::NativeQuoteValidator>(m, "NativeQuoteValidator",
        "High-performance quote validator")
        .def_readonly_static("DEFAULT_EXPIRY_SECONDS", 
                            &suwappu::NativeQuoteValidator::DEFAULT_EXPIRY_SECONDS)
        .def_static("validate_freshness", &suwappu::NativeQuoteValidator::validate_freshness,
                   py::arg("timestamp_seconds"), 
                   py::arg("max_age_seconds") = suwappu::NativeQuoteValidator::DEFAULT_EXPIRY_SECONDS,
                   "Validate quote is not expired")
        .def_static("validate_slippage", &suwappu::NativeQuoteValidator::validate_slippage,
                   py::arg("slippage_bps"), py::arg("max_slippage_bps") = 1000,
                   "Validate slippage tolerance")
        .def_static("validate_balance", &suwappu::NativeQuoteValidator::validate_balance,
                   py::arg("balance"), py::arg("required"), py::arg("token_symbol"),
                   "Validate balance is sufficient")
        .def_static("validate_gas", &suwappu::NativeQuoteValidator::validate_gas,
                   py::arg("native_balance"), py::arg("gas_estimate_usd"),
                   py::arg("chain_name"), py::arg("buffer_multiplier") = 1.2,
                   "Validate gas is sufficient");

    // ========================================================================
    // Cryptography
    // ========================================================================
    m.def("derive_key", &suwappu::derive_key,
          py::arg("password"), py::arg("salt") = "",
          R"doc(
          Derive encryption key from password using PBKDF2.
          
          Args:
              password: The password/key to derive from
              salt: 16-byte salt (generated if empty)
              
          Returns:
              Tuple of (derived_key, salt) as base64 strings
          )doc");

    m.def("encrypt_private_key", &suwappu::encrypt_private_key,
          py::arg("private_key"), py::arg("encryption_key"),
          R"doc(
          Encrypt a private key using Fernet-compatible encryption.
          
          Args:
              private_key: The private key to encrypt
              encryption_key: The master encryption key
              
          Returns:
              Encrypted data as base64 string
          )doc");

    m.def("decrypt_private_key", &suwappu::decrypt_private_key,
          py::arg("encrypted_data"), py::arg("encryption_key"),
          R"doc(
          Decrypt an encrypted private key.
          
          Args:
              encrypted_data: The encrypted data (base64 string)
              encryption_key: The master encryption key
              
          Returns:
              Decrypted private key string
          )doc");

    // Version info
    m.attr("__version__") = "1.0.0";
}

