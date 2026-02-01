# Flutter App Implementation Roadmap - PayMe

**Project**: PayMe Business Manager (Flutter Android)  
**Duration**: 4-5 weeks (estimated)  
**Team**: 1-2 Flutter developers + backend support  
**Status**: Ready to start (after backend fixes)

---

## 📋 Pre-Implementation Checklist

### **Backend Verification (2-3 hours)**
- [ ] **CRITICAL**: Verify payment config integration
  - Endpoint: `GET /api/payment-config/:businessId`
  - Check: Does it return proper data?
  - Check: Does M-Pesa use these credentials?
  - **Action**: Test `POST /api/sales/:id/pay/mpesa` with different businesses
  
- [ ] **CRITICAL**: Implement missing endpoints
  - [ ] `GET /api/auth/me` - Auth status check
  - [ ] `GET /api/businesses/:businessId/summary` - Dashboard stats
  - [ ] Add pagination to list endpoints (optional for MVP)
  - [ ] `GET /api/stock/business/:businessId/analytics` - Stock summary

- [ ] **Verify** error response consistency across all endpoints

- [ ] **Test** end-to-end flow:
  1. Signup → Create business
  2. Setup payment method
  3. Add product
  4. Create sale
  5. Pay with cash
  6. Pay with M-Pesa (mock callback)

---

## 🎯 Phase 1: Foundation (Week 1)

### **Goals**: Setup project structure, auth, persistence

**Tasks**:
1. **Project Setup** (2-3 hours)
   - Create Flutter project: `flutter create payme_business`
   - Add dependencies to `pubspec.yaml`
   - Setup folder structure per FLUTTER_ARCHITECTURE.md
   - Configure app theme & constants

2. **Models Layer** (3-4 hours)
   - Create data model classes for: User, Business, Product, Sale, Wallet
   - Implement JSON serialization (fromJson, toJson)
   - Add equatable for equality comparison
   - Create response wrapper models

3. **API Client** (3-4 hours)
   - Setup Dio HTTP client with base URL configuration
   - Add request/response interceptors
   - Implement JWT token injection (from local storage)
   - Add error handling & exception mapping
   - Create ApiClient base class

4. **Local Storage** (2-3 hours)
   - Implement FlutterSecureStorage for JWT token
   - Save/retrieve/clear token methods
   - Add hive/shared_preferences for user prefs

5. **Auth Service** (3-4 hours)
   - Implement login API call
   - Implement signup API call
   - Implement logout
   - Implement token storage/retrieval
   - Add password validation utils

6. **Auth Screens** (5-6 hours)
   - Login screen: email, password, login button
   - Signup screen: name, phone, email, password, confirm, signup button
   - Input validation UI
   - Error message display
   - Loading states

7. **Splash Screen** (2-3 hours)
   - Check stored token on app start
   - Route to login (if no token) or dashboard (if valid)
   - Show loading indicator while checking

**Deliverable**: User can signup/login/logout, token persisted securely

**Testing**:
- [ ] Signup with valid data → Token saved
- [ ] Login with valid creds → Redirected to dashboard
- [ ] Logout → Token cleared, redirected to login
- [ ] Kill & restart app → Restored to previous state (if token valid)
- [ ] Invalid credentials → Error shown

---

## 🎯 Phase 2: Business Management (Week 1-2)

### **Goals**: Multi-business support, business settings

**Tasks**:
1. **Business Models** (1-2 hours)
   - Business model with payment config
   - Payment config model
   - Business response wrapper

2. **Business API Service** (2-3 hours)
   - GET /businesses (list)
   - POST /businesses (create)
   - GET /businesses/:id (get)
   - PUT /businesses/:id (update)
   - GET /payment-config/:businessId
   - POST /payment-config/setup

3. **State Management** (2-3 hours)
   - businessListProvider - FutureProvider for list
   - selectedBusinessProvider - StateProvider for current
   - businessSummaryProvider - FutureProvider for dashboard
   - Set up auto-refetch on business change

