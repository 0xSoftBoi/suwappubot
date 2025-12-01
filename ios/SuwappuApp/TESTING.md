# Testing Guide for Suwappu iOS App

## Overview

This document describes the test suite for the Suwappu iOS application. The test suite includes unit tests, integration tests, and UI tests.

## Test Structure

```
SuwappuAppTests/
├── Helpers/
│   └── MockAPIService.swift          # Mock services for testing
├── ViewModels/
│   ├── AuthViewModelTests.swift      # Authentication tests
│   └── SwapViewModelTests.swift      # Swap functionality tests
├── Services/
│   ├── APIServiceTests.swift         # API service tests
│   └── KeychainServiceTests.swift    # Keychain service tests
├── Models/
│   ├── UserTests.swift               # User model tests
│   ├── ChainTests.swift              # Chain model tests
│   └── SwapTests.swift               # Swap model tests
└── Utils/
    └── BrandingTests.swift           # Branding utilities tests

SuwappuAppUITests/
└── SuwappuAppUITests.swift           # UI tests
```

## Running Tests

### In Xcode

1. **Run All Tests**:
   - Press `⌘U` (Cmd + U)
   - Or: Product → Test

2. **Run Specific Test**:
   - Click the diamond icon next to the test method
   - Or: Right-click test → Run

3. **Run Test Suite**:
   - Right-click on test class → Run

### Command Line

```bash
# Run all tests
xcodebuild test -scheme SuwappuApp -destination 'platform=iOS Simulator,name=iPhone 15 Pro'

# Run specific test
xcodebuild test -scheme SuwappuApp -destination 'platform=iOS Simulator,name=iPhone 15 Pro' -only-testing:SuwappuAppTests/AuthViewModelTests/testLogin_Success
```

## Test Coverage

### Unit Tests

#### ViewModels
- ✅ `AuthViewModelTests`: Authentication flow, login, register, logout
- ✅ `SwapViewModelTests`: Swap quote validation, state management

#### Services
- ✅ `APIServiceTests`: API calls, error handling, token management
- ✅ `KeychainServiceTests`: Secure storage, token persistence

#### Models
- ✅ `UserTests`: User model, display name logic, Codable conformance
- ✅ `ChainTests`: Chain lookup, supported chains
- ✅ `SwapTests`: Swap status, cross-chain detection, Codable

#### Utils
- ✅ `BrandingTests`: Colors, spacing, typography

### UI Tests

- ✅ `SuwappuAppUITests`: Screen navigation, form validation, button states

## Writing New Tests

### Unit Test Template

```swift
import XCTest
@testable import SuwappuApp

final class MyFeatureTests: XCTestCase {
    var sut: MyFeature! // System Under Test
    
    override func setUp() {
        super.setUp()
        sut = MyFeature()
    }
    
    override func tearDown() {
        sut = nil
        super.tearDown()
    }
    
    func testFeature_ExpectedBehavior() {
        // Given
        let input = "test"
        
        // When
        let result = sut.doSomething(input)
        
        // Then
        XCTAssertEqual(result, "expected")
    }
}
```

### Async Test Template

```swift
func testAsyncOperation() async throws {
    // Given
    let expectedValue = "result"
    
    // When
    let result = try await sut.asyncOperation()
    
    // Then
    XCTAssertEqual(result, expectedValue)
}
```

### UI Test Template

```swift
func testUIFeature() throws {
    // Given
    let app = XCUIApplication()
    app.launch()
    
    // When
    app.buttons["Button"].tap()
    
    // Then
    XCTAssertTrue(app.staticTexts["Expected Text"].exists)
}
```

## Mock Services

### MockAPIService

Use `MockAPIService` to test ViewModels without making real API calls:

```swift
let mockAPI = MockAPIService.sharedMock
mockAPI.shouldFailLogin = false
mockAPI.loginResponse = customResponse
```

### MockKeychainService

Use `MockKeychainService` to test secure storage:

```swift
let mockKeychain = MockKeychainService.sharedMock
mockKeychain.saveAccessToken("test_token")
```

## Test Best Practices

1. **Arrange-Act-Assert Pattern**: Structure tests with Given-When-Then comments
2. **Test Isolation**: Each test should be independent
3. **Clear Names**: Test names should describe what they test
4. **Mock External Dependencies**: Don't make real API calls in unit tests
5. **Test Edge Cases**: Include boundary conditions and error cases
6. **Fast Tests**: Unit tests should run quickly (< 1 second each)

## Coverage Goals

- **Unit Tests**: > 80% code coverage
- **Critical Paths**: 100% coverage (auth, swaps, payments)
- **UI Tests**: Cover main user flows

## Continuous Integration

Tests should run automatically on:
- Pull requests
- Before merging to main
- Nightly builds

## Troubleshooting

### Tests Fail to Compile
- Ensure all test files are added to the test target
- Check that `@testable import SuwappuApp` is present
- Verify Swift version compatibility

### Mock Services Not Working
- Ensure you're using `MockAPIService.sharedMock`
- Check that mocks are reset in `setUp()`

### UI Tests Fail
- Ensure simulator is running
- Check that UI elements have accessibility identifiers
- Verify app launches correctly

## Future Test Additions

- [ ] Integration tests with test backend
- [ ] Performance tests
- [ ] Snapshot tests for UI consistency
- [ ] Network layer tests with URLProtocol mocking
- [ ] Biometric authentication tests
- [ ] Wallet creation/import tests
- [ ] Transaction signing tests


