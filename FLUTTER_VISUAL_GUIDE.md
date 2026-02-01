# 📱 PayMe Flutter App - Visual Guide

A quick visual reference for the entire project.

---

## 🎯 App Overview (One Page)

```
┌─────────────────────────────────────────────────────────┐
│                  PayMe Business Manager                 │
│                (Flutter Android App)                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  For: Business owners in Kenya                          │
│  Features: Inventory, Sales, Payments, Wallet, Credit  │
│  Tech: Flutter, Riverpod, Dio, JWT, M-Pesa            │
│  Timeline: 4-5 weeks to MVP                            │
│  Team: 1-2 Flutter devs + Backend support             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📱 App Screens Map

```
                    ┌─────────────┐
                    │ Splash      │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Auth Check  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                                     │
        NO TOKEN                      TOKEN VALID
        │                                     │
    ┌───▼────┐                          ┌────▼───┐
    │Login   │                          │Dashboard
    │Screen  │                          │(+ Bottom Nav)
    │        │                          │
    │ Email  │                          ├─ Dashboard Tab
    │Password│                          ├─ Inventory Tab
    │        │                          ├─ Sales Tab
    │ [Sign-│                          ├─ Credit Tab
    │  In] [Sign-│                    ├─ Settings Tab
    │       Up]  │                    └─────┬────┘
    └───────┘    │                          │
                 └──────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
            ┌───────▼────────┐ ┌────▼──────┐ ┌──────▼──┐
            │ Setup Payment  │ │ Dashboard │ │Business │
            │(Post-Signup)   │ │ Stats     │ │ Selector│
            │                │ │ Quick     │ │ (Float) │
            │ Select:        │ │ Actions   │ │         │
            │ - Till         │ │           │ │ Select: │
            │ - Paybill      │ │ TODAY:    │ │ Switch  │
            │ - Wallet       │ │ Sales: 5  │ │ Business│
            │                │ │ Revenue:  │ │         │
            │ Enter Config   │ │ KSH 2500  │ │ New:    │
            │                │ │           │ │ Create  │
            │ [Complete]     │ │ Actions:  │ │ Business│
            │                │ │ + Sale    │ └─────────┘
            │                │ │ + Stock   │
            │                │ │ + Credit  │
            └────────────────┘ └───────────┘
```

---

## 📲 Bottom Navigation Tabs

```
┌──────────────────────────────────────────────────────┐
│ Screen Content                                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│                                                      │
│              (Tab-Specific Content)                  │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ [🏠]   [📦]      [💰]      [📝]      [⚙️]            │
│ Home  Inventory  Sales    Credit   Settings         │
│                                                      │
│ ← Active Tab (Bold/Colored)                          │
└──────────────────────────────────────────────────────┘
```

---

## 🔄 Sales Flow (Simplified)

```
Create Sale
  │
  ├─ Add Product
  ├─ Set Quantity
  ├─ Review Total
  │
  └─ Select Payment
     │
     ├─ CASH
     │  ├─ Enter Amount
     │  └─ [Pay] → Complete → Deduct Stock
     │
     └─ M-PESA
        ├─ Enter Phone
        ├─ [Request] → STK Push
        ├─ Customer enters PIN
        ├─ Callback received
        └─ Complete → Deduct Stock
```

---

## 💳 Wallet Token Flow

```
Token Purchase
  │
  ├─ Select Package
  │  ├─ 10 tokens @ KSH 20
  │  ├─ 30 tokens @ KSH 50 (save KSH 10)  ← DISCOUNT
  │  └─ 100 tokens @ KSH 150 (save KSH 50)
  │
  └─ [Buy] → STK Push → Payment → Add Tokens

Sale Creation
  │
  └─ RESERVE 1 token per sale

Payment Complete
  │
  └─ CHARGE 1 token (deduct from balance)

Cancel Sale
  │
  └─ REFUND 1 token (add back to balance)
```

---

## 📊 Data Model Relationships

```
User (1)
  │
  ├─ (Many) Businesses
  │           │
  │           ├─ (1) Wallet
  │           │      └─ (Many) Transactions
  │           │
  │           ├─ (Many) Products
  │           │      └─ (Many) Stock Batches
  │           │
  │           ├─ (Many) Sales
  │           │      └─ (Many) Sale Items
  │           │
  │           ├─ (1) PaymentConfig
  │           │
  │           ├─ (Many) CreditAccounts
  │           │
  │           ├─ (Many) HPAgreements
  │           │
  │           ├─ (Many) Expenses
  │           │
  │           └─ (Many) SpoilageRecords
  │
  └─ (1) UserProfile