4. **Dashboard Screen** (4-5 hours)
   - Display selected business name at top
   - Show quick stats:
     - Today's sales count & revenue
     - Wallet balance
     - Low stock count
   - Action buttons: New sale, Add stock, Manage credit
   - Floating button to switch business
   - Pull-to-refresh to reload data

5. **Business List Screen** (3-4 hours)
   - List all user's businesses
   - Tap to select
   - Create new business button
   - Show payment status for each

6. **Create Business Screen** (4-5 hours)
   - Form fields: name, location, description
   - Payment method selector (till, paybill, wallet)
   - Payment identifier input
   - Form validation
   - Save button
   - Error handling

7. **Payment Setup Screen** (3-4 hours)
   - Explains payment method options
   - Form to configure paybill/till
   - Passkey input (masked)
   - Account reference field
   - Test button (optional)
   - Save configuration

8. **Business Settings Screen** (3-4 hours)
   - Edit business name, location, description
   - Change payment method
   - View current payment config
   - Update form with validation

**Deliverable**: Multi-business support, payment method configuration

**Testing**:
- [ ] Create business → Appears in list
- [ ] Select business → Dashboard reflects selection
- [ ] Create second business → Can switch between
- [ ] Update business → Changes reflected
- [ ] Setup payment → Config saved and retrieved

---

## 🎯 Phase 3: Inventory Management (Week 2-3)

### **Goals**: Product & stock management with FIFO tracking

**Tasks**:
1. **Inventory Models** (2-3 hours)
   - Product model
   - Stock batch model
   - Inventory summary
   - Stock movement (audit log)

2. **Inventory API Service** (3-4 hours)
   - POST /stock/products (create)
   - GET /stock/products/business/:id (list)
   - PUT /stock/products/:id (update)
   - POST /stock/add (add batch)
   - GET /stock/inventory/business/:id (summary)
   - GET /stock/inventory/product/:id (product stock detail)

3. **State Management** (2-3 hours)
   - productListProvider - FutureProvider
   - inventorySummaryProvider - FutureProvider
   - Auto-refetch when business selected

4. **Inventory Tab/Screen** (3-4 hours)
   - List all products for selected business
   - Show current stock for each
   - Color indicator: green (good), yellow (low), red (very low)
   - Tap to view details
   - Pull-to-refresh

5. **Product Details Screen** (4-5 hours)
   - Display product info (name, price, cost)
   - Show current stock
   - Show stock history (batches with costs)
   - "Add Stock" button
   - "Record Spoilage" button
   - Edit product button

6. **Add Product Screen** (3-4 hours)
   - Form: name, base price, cost, low stock threshold
   - Form validation
   - Save button
   - Success notification

7. **Add Stock Screen** (4-5 hours)
   - Product selector (dropdown or search)
   - Quantity input
   - Unit cost per item
   - Supplier field (optional)
   - Notes field
   - Validation (positive numbers)
   - Save → Stock batch created with FIFO tracking
   - Show confirmation with new total stock

8. **Spoilage Recording Screen** (3-4 hours)
   - Product selector
   - Quantity to mark as spoiled
   - Reason selector (damaged, expired, theft, etc.)
   - Notes
   - Record button
   - Show updated stock

9. **Inventory Analytics Screen** (4-5 hours)
   - Total products count
   - Total stock value
   - Products by stock level (low/medium/high)
   - Top 5 products by stock value
   - Spoilage summary
   - Charts/graphs (optional)

**Deliverable**: Full inventory management with FIFO stock tracking

**Testing**:
- [ ] Add product → Appears in list
- [ ] Add stock to product → Total increases
- [ ] Add multiple batches → FIFO order tracked
- [ ] Record spoilage → Stock decreases
- [ ] View product details → Shows all batches with costs
- [ ] Inventory summary → Correct total value calculated

---

## 🎯 Phase 4: Sales & Payments (Week 3-4)

### **Goals**: Core sales flow - cash and M-Pesa payments

**Tasks**:
1. **Sales Models** (2-3 hours)
   - Sale model (with items)
   - SaleItem model
   - Payment response
   - Payment status enum

