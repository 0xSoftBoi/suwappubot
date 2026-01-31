# Suwappu Webapp Features

## Architecture Overview

```mermaid
graph TB
    subgraph "Frontend (React)"
        W[Webapp<br/>React + Vite]
        
        subgraph "Pages"
            P1[Welcome]
            P2[Home]
            P3[Swap]
            P4[Wallet]
            P5[Portfolio]
            P6[History]
            P7[Points]
            P8[Settings]
        end
        
        subgraph "Hooks"
            H1[usePortfolio]
            H2[useSwapHistory]
            H3[useSwapQuote]
            H4[useFavorites]
            H5[useWallet]
            H6[useTelegram]
        end
    end
    
    subgraph "Backend (Hono + Effect)"
        API[API-TS<br/>Bun + Hono]
        
        subgraph "Routes"
            R1[/webapp/*]
            R2[/agent/*]
            R3[/a2a/*]
            R4[/health]
        end
        
        subgraph "Services"
            S1[UserService]
            S2[WalletService]
            S3[SwapService]
            S4[PointsService]
            S5[BalanceService]
            S6[TurnkeyService]
        end
    end
    
    subgraph "External"
        TG[Telegram<br/>Mini App]
        LF[Li.Fi API]
        JUP[Jupiter API]
        TK[Turnkey<br/>Wallets]
        RDS[(PostgreSQL<br/>RDS)]
    end
    
    W --> API
    W --> TG
    API --> LF
    API --> JUP
    API --> TK
    API --> RDS
    
    P1 --> H6
    P2 --> H1
    P3 --> H3
    P4 --> H5
    P5 --> H1
    P6 --> H2
    P7 --> API
    P8 --> API
```

## Feature Implementation Plan

```mermaid
gantt
    title Webapp Feature Roadmap
    dateFormat  YYYY-MM-DD
    section Core (Done)
    Portfolio View      :done, 2026-01-01, 2026-01-30
    Token Swap          :done, 2026-01-01, 2026-01-30
    Wallet Balance      :done, 2026-01-01, 2026-01-30
    Settings            :done, 2026-01-01, 2026-01-30
    
    section Sprint 1 (Current)
    Swap History        :done, feat1, 2026-01-31, 1d
    Points & Rewards    :done, feat2, 2026-01-31, 1d
    Favorites           :done, feat3, 2026-01-31, 1d
    
    section Sprint 2 (Next)
    Limit Orders        :feat4, after feat3, 3d
    Price Alerts        :feat5, after feat4, 2d
    Quick Swap          :feat6, after feat3, 1d
    
    section Sprint 3
    Copy Trading        :feat7, after feat6, 5d
    Referral System     :feat8, after feat5, 2d
    Gas Settings        :feat9, after feat6, 1d
    Subscriptions       :feat10, after feat8, 3d
```

## Feature Status

| # | Feature | Frontend | API | Bot | Status |
|---|---------|----------|-----|-----|--------|
| 1 | Portfolio View | ✅ | ✅ | ✅ | 🟢 Complete |
| 2 | Token Swap | ✅ | ✅ | ✅ | 🟢 Complete |
| 3 | Swap History | ✅ | ✅ | ✅ | 🟢 Complete |
| 4 | Wallet Balance | ✅ | ✅ | ✅ | 🟢 Complete |
| 5 | Settings | ✅ | ✅ | ✅ | 🟢 Complete |
| 6 | Points & Rewards | ✅ | ✅ | ✅ | 🟢 Complete |
| 7 | Favorites | ✅ | ❌ | ✅ | 🟡 Frontend only |
| 8 | Limit Orders | ❌ | ❌ | ✅ | 🔴 Todo |
| 9 | Price Alerts | ❌ | ❌ | ✅ | 🔴 Todo |
| 10 | Quick Swap | ❌ | ❌ | ✅ | 🔴 Todo |
| 11 | Copy Trading | ❌ | ❌ | ✅ | 🔴 Todo |
| 12 | Referral System | ❌ | ❌ | ✅ | 🔴 Todo |
| 13 | Gas Settings | ❌ | ❌ | ✅ | 🔴 Todo |
| 14 | Subscriptions | ❌ | ❌ | ✅ | 🔴 Todo |

