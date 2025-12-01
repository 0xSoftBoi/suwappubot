# 🚀 Quick Start - Run Suwappu iOS App Locally

## Fastest Way (2 minutes)

### Option 1: Use the Run Script

```bash
cd /Users/mongolraider/suwappubot/ios
./run.sh
```

This will:
- ✅ Check Xcode installation
- ✅ Verify project files
- ✅ Open Xcode automatically

### Option 2: Manual Open

```bash
cd /Users/mongolraider/suwappubot/ios/SuwappuApp
open SuwappuApp.xcodeproj
```

## After Xcode Opens

### Step 1: Add All Source Files

The project file is minimal - you need to add all Swift files:

1. **In Xcode Project Navigator** (left sidebar):
   - Right-click on "SuwappuApp" (blue icon)
   - Select **"Add Files to SuwappuApp..."**

2. **Navigate and Select**:
   - Go to: `ios/SuwappuApp/SuwappuApp/`
   - Select these folders:
     - ✅ `App/`
     - ✅ `Models/`
     - ✅ `Views/`
     - ✅ `ViewModels/`
     - ✅ `Services/`
     - ✅ `Utils/`

3. **Important Settings**:
   - ✅ Check **"Copy items if needed"**
   - ✅ Check **"Create groups"** (NOT "Create folder references")
   - ✅ Check **"Add to targets: SuwappuApp"**
   - Click **"Add"**

### Step 2: Configure Signing

1. Click **"SuwappuApp"** (blue icon) in Project Navigator
2. Select **"SuwappuApp"** target (under TARGETS)
3. Go to **"Signing & Capabilities"** tab
4. Check **"Automatically manage signing"**
5. Select your **Team** (or add Apple ID)

### Step 3: Select Simulator

1. In top toolbar, click the device selector
2. Choose an iPhone simulator (e.g., "iPhone 15 Pro")
3. If none available: Xcode → Settings → Platforms → Download iOS Simulator

### Step 4: Build & Run

1. Press **⌘R** (Cmd + R) or click **▶️ Play button**
2. Wait for build (first time may take 1-2 minutes)
3. Simulator will launch automatically
4. App will install and run! 🌸

## What You'll See

- **Login Screen** with animated sakura petals 🌸
- Beautiful pink gradient branding
- All UI screens ready to navigate

## Troubleshooting

### "No such module" errors
→ Make sure all files were added in Step 1

### Build fails
→ Clean: **Product → Clean Build Folder** (⇧⌘K), then rebuild

### Signing errors
→ Check Step 2 - make sure signing is configured

### Simulator won't launch
→ Xcode → Settings → Platforms → Download iOS Simulator

## Testing Without Backend

The app works great for UI testing without a backend:
- ✅ All screens accessible
- ✅ Navigation works
- ✅ Sakura branding displays
- ✅ Beautiful animations

API calls will fail (expected) - but you can test the entire UI!

## Next Steps

1. ✅ Run the app and explore UI
2. 🔧 Set up backend API (see `IPHONE_APP_PLAN.md`)
3. 📦 Add blockchain libraries when ready
4. 🧪 Add tests

## Need Help?

See `RUN_LOCALLY.md` for detailed instructions.