2. **Sales API Service** (4-5 hours)
   - POST /sales (create sale)
   - GET /sales/business/:id (list)
   - GET /sales/:id (get detail)
   - POST /sales/:id/pay/cash (pay with cash)
   - POST /sales/:id/pay/mpesa (initiate STK)
   - POST /sales/:id/cancel
   - M-Pesa callback handler (setup)

3. **State Management** (2-3 hours)
   - saleItemsProvider - StateProvider (cart items)
   - currentSaleProvider - StateProvider (in progress)
   - salesListProvider - FutureProvider
   - Token balance from wallet

4. **Sales Tab/Screen** (3-4 hours)
   - List recent sales (last 50)
   - Show date, customer, total, status
   - Tap to view details
   - Filter by status (pending, completed, cancelled)
   - Pull-to-refresh

5. **Sales Detail Screen** (3-4 hours)
   - Show sale items with quantities, prices
   - Show totals (amount, profit)
   - Show payment status
   - Show payment method used
   - Show timestamps
   - Cancel button (if pending)

6. **Create Sale Screen** (5-6 hours)
   - Customer name input
   - Customer type selector (retail, wholesale, credit)
   - Cart interface:
     - Add product button
     - Show selected items
     - Quantity input with +/- buttons
     - Remove item button
   - Preview total price & profit
   - Notes field
   - "Proceed to Payment" button

7. **Add Items to Sale Screen** (4-5 hours)
   - Product picker (search/scroll)
   - Show product price & stock
   - Quantity input
   - "Add to Cart" button
   - Show available stock warning if needed

8. **Payment Method Selector** (2-3 hours)
   - Radio: Cash or M-Pesa
   - Show wallet balance (if enough tokens)
   - Warning if insufficient tokens
   - Proceed button

9. **Cash Payment Screen** (3-4 hours)
   - Display total amount due
   - Amount paid input
   - Calculate change
   - Confirm payment button
   - Show success screen
   - Return to sales list

10. **M-Pesa Payment Screen** (5-6 hours)
    - Display total amount
    - Customer phone number input (with validation)
    - "Request M-Pesa" button
    - Shows "Waiting for payment..." with retry
    - Polls for payment status (or handles callback)
    - Shows success/failure
    - Handle timeout

11. **M-Pesa Integration** (3-4 hours)
    - Setup callback receiver (if needed)
    - Handle STK push status updates
    - Show real-time payment status
    - Update sale status on completion

**Deliverable**: Complete sales flow with cash & M-Pesa payments

**Testing**:
- [ ] Create sale with 1 item → Total calculated correctly
- [ ] Create sale with multiple items → Totals match
- [ ] Pay with cash → Stock deducted, sale marked complete
- [ ] Pay with M-Pesa → STK push triggered, awaiting callback
- [ ] Insufficient stock → Cannot create sale
- [ ] Insufficient tokens → Cannot create sale
- [ ] Cancel pending sale → Tokens refunded, sale cancelled

---

## 🎯 Phase 5: Wallet & Financial (Week 4)

### **Goals**: Wallet management, credit, hire purchase, expenses

**Tasks**:
1. **Wallet Models** (1-2 hours)
   - Wallet model
   - TokenPackage model
   - Transaction model

2. **Wallet API Service** (2-3 hours)
   - GET /wallet/business/:id
   - GET /wallet/packages
   - POST /wallet/purchase
   - GET /wallet/business/:id/transactions

3. **State Management** (1-2 hours)
   - walletProvider - FutureProvider
   - tokenPackagesProvider - FutureProvider

4. **Wallet Screen (in Settings)** (4-5 hours)
   - Display balance: tokens & KES equivalent
   - Token packages display (with discounts highlighted)
   - Purchase button for each package
   - Transaction history list (last 20)
   - Pull-to-refresh

5. **Buy Tokens Screen** (4-5 hours)
   - Package selector
   - Show price, tokens, discount
   - Phone number input
   - "Request Payment" button
   - Shows "Waiting..." state
   - Success with balance update

6. **Credit Management** (6-8 hours)
   - Credit API service (list, create, update, payment)
   - List credit accounts
   - Create new credit account
   - View account details & payment history
   - Record payment
   - State management providers

