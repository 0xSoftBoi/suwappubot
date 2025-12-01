# Suwappu iOS App

Native iOS application for Suwappu cross-chain token swapping platform.

## Project Structure

```
SuwappuApp/
├── SuwappuApp/
│   ├── App/
│   │   ├── SuwappuApp.swift          # App entry point
│   │   └── ContentView.swift         # Root view
│   ├── Models/
│   │   ├── Chain.swift               # Blockchain chain models
│   │   ├── Token.swift               # Token models
│   │   ├── User.swift                # User and auth models
│   │   ├── Wallet.swift              # Wallet models
│   │   └── Swap.swift                # Swap transaction models
│   ├── ViewModels/
│   │   ├── AuthViewModel.swift       # Authentication logic
│   │   ├── SwapViewModel.swift       # Swap logic
│   │   ├── WalletsViewModel.swift    # Wallet management
│   │   ├── HistoryViewModel.swift    # Transaction history
│   │   └── PortfolioViewModel.swift  # Portfolio tracking
│   ├── Views/
│   │   ├── AuthView.swift            # Login/Register
│   │   ├── HomeView.swift            # Home dashboard
│   │   ├── SwapView.swift            # Swap interface
│   │   ├── WalletsView.swift         # Wallet list
│   │   ├── HistoryView.swift         # Transaction history
│   │   └── SettingsView.swift       # App settings
│   ├── Services/
│   │   ├── APIService.swift          # Backend API client
│   │   ├── KeychainService.swift     # Secure storage
│   │   ├── AuthService.swift         # Biometric auth
│   │   └── NotificationService.swift # Push notifications
│   └── Utils/
│       └── AppState.swift            # Global app state
└── README.md
```

## Setup Instructions

### Prerequisites
- Xcode 15.0 or later
- iOS 16.0+ deployment target
- Swift 5.9+

### Installation

1. Open the project in Xcode:
   ```bash
   cd ios/SuwappuApp
   open SuwappuApp.xcodeproj
   ```

2. Configure API endpoint:
   - Update `APIService.baseURL` with your backend API URL
   - Or create a `Config.plist` file for configuration

3. Install dependencies:
   - This project uses Swift Package Manager
   - Add dependencies in Xcode: File → Add Packages
   - Required packages:
     - Web3.swift (for EVM chains)
     - Solana.swift (for Solana)

4. Configure signing:
   - Select your development team in Xcode
   - Update bundle identifier if needed

5. Build and run:
   - Select a simulator or device
   - Press Cmd+R to build and run

## Features Implemented

### ✅ Core Features
- [x] Project structure and architecture
- [x] Authentication system (login/register)
- [x] Secure token storage (Keychain)
- [x] Biometric authentication support
- [x] API service layer
- [x] Core data models (Chain, Token, Wallet, Swap)
- [x] Basic UI views (Auth, Home, Swap, Wallets, History, Settings)
- [x] ViewModels for MVVM architecture

### 🚧 TODO (Next Steps)
- [ ] Complete backend API implementation
- [ ] Blockchain integration (Web3.swift, Solana.swift)
- [ ] Transaction signing
- [ ] Real-time updates (WebSocket)
- [ ] Push notifications setup
- [ ] Portfolio tracking
- [ ] Price alerts
- [ ] Limit orders
- [ ] UI polish and animations
- [ ] Unit tests
- [ ] Integration tests

## API Integration

The app expects a REST API backend. See `IPHONE_APP_PLAN.md` for API endpoint specifications.

### Base URL Configuration
Update `APIService.baseURL` to point to your backend:
```swift
private let baseURL = "https://api.suwappu.com/api/v1"
```

## Security

- **Keychain**: All sensitive data stored in iOS Keychain
- **Biometric Auth**: Face ID/Touch ID for sensitive operations
- **Token Management**: JWT tokens with refresh mechanism
- **Private Keys**: Never stored unencrypted, only in Keychain

## Development Notes

- Uses SwiftUI for UI
- MVVM architecture pattern
- Async/await for networking
- Combine for reactive programming (where needed)

## Next Steps

1. Implement backend API endpoints
2. Add blockchain libraries (Web3.swift, Solana.swift)
3. Implement transaction signing
4. Add real-time updates
5. Polish UI/UX
6. Add comprehensive testing


