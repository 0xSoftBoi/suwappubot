# Implementation Plan: Web Dashboard & iOS Foundation

This plan outlines the steps to build the Web Dashboard (FastAPI + Next.js) and refine the iOS Foundation.

## 1. Web Dashboard (High Priority)
We will build a professional, premium-looking dashboard that allows users to manage their bot activity via the web.

### Backend (FastAPI)
- **Location**: `api/`
- **Goal**: Provide a RESTful API for the web dashboard.
- **Features**:
  - Connect to the existing bot database (SQLite/PostgreSQL).
  - Endpoints:
    - `GET /user/{user_id}/portfolio`: Aggregated balances.
    - `GET /user/{user_id}/history`: Swap transaction history.
    - `GET /user/{user_id}/orders`: Active limit and DCA orders.
    - `POST /user/{user_id}/orders`: Create new orders.

### Frontend (Next.js + Tailwind)
- **Location**: `dashboard/`
- **Aesthetics**: Premium Dark Mode, Glassmorphism, Dynamic Gradients (Inter font).
- **Architecture**:
  - `components/`: Sidebar, Stat Cards, Order Table, Portfolio Pie Chart.
  - `pages/`: Dashboard, History, Orders.
  - `services/`: API client for the FastAPI backend.

## 2. iOS App Foundation
The `ios` directory already exists with a project structure. We will focus on:
- Completing the **Wallet View** to show real-time balances.
- Implementing the **API Integration layer** to talk to the same FastAPI backend used by the Web Dashboard.
- Ensuring the app follows the `IPHONE_APP_PLAN.md` specification for a premium native experience.

## Verification Plan
1. **API**: Test FastAPI endpoints using `curl` or Swagger UI (`/docs`).
2. **Web**: Run Next.js in dev mode and verify data fetching from the API.
3. **iOS**: Build the app (simulated) and verify the mock UI updates with real data logic.

---

# Execution Steps

### Phase 1: Dashboard API (FastAPI)
1. Create `api/main.py`.
2. Implement database connection and models reuse.
3. Define Pydantic schemas for API response.
4. Implement endpoints for Portfolio and History.

### Phase 2: Web Dashboard (Next.js)
1. Initialize Next.js app in `/dashboard`.
2. Setup styling (Tailwind + CSS).
3. Build the Dashboard UI.

### Phase 3: iOS Refinement
1. Review `ios/SuwappuApp` content.
2. Implement backend communication layer.
