# Running Tests for Suwappu iOS App

## Quick Start

### Option 1: Run Tests Script (Recommended)

```bash
cd /Users/mongolraider/suwappubot/ios/SuwappuApp
./run_tests.sh
```

This script will:
- Check for Xcode installation
- Find available simulators
- Run tests automatically

### Option 2: Run Tests in Xcode (Easiest)

1. **Open the project**:
   ```bash
   cd /Users/mongolraider/suwappubot/ios/SuwappuApp
   open SuwappuApp.xcodeproj
   ```

2. **Run all tests**:
   - Press `⌘U` (Cmd + U)
   - Or: Product → Test

3. **Run specific test**:
   - Click the diamond icon (◊) next to the test method
   - Or: Right-click test → Run

## Setting Up Tests in Xcode

If tests don't run, you may need to set up the test target:

### Step 1: Add Test Files to Target

1. In Xcode, select the project in Navigator
2. Select "SuwappuApp" target
3. Go to "Build Phases" tab
4. Expand "Compile Sources"
5. Click "+" and add all test files from `SuwappuAppTests/`

### Step 2: Create Test Target (if needed)

1. File → New → Target
2. Choose "iOS Unit Testing Bundle"
3. Name it "SuwappuAppTests"
4. Add test files to this target

### Step 3: Configure Test Scheme

1. Product → Scheme → Edit Scheme
2. Select "Test" in left sidebar
3. Check "SuwappuAppTests" target
4. Click "Close"

## Test Structure

```
SuwappuAppTests/
├── ViewModels/          # ViewModel tests
├── Services/            # Service tests
├── Models/              # Model tests
├── Utils/               # Utility tests
└── Helpers/             # Mock services

SuwappuAppUITests/
└── SuwappuAppUITests.swift  # UI tests
```

## Running Specific Tests

### In Xcode

- **Single test**: Click diamond icon next to test method
- **Test class**: Click diamond icon next to class name
- **Test suite**: Right-click folder → Run Tests

### Command Line (requires full Xcode)

```bash
# Run all tests
xcodebuild test \
  -project SuwappuApp.xcodeproj \
  -scheme SuwappuApp \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro'

# Run specific test class
xcodebuild test \
  -project SuwappuApp.xcodeproj \
  -scheme SuwappuApp \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -only-testing:SuwappuAppTests/AuthViewModelTests

# Run specific test method
xcodebuild test \
  -project SuwappuApp.xcodeproj \
  -scheme SuwappuApp \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -only-testing:SuwappuAppTests/AuthViewModelTests/testLogin_Success
```

## Test Coverage

To see test coverage:

1. Product → Scheme → Edit Scheme
2. Select "Test" → "Options"
3. Check "Code Coverage"
4. Run tests
5. View coverage: Report Navigator (⌘9) → Coverage

## Troubleshooting

### "No such module 'SuwappuApp'"
- Ensure test files are added to test target
- Check that `@testable import SuwappuApp` is present

### Tests don't appear
- Add test files to test target in Build Phases
- Clean build folder: Product → Clean Build Folder (⇧⌘K)

### Simulator issues
- Reset simulator: Device → Erase All Content and Settings
- Create new simulator if needed

### Mock services not working
- Ensure you're using `MockAPIService.sharedMock`
- Check mocks are reset in `setUp()`

## Expected Test Results

When tests run successfully, you should see:

```
✅ AuthViewModelTests
  ✅ testInitialState
  ✅ testCheckAuthenticationStatus_WithToken
  ✅ testLogin_Success
  ✅ testLogout

✅ SwapViewModelTests
  ✅ testInitialState
  ✅ testCanGetQuote_WithAllFields
  ✅ testReset

✅ KeychainServiceTests
  ✅ testSaveAndGetAccessToken
  ✅ testClearTokens

... and more
```

## Continuous Integration

For CI/CD, add to your workflow:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: |
    xcodebuild test \
      -project SuwappuApp.xcodeproj \
      -scheme SuwappuApp \
      -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

## Next Steps

1. ✅ Run tests to verify everything works
2. ✅ Add more tests as you develop features
3. ✅ Set up CI/CD to run tests automatically
4. ✅ Aim for > 80% code coverage