## Page Routes

```mermaid
graph LR
    subgraph "Public"
        R1["/ (Welcome)"]
    end
    
    subgraph "Protected"
        R2["/home"]
        R3["/swap"]
        R4["/wallet"]
        R5["/portfolio"]
        R6["/history"]
        R7["/points"]
        R8["/settings"]
    end
    
    subgraph "Navigation Bar"
        N1[🏠 Home]
        N2[💳 Wallet]
        N3[🔄 Swap]
        N4[📜 History]
        N5[⚙️ Settings]
    end
    
    R1 -->|Auth| R2
    N1 --> R2
    N2 --> R4
    N3 --> R3
    N4 --> R6
    N5 --> R8
    
    R2 -->|Link| R7
    R2 -->|Link| R5
```

## Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Webapp
    participant A as API
    participant T as Telegram
    participant DB as Database
    
    U->>W: Open Mini App
    W->>T: Get initData
    T-->>W: User credentials
    W->>A: POST /webapp/telegram/auth
    A->>DB: Get/Create user
    A->>A: Create Turnkey wallet (if new)
    A-->>W: Session + wallet
    
    U->>W: View Portfolio
    W->>A: GET /webapp/me/portfolio
    A->>DB: Get wallets
    A->>A: Fetch balances (Li.Fi)
    A-->>W: Portfolio data
    
    U->>W: Execute Swap
    W->>A: GET /webapp/swap/quote
    A->>A: Li.Fi/Jupiter quote
    A-->>W: Quote
    W->>A: POST /webapp/swap/execute
    A->>A: Sign & broadcast tx
    A->>DB: Record swap
    A-->>W: Tx hash + status
```

## Environment Setup

### Development
- **Frontend:** `devfront.suwappu.bot`
- **API:** `devapi.suwappu.bot`
- **Database:** `suwappu-db-dev` (RDS)
- **Bot:** `@SuwappuDevBot`

### Production
- **Frontend:** `app.suwappu.bot`
- **API:** `api.suwappu.bot`
- **Database:** `suwappu-db` (RDS)
- **Bot:** `@SuwappuBot`

## CI/CD Pipeline

```mermaid
graph LR
    subgraph "GitHub"
        PR[Push to dev/main]
    end
    
    subgraph "GitHub Actions"
        B1[Build API]
        B2[Build Webapp]
        B3[Build Bot]
        T[Run Tests]
        S[Security Scan]
    end
    
    subgraph "AWS"
        ECR[ECR Registry]
        ECS[ECS Fargate]
        ALB[Load Balancer]
    end
    
    PR --> B1 & B2 & B3
    B1 & B2 & B3 --> T
    T --> S
    S --> ECR
    ECR --> ECS
    ECS --> ALB
```

## GitHub Issues

- [#94](https://github.com/0xSoftBoi/suwappubot/issues/94) ✅ Swap History
- [#95](https://github.com/0xSoftBoi/suwappubot/issues/95) ✅ Points & Rewards
- [#96](https://github.com/0xSoftBoi/suwappubot/issues/96) 🔴 Limit Orders
- [#97](https://github.com/0xSoftBoi/suwappubot/issues/97) 🔴 Price Alerts
- [#98](https://github.com/0xSoftBoi/suwappubot/issues/98) ✅ Favorite Tokens
- [#99](https://github.com/0xSoftBoi/suwappubot/issues/99) 🔴 Quick Swap
- [#100](https://github.com/0xSoftBoi/suwappubot/issues/100) 🔴 Copy Trading
- [#101](https://github.com/0xSoftBoi/suwappubot/issues/101) 🔴 Gas Settings
- [#102](https://github.com/0xSoftBoi/suwappubot/issues/102) 🔴 Referral System
- [#103](https://github.com/0xSoftBoi/suwappubot/issues/103) 🔴 Subscriptions