7. **Hire Purchase Management** (6-8 hours)
   - HP API service (create, list, detail, payment)
   - List HP agreements
   - Create new agreement with payment schedule
   - View agreement details
   - Record payment
   - Show payment progress
   - State management

8. **Expense Tracking** (4-5 hours)
   - Expense API service (record, list, summary)
   - Record expense screen (category, amount, date, notes)
   - Expense list with filters
   - Summary by category
   - State management

**Deliverable**: Complete wallet, credit, HP, and expense features

**Testing**:
- [ ] View wallet balance → Correct tokens/KES
- [ ] Buy tokens → STK push initiated, balance updates
- [ ] Create credit account → Appears in list
- [ ] Record credit payment → Balance decreases
- [ ] Create HP agreement → Shows in list with progress
- [ ] Record expense → Appears in list & summary

---

## 🎯 Phase 6: Polish & Settings (Week 4-5)

### **Goals**: User experience, settings, edge cases

**Tasks**:
1. **Settings Tab/Screen** (4-5 hours)
   - Menu:
     - User Profile
     - Business Settings
     - Wallet (integrated)
     - Security & Login
     - About & Help
     - Logout

2. **User Profile Screen** (3-4 hours)
   - Display user info (name, phone, email)
   - Edit profile form
   - Update validation
   - Save changes

3. **Security Screen** (3-4 hours)
   - Change password form
   - Current password verification
   - New password with confirmation
   - Biometric login setup

4. **Biometric Setup & Login** (5-6 hours)
   - Setup screen: Enable fingerprint/face
   - Modified login flow: Biometric first, fallback to password
   - Require biometric for sensitive operations (optional)
   - Biometric service integration

5. **Error & Loading States** (3-4 hours)
   - Global error dialog for API errors
   - Loading indicators for all async operations
   - Retry mechanisms
   - Network error handling

6. **Offline Support (Optional)** (4-6 hours)
   - Local caching of read operations
   - Queue write operations (create/update/delete)
   - Sync when online
   - Offline indicator

7. **Notifications** (2-3 hours)
   - Local push notifications for important events
   - Order notifications (on-screen snackbars)
   - Payment confirmations

8. **Input Validation & Formatting** (2-3 hours)
   - Phone number formatting (0712345678 → +254712345678)
   - Currency formatting (100.00 → "KSH 100")
   - Date formatting
   - Form validation messages

9. **App Theming** (2-3 hours)
   - Light & dark mode (optional)
   - Brand colors
   - Typography
   - Consistent spacing

10. **Accessibility** (2-3 hours)
    - Semantic labels for widgets
    - Text contrast ratios
    - Touch target sizes
    - Screen reader support (basic)

**Deliverable**: Complete, polished user experience

**Testing**:
- [ ] All screens load correctly
- [ ] Biometric login works
- [ ] Error messages display properly
- [ ] Loading states show
- [ ] Network errors handled
- [ ] All forms validate
- [ ] Numbers formatted correctly
- [ ] Responsive on different screen sizes

---

## 🎯 Phase 7: Testing & Deployment (Week 5)

### **Goals**: Quality assurance, bug fixes, production ready

**Tasks**:
1. **Unit Tests** (4-6 hours)
   - Test models (serialization, equality)
   - Test validators (phone, email, amounts)
   - Test formatters (date, currency)
   - Test local storage (save/retrieve/clear)

2. **Integration Tests** (4-6 hours)
   - Test API client (error handling)
   - Test authentication flow
   - Test business selection flow
   - Test sales creation & payment

3. **Widget Tests** (3-4 hours)
   - Test form validation feedback
   - Test button states
   - Test navigation
   - Test error display

4. **Manual Testing Checklist** (6-8 hours)
   - [ ] Complete user journey: signup → create business → add stock → create sale → pay
   - [ ] Test all edge cases from BACKEND_ANALYSIS_ISSUES.md
   - [ ] Test all error scenarios
   - [ ] Test on multiple devices/screen sizes
   - [ ] Test biometric login
   - [ ] Test offline behavior (if implemented)
   - [ ] Performance: large product lists, many transactions
   - [ ] M-Pesa payment flow (sandbox)

