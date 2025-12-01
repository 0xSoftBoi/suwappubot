# Quick Test Guide 🧪

## Run Tests Now (3 Steps)

### 1. Open Xcode
```bash
cd /Users/mongolraider/suwappubot/ios/SuwappuApp
open SuwappuApp.xcodeproj
```

### 2. Add Test Files to Target
- In Xcode Project Navigator, select `SuwappuAppTests` folder
- Right-click → "Add Files to SuwappuApp..."
- Select all test files
- Check "Add to targets: SuwappuAppTests" ✅
- Click "Add"

### 3. Run Tests
- Press **⌘U** (Cmd + U)
- Or click **▶️** Play button in test navigator

## What Tests Are Available?

### ✅ Unit Tests (50+ tests)
- **AuthViewModelTests** - Login, register, logout
- **SwapViewModelTests** - Swap quote validation
- **WalletsViewModelTests** - Wallet management
- **APIServiceTests** - API calls
- **KeychainServiceTests** - Secure storage
- **UserTests** - User model
- **ChainTests** - Chain lookup
- **SwapTests** - Swap status

### ✅ UI Tests
- **SuwappuAppUITests** - Screen navigation, forms

## Quick Commands

```bash
# Run test script
./run_tests.sh

# Open project
open SuwappuApp.xcodeproj

# View test files
ls -R SuwappuAppTests/
```

## Test Results

After running, you'll see:
- ✅ Green checkmarks for passing tests
- ❌ Red X for failing tests
- Test execution time
- Code coverage (if enabled)

## Need Help?

See `RUN_TESTS.md` for detailed instructions.


