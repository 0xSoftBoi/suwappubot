# Suwappu iOS App - Setup Guide

## Quick Start

The iOS app source code has been created in the `ios/SuwappuApp/` directory. To get started:

### Option 1: Create New Xcode Project (Recommended)

Since Xcode project files are complex, it's recommended to create a new project:

1. **Open Xcode**
2. **Create New Project**:
   - File → New → Project
   - Choose "iOS" → "App"
   - Product Name: `SuwappuApp`
   - Interface: SwiftUI
   - Language: Swift
   - Storage: None (or Core Data if you want local storage)

3. **Replace Generated Files**:
   - Copy all files from `ios/SuwappuApp/SuwappuApp/` to your new Xcode project
   - Maintain the folder structure:
     - `App/` folder
     - `Models/` folder
     - `ViewModels/` folder
     - `Views/` folder
     - `Services/` folder
     - `Utils/` folder

4. **Add Files to Xcode**:
   - Right-click on your project in Xcode
   - Select "Add Files to SuwappuApp..."
   - Select all the folders/files
   - Make sure "Copy items if needed" is checked
   - Select "Create groups" (not folder references)

### Option 2: Use Existing Project File

If you want to use the provided `.xcodeproj` file:

1. **Open the project**:
   ```bash
   cd ios/SuwappuApp
   open SuwappuApp.xcodeproj
   ```

2. **Add all source files**:
   - The project file is minimal - you'll need to add all Swift files manually
   - Drag and drop files from Finder into Xcode project navigator

## Configuration

### 1. Update API Base URL

Edit `Services/APIService.swift`:

```swift
private let baseURL = "https://your-api-url.com/api/v1"
```

### 2. Configure Bundle Identifier

In Xcode:
- Select project → Target → General
- Update Bundle Identifier: `com.suwappu.app` (or your own)

### 3. Set Development Team

- Select project → Target → Signing & Capabilities
- Choose your development team
- Enable "Automatically manage signing"

### 4. Add Required Capabilities

In Signing & Capabilities, add:
- **Keychain Sharing** (for secure storage)
- **Push Notifications** (for transaction alerts)
- **Face ID / Touch ID** (for biometric auth)

### 5. Add Dependencies (Swift Package Manager)

In Xcode:
- File → Add Packages
- Add these packages:

**Web3.swift** (for EVM chains):
```
https://github.com/argentlabs/web3.swift
```

**Solana.swift** (for Solana):
```
https://github.com/metaplex-foundation/solana-swift
```

**Optional - Charts**:
```
https://github.com/apple/swift-charts
```

## Build and Run

1. **Select a target**:
   - Choose iPhone simulator or connected device

2. **Build**:
   - Press `Cmd+B` or Product → Build

3. **Run**:
   - Press `Cmd+R` or Product → Run

## Project Structure

```
SuwappuApp/
├── App/
│   ├── SuwappuApp.swift       # App entry point
│   └── ContentView.swift      # Root view
├── Models/
│   ├── Chain.swift
│   ├── Token.swift
│   ├── User.swift
│   ├── Wallet.swift
│   └── Swap.swift
├── ViewModels/
│   ├── AuthViewModel.swift
│   ├── SwapViewModel.swift
│   ├── WalletsViewModel.swift
│   ├── HistoryViewModel.swift
│   └── PortfolioViewModel.swift
├── Views/
│   ├── AuthView.swift
│   ├── HomeView.swift
│   ├── SwapView.swift
│   ├── WalletsView.swift
│   ├── HistoryView.swift
│   └── SettingsView.swift
├── Services/
│   ├── APIService.swift
│   ├── KeychainService.swift
│   ├── AuthService.swift
│   └── NotificationService.swift
└── Utils/
    └── AppState.swift
```

## Next Steps

1. **Backend API**: Implement the REST API endpoints (see `IPHONE_APP_PLAN.md`)
2. **Blockchain Integration**: Add Web3.swift and Solana.swift for transaction signing
3. **Testing**: Add unit tests and UI tests
4. **UI Polish**: Enhance UI/UX with animations and better design
5. **Features**: Implement remaining features (alerts, limit orders, etc.)

## Troubleshooting

### Build Errors

- **Missing files**: Make sure all Swift files are added to the target
- **Import errors**: Check that all dependencies are added via SPM
- **Signing errors**: Configure your development team in Signing & Capabilities

### Runtime Errors

- **API errors**: Check that the backend API is running and accessible
- **Keychain errors**: Ensure Keychain Sharing capability is enabled
- **Biometric errors**: Test on a real device (simulator has limited biometric support)

## Resources

- [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui/)
- [iOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/ios)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)


