cmake_minimum_required(VERSION 3.14)
project(suwappu_core VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Optimization flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")

# Find Python
find_package(Python3 REQUIRED COMPONENTS Interpreter Development)

# Find pybind11 via Python (more reliable than find_package)
execute_process(
    COMMAND ${Python3_EXECUTABLE} -c "import pybind11; print(pybind11.get_cmake_dir())"
    OUTPUT_VARIABLE PYBIND11_CMAKE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE PYBIND11_RESULT
)

if(NOT PYBIND11_RESULT EQUAL 0)
    message(FATAL_ERROR "Failed to find pybind11. Install with: pip install pybind11")
endif()

list(APPEND CMAKE_PREFIX_PATH "${PYBIND11_CMAKE_DIR}")
find_package(pybind11 CONFIG REQUIRED)

# OpenSSL for cryptography (optional - fallback to simpler implementation if not found)
find_package(OpenSSL)

# Source files
set(SOURCES
    src/main.cpp
    src/math/math_utils.cpp
    src/validation/validator.cpp
)

# Add crypto source if OpenSSL is available
if(OPENSSL_FOUND)
    list(APPEND SOURCES src/crypto/encryption.cpp)
    add_compile_definitions(HAS_OPENSSL=1)
else()
    message(WARNING "OpenSSL not found. Encryption functions will fall back to Python.")
    # Create a stub encryption file
    file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/encryption_stub.cpp
        "#include \"suwappu_core.hpp\"\n"
        "namespace suwappu {\n"
        "std::pair<std::string, std::string> derive_key(const std::string&, const std::string&) {\n"
        "    throw std::runtime_error(\"Native encryption not available. Use Python fallback.\");\n"
        "}\n"
        "std::string encrypt_private_key(const std::string&, const std::string&) {\n"
        "    throw std::runtime_error(\"Native encryption not available. Use Python fallback.\");\n"
        "}\n"
        "std::string decrypt_private_key(const std::string&, const std::string&) {\n"
        "    throw std::runtime_error(\"Native encryption not available. Use Python fallback.\");\n"
        "}\n"
        "}\n"
    )
    list(APPEND SOURCES ${CMAKE_CURRENT_BINARY_DIR}/encryption_stub.cpp)
endif()

# Create the Python module
pybind11_add_module(suwappu_core ${SOURCES})

# Include directories
target_include_directories(suwappu_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Link libraries
if(OPENSSL_FOUND)
    target_include_directories(suwappu_core PRIVATE ${OPENSSL_INCLUDE_DIR})
    target_link_libraries(suwappu_core PRIVATE OpenSSL::SSL OpenSSL::Crypto)
endif()

# Install
install(TARGETS suwappu_core DESTINATION .)