```

---

## 🏗️ Folder Structure (Visual)

```
lib/
├── 📁 screens/
│   ├── 📁 auth/
│   │   ├── 📄 login_screen.dart
│   │   ├── 📄 signup_screen.dart
│   │   ├── 📄 splash_screen.dart
│   │   └── 📄 biometric_screen.dart
│   │
│   ├── 📁 dashboard/
│   │   └── 📄 dashboard_screen.dart
│   │
│   ├── 📁 inventory/
│   │   ├── 📄 inventory_screen.dart
│   │   ├── 📄 add_product_screen.dart
│   │   └── 📄 add_stock_screen.dart
│   │
│   ├── 📁 sales/
│   │   ├── 📄 sales_list_screen.dart
│   │   ├── 📄 create_sale_screen.dart
│   │   └── 📄 payment_screen.dart
│   │
│   └── 📁 settings/
│       ├── 📄 settings_screen.dart
│       ├── 📄 profile_screen.dart
│       └── 📄 wallet_screen.dart
│
├── 📁 services/
│   ├── 📁 api/
│   │   ├── 📄 api_client.dart
│   │   ├── 📄 auth_api.dart
│   │   ├── 📄 sales_api.dart
│   │   └── 📄 [more APIs...]
│   │
│   ├── 📄 local_storage.dart
│   └── 📄 biometric_service.dart
│
├── 📁 models/
│   ├── 📄 user.dart
│   ├── 📄 business.dart
│   ├── 📄 sale.dart
│   └── 📄 [more models...]
│
├── 📁 providers/
│   ├── 📄 auth_provider.dart
│   ├── 📄 business_provider.dart
│   ├── 📄 sales_provider.dart
│   └── 📄 [more providers...]
│
├── 📁 widgets/
│   ├── 📄 app_button.dart
│   ├── 📄 app_text_field.dart
│   └── 📄 [more widgets...]
│
└── 📁 utils/
    ├── 📄 validators.dart
    ├── 📄 formatters.dart
    └── 📄 [more utils...]
```

---

## 🔌 API Layer Diagram

```
┌─────────────────────────┐
│   Flutter App           │
│  (Screens & Widgets)    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Riverpod Providers    │
│  (State Management)     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   API Services          │
│  (Dio HTTP Client)      │
│                         │
│  - AuthAPI              │
│  - BusinessAPI          │
│  - SalesAPI             │
│  - WalletAPI            │
│  - etc.                 │
└────────────┬────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────────┐  ┌──────────────┐
│ Local       │  │  Backend     │
│ Storage     │  │  (Node.js)   │
│ (Secure)    │  │              │
└─────────────┘  │ Express.js   │
                 │ + PostgreSQL │
                 └──────────────┘
```

---

## 📈 Development Phase Timeline

```
Week 1
┌──────────────────────────┐
│ Phase 1: Foundation      │
│ - Auth (Login/Signup)    │
│ - Business CRUD          │
│ - JWT Handling           │
└──────────────────────────┘

Week 1-2
┌──────────────────────────┐
│ Phase 2: Business Mgmt   │
│ - Business Settings      │
│ - Payment Config         │
│ - Business Switching     │
└──────────────────────────┘

Week 2-3
┌──────────────────────────┐
│ Phase 3: Inventory       │
│ - Products (CRUD)        │
│ - Stock Management       │
│ - FIFO Tracking          │
│ - Spoilage Recording     │
└──────────────────────────┘

Week 3-4
┌──────────────────────────┐
│ Phase 4: Sales           │
│ - Create Sale            │
│ - Cash Payment           │
│ - M-Pesa Payment         │
│ - Stock Deduction        │
└──────────────────────────┘

Week 4
┌──────────────────────────┐
│ Phase 5: Finance         │
│ - Wallet & Tokens        │
│ - Credit Management      │
│ - Hire Purchase          │
│ - Expense Tracking       │
└──────────────────────────┘

Week 4-5
┌──────────────────────────┐
│ Phase 6: Polish          │
│ - Settings               │
│ - Biometric Login        │
│ - UX Improvements        │
│ - Error Handling         │
└──────────────────────────┘

Week 5
┌──────────────────────────┐
│ Phase 7: Testing         │
│ - Unit Tests             │
│ - Integration Tests      │
│ - Manual Testing         │
│ - Bug Fixes              │
│ - Release Build          │
└──────────────────────────┘
```

---

## 🧪 Testing Pyramid

```
         ▲
        ╱│╲
       ╱ │ ╲              End-to-End Tests
      ╱──┼──╲            (Full user journeys)
     ╱   │   ╲           ≈ 10-15 tests
    ╱────┼────╲
   ╱     │     ╲         Integration Tests
  ╱──────┼──────╲       (API + State combos)
 ╱       │       ╲     ≈ 20-30 tests