5. **Bug Fixes** (4-6 hours)
   - Fix issues found in testing
   - Optimize performance
   - Fix UI/UX issues

6. **Production Preparation** (2-3 hours)
   - Update API URL to production
   - Configure app signing
   - Set log levels appropriately
   - Add crash reporting (Sentry/Firebase)
   - Update app version

7. **APK/AAB Build** (1-2 hours)
   - Build release APK
   - Build App Bundle (for Play Store)
   - Test on device

8. **Deployment** (1-2 hours)
   - Upload to Play Store (or internal testing)
   - Create store listing
   - Release notes
   - Monitor initial deployment

**Deliverable**: Production-ready Android app

---

## 📊 Timeline Summary

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| 1 | Foundation + Businesses | Auth, login, business CRUD |
| 1-2 | Inventory | Product management, FIFO stock |
| 3-4 | Sales & Payments | Create sale, cash/M-Pesa payment |
| 4 | Wallet & Financial | Wallet, credit, HP, expenses |
| 4-5 | Polish & Settings | Settings, biometric, UX polish |
| 5 | Testing & Deployment | QA, bug fixes, release |

---

## 🔧 Development Tools & Environment

### **Required Setup**
```bash
# Flutter SDK (latest stable)
flutter --version

# VS Code or Android Studio
# Install Flutter & Dart extensions

# Create emulator
flutter emulators create --name payme_device

# Run during dev
flutter run -d emulator-5554

# Build release APK
flutter build apk --release
```

### **Dependencies** (See pubspec.yaml)
```yaml
riverpod, flutter_riverpod          # State management
dio, pretty_dio_logger              # HTTP client
flutter_secure_storage              # Token storage
hive, hive_flutter                  # Local DB
local_auth                          # Biometric
intl, uuid, equatable               # Utilities
logger                              # Logging
```

---

## 📝 Key Considerations

1. **M-Pesa Sandbox**: All tests use Safaricom sandbox credentials
2. **Kenyan Phone Format**: Validation required (0712345678 or +254712345678)
3. **Token Economics**: 1 token = KES 2, used for sale transactions
4. **Business Scoping**: All operations scoped to selected business
5. **FIFO Stock**: Oldest batches deducted first for accurate profit
6. **Payment Config**: Required per business for M-Pesa to work
7. **Offline Sync**: Complex; MVP doesn't include offline support
8. **Biometric**: Optional enhancement, not MVP critical

---

## ⚠️ Backend Dependencies

**Must be completed before Flutter dev begins**:
- [x] Auth endpoints (login, signup, logout)
- [ ] `/api/auth/me` endpoint ← **ACTION NEEDED**
- [x] Business CRUD
- [ ] Payment config endpoints ← **VERIFY WORKING**
- [x] Inventory endpoints
- [x] Sales endpoints
- [ ] Dashboard summary endpoint ← **ACTION NEEDED**
- [x] Wallet endpoints
- [x] Credit endpoints
- [x] HP endpoints
- [x] Expense endpoints

---

## 📞 Communication

**Daily Standup**: Brief daily sync (15 min)
- Blockers?
- What did you ship?
- What's next?

**Code Review**: Before merging
- PR review by team member
- Test on device
- Update documentation

**Backend Support**: As needed
- Test new endpoints
- Report bugs
- Request enhancements

---

## Success Criteria

- ✅ All core features implemented
- ✅ 80%+ code coverage (unit tests)
- ✅ All edge cases handled
- ✅ < 2 second app startup
- ✅ Smooth 60 FPS animations
- ✅ < 100MB app size
- ✅ < 5 second network requests
- ✅ All error messages user-friendly
- ✅ Biometric login working
- ✅ M-Pesa integration verified

---

**Next Steps**:
1. Backend team: Fix critical issues (2-3 hours)
2. Flutter team: Setup project & environments (2-3 hours)
3. Begin Phase 1: Foundation

**Estimated Team Size**: 1-2 Flutter developers  
**Estimated Total Time**: 4-5 weeks (full-time)  
**Go-Live Target**: 5-6 weeks from start

