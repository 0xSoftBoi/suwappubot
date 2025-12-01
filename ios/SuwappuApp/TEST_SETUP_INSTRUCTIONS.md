# Test Setup Instructions

## ⚠️ Important: Tests Need to be Added to Xcode Project

The test files exist in the file system, but they need to be added to the Xcode project target to run.

## Quick Setup (5 minutes)

### Step 1: Add Test Target (if not exists)

1. In Xcode: **File → New → Target**
2. Choose **"iOS Unit Testing Bundle"**
3. Product Name: `SuwappuAppTests`
4. Click **Finish**

### Step 2: Add All Test Files

1. In Project Navigator, **right-click** on `SuwappuAppTests` folder
2. Select **"Add Files to SuwappuApp..."**
3. Navigate to: `SuwappuAppTests/` folder
4. Select **ALL** folders and files:
   - ✅ Helpers/
   - ✅ Models/
   - ✅ Services/
   - ✅ Utils/
   - ✅ ViewModels/
   - ✅ SuwappuAppTests.swift
5. **Important**: Check **"Add to targets: SuwappuAppTests"** ✅
6. Select **"Create groups"** (not folder references)
7. Click **"Add"**

### Step 3: Add UI Test Target (if not exists)

1. **File → New → Target**
2. Choose **"iOS UI Testing Bundle"**
3. Product Name: `SuwappuAppUITests`
4. Click **Finish**

### Step 4: Add UI Test Files

1. Right-click on `SuwappuAppUITests` folder
2. **Add Files to SuwappuApp...**
3. Select `SuwappuAppUITests/SuwappuAppUITests.swift`
4. Check **"Add to targets: SuwappuAppUITests"** ✅
5. Click **"Add"**

### Step 5: Verify Test Target Settings

1. Select **SuwappuAppTests** target
2. Go to **"Build Settings"**
3. Search for **"Test Host"**
4. Set to: `$(BUILT_PRODUCTS_DIR)/SuwappuApp.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/SuwappuApp`

## Run Tests

After setup:

1. **Press ⌘U** (Cmd + U) to run all tests
2. Or use **Test Navigator** (⌘6) to see all tests
3. Click **▶️** play button to run

## Verify Setup

You should see in Test Navigator:
- ✅ SuwappuAppTests
  - ✅ AuthViewModelTests
  - ✅ SwapViewModelTests
  - ✅ KeychainServiceTests
  - ✅ UserTests
  - ✅ ChainTests
  - ✅ And more...
- ✅ SuwappuAppUITests
  - ✅ SuwappuAppUITests

## Troubleshooting

### "No such module 'SuwappuApp'"
- Ensure test files have `@testable import SuwappuApp`
- Check test target's "Test Host" setting

### Tests don't appear
- Verify files are added to test target
- Check Build Phases → Compile Sources includes test files

### Build errors
- Clean: **Product → Clean Build Folder** (⇧⌘K)
- Rebuild: **⌘B**

## Next Steps

Once tests are set up:
1. Run all tests (⌘U)
2. Check test results
3. Fix any compilation errors
4. Add more tests as needed


