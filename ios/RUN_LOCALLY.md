# Running Suwappu iOS App Locally

## Quick Start (5 minutes)

### Prerequisites
- macOS with Xcode installed (Xcode 15.0+ recommended)
- iOS 16.0+ simulator or physical iPhone
- Apple Developer account (free account works for simulator)

### Step 1: Open Project in Xcode

```bash
cd /Users/mongolraider/suwappubot/ios/SuwappuApp
open SuwappuApp.xcodeproj
```

**OR** manually:
1. Open Xcode
2. File → Open
3. Navigate to `ios/SuwappuApp/SuwappuApp.xcodeproj`
4. Click Open

### Step 2: Configure Project

1. **Select Target**:
   - In Xcode, select "SuwappuApp" scheme (top toolbar)
   - Choose an iPhone simulator (e.g., "iPhone 15 Pro")

2. **Fix Project Structure** (if needed):
   - The project file may need files added manually
   - In Xcode Project Navigator, right-click on "SuwappuApp" folder
   - Select "Add Files to SuwappuApp..."
   - Navigate to `ios/SuwappuApp/SuwappuApp/`
   - Select all folders (App, Models, Views, ViewModels, Services, Utils)
   - Check "Copy items if needed" ✅
   - Check "Create groups" ✅
   - Click "Add"

3. **Configure Signing**:
   - Select project in navigator
   - Select "SuwappuApp" target
   - Go to "Signing & Capabilities" tab
   - Check "Automatically manage signing"
   - Select your Team (or add your Apple ID)

4. **Set Bundle Identifier**:
   - In General tab, set Bundle Identifier: `com.suwappu.app`
   - Or use: `com.yourname.suwappu`

### Step 3: Configure API (Optional for UI Testing)

If you want to test with a backend:

1. Edit `Services/APIService.swift`
2. Update the base URL:
   ```swift
   private let baseURL = "http://localhost:8000/api/v1"  // Local backend
   // OR
   private let baseURL = "https://api.suwappu.com/api/v1"  // Production
   ```

**Note**: The app will run without a backend - you can test the UI and navigation!

### Step 4: Build and Run

1. **Build**:
   - Press `⌘ + B` (Cmd + B)
   - Or: Product → Build
   - Wait for build to complete (check for errors)

2. **Run**:
   - Press `⌘ + R` (Cmd + R)
   - Or: Product → Run
   - Or: Click the Play button ▶️

3. **Simulator will launch**:
   - The app will install and launch automatically
   - You'll see the login/auth screen with sakura petal branding 🌸

## Troubleshooting

### Build Errors

**Error: "No such module"**
- Make sure all Swift files are added to the target
- Check that files are in the correct folders

**Error: "Missing files"**
- Re-add files to project (Step 2 above)
- Make sure "Create groups" is selected, not "Create folder references"

**Error: Signing issues**
- Go to Signing & Capabilities
- Enable "Automatically manage signing"
- Select your Apple ID/Team

**Error: "Cannot find type"**
- Check that all files are compiled
- Clean build folder: Product → Clean Build Folder (⇧⌘K)
- Rebuild: ⌘B

### Runtime Errors

**App crashes on launch**
- Check console for error messages
- Make sure all required files are included
- Verify Info.plist settings (if needed)

**API errors**
- This is expected if backend isn't running
- The app UI will still work for testing
- You can test navigation and UI without backend

**Simulator issues**
- Restart simulator: Device → Restart
- Reset simulator: Device → Erase All Content and Settings

## Testing Without Backend

The app is designed to work without a backend for UI testing:

- ✅ All screens are accessible
- ✅ Navigation works
- ✅ UI components render correctly
- ✅ Sakura branding displays
- ❌ API calls will fail (expected)
- ❌ Login won't work (needs backend)

## Next Steps

1. **Test UI**: Navigate through all screens
2. **Test Branding**: See sakura petal theme 🌸
3. **Set up Backend**: See `IPHONE_APP_PLAN.md` for API setup
4. **Add Dependencies**: Add Web3.swift, Solana.swift when ready

## Quick Commands

```bash
# Open project
cd ios/SuwappuApp && open SuwappuApp.xcodeproj

# Clean build (if needed)
# In Xcode: Product → Clean Build Folder (⇧⌘K)

# Run tests (when added)
# In Xcode: Product → Test (⌘U)
```

## Simulator Shortcuts

- **Rotate**: ⌘← or ⌘→
- **Home**: ⇧⌘H
- **Screenshot**: ⌘S
- **Restart**: Device → Restart

## What You'll See

When you run the app, you'll see:

1. **Auth Screen** with:
   - Sakura logo 🌸
   - Animated falling petals
   - Login/Register form
   - Pink gradient buttons

2. **Main App** (after login - UI only):
   - Home tab with portfolio card
   - Swap tab with token selection
   - Wallets tab
   - History tab
   - Settings tab

All screens feature the Japanese sakura petal branding theme!