╱────────┼────────╲
         │         Unit Tests
         │        (Models, Utils, Logic)
         │        ≈ 50-100 tests
         │
         ▼
```

---

## 🔐 Security Flow

```
User Input
  │
  ▼
Client-side Validation
  ├─ Empty check
  ├─ Format check (phone)
  ├─ Length check
  │
  ▼
Send to Backend
  │
  ├─ Header: Authorization: Bearer <JWT>
  ├─ Body: Encrypted if sensitive
  │
  ▼
Backend Validation
  ├─ Zod schema validation
  ├─ Business ownership check
  ├─ Rate limiting (Arcjet)
  │
  ▼
Database Operation
  │
  ├─ Transaction if needed
  ├─ Audit logging
  │
  ▼
Response to App
  ├─ Success: Update local state
  └─ Error: Show user-friendly message
```

---

## 🎓 Key Concepts at a Glance

```
RIVERPOD
├─ FutureProvider      (Async data - network calls)
├─ StateProvider       (Mutable state - selections)
├─ StateNotifier       (Complex state - auth logic)
│
└─ Usage:
   ├─ watch()  - Subscribe to changes
   ├─ read()   - Get value once
   ├─ refresh()- Refetch data
   └─ listen() - Side effects


TOKEN ECONOMICS
├─ Purchase: Package → STK Push → Payment → Add Tokens
├─ Reserve:  Sale Creation → -1 Token
├─ Charge:   Payment Complete → -1 Token
├─ Refund:   Sale Cancelled → +1 Token
│
└─ Ratio: 1 Token = KSH 2


STOCK MANAGEMENT (FIFO)
├─ Add:    Create Batch with unit_cost
├─ Track:  Oldest batch first
├─ Deduct: On payment completion
├─ Profit: sum(qty * (price - cost))
│
└─ Why FIFO: Accurate profit calculation


M-PESA INTEGRATION
├─ Business: Uses paymentConfigs (per-business)
├─ Wallet:   Uses fixed paybill 650880
├─ Flow:     STK → Customer PIN → Callback → Complete
├─ Status:   Pending → Completed/Failed
│
└─ Callback: Updates sale, deducts stock
```

---

## 📚 Document Quick Links

```
START HERE (10 min)
  └─ FLUTTER_PROJECT_SUMMARY.md

LEARN ARCHITECTURE (50 min)
  └─ FLUTTER_ARCHITECTURE.md

IMPLEMENT FEATURES (Ongoing)
  ├─ FLUTTER_INTEGRATION_GUIDE.md (Reference)
  ├─ FLUTTER_IMPLEMENTATION_ROADMAP.md (Follow)
  └─ FLUTTER_QUICK_REFERENCE.md (Keep on desk)

TRACK PROGRESS (Daily)
  └─ FLUTTER_IMPLEMENTATION_ROADMAP.md

SOLVE PROBLEMS
  ├─ FLUTTER_QUICK_REFERENCE.md (Common bugs)
  └─ BACKEND_ANALYSIS_ISSUES.md (Backend gaps)

NAVIGATE DOCS
  └─ FLUTTER_DOCUMENTATION_INDEX.md
```

---

## ✅ Checklist Before Starting

- [ ] **Backend team** fixed 3 critical endpoints
- [ ] **Flutter environment** setup (Flutter SDK, emulator)
- [ ] **Read** FLUTTER_PROJECT_SUMMARY.md
- [ ] **Study** FLUTTER_ARCHITECTURE.md
- [ ] **Print** FLUTTER_QUICK_REFERENCE.md
- [ ] **Understand** M-Pesa flow & token economics
- [ ] **Bookmark** FLUTTER_INTEGRATION_GUIDE.md
- [ ] **Review** FLUTTER_IMPLEMENTATION_ROADMAP.md
- [ ] **Team knows** daily standup schedule
- [ ] **Git repo** created with initial structure

---

## 🎯 Success Criteria

```
Functionality
├─ All core features working ✓
├─ Edge cases handled ✓
└─ Error messages user-friendly ✓

Performance
├─ App startup < 2 seconds ✓
├─ API responses < 5 seconds ✓
├─ Scrolling smooth (60 FPS) ✓
└─ App size < 100MB ✓

Quality
├─ 80% test coverage ✓
├─ 0 crashes in QA ✓
├─ All screens responsive ✓
└─ Code reviewed ✓

User Experience
├─ Intuitive navigation ✓
├─ Consistent styling ✓
├─ Clear error messages ✓
└─ Fast feedback ✓
```

---

## 🚀 GO TIME!

You have everything you need:
- ✅ Complete architecture documented
- ✅ API integration guide ready
- ✅ 7-phase implementation roadmap
- ✅ Backend readiness assessment
- ✅ Quick reference materials

**Start coding! 🎉**

