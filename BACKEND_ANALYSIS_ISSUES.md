# Backend Analysis & Issues Report - PayMe API

**Status**: Backend 70% Complete - Critical features present, some gaps identified  
**Last Updated**: Current session  
**Priority**: Address these before/during Flutter app development

---

## Executive Summary

The backend is **functionally complete** for core business operations but has some **gaps in data consistency, edge case handling, and frontend integration points**. The M-Pesa restructuring (wallet vs business payments) is well-architected but needs to be completed. Below are identified issues and recommendations.

---

## ✅ What's Working Well

1. **Authentication & Authorization** - JWT-based, role-based access control ✅
2. **Business Management** - Multi-business support per user ✅
3. **Inventory Management** - Product CRUD, stock batches, FIFO deduction ✅
4. **Sales Creation** - Sale creation with items, stock deduction ✅
5. **Payment Processing** - Cash & M-Pesa payment flows ✅
6. **Wallet System** - Token-based wallet, balance tracking ✅
7. **Credit Management** - Customer credit accounts ✅
8. **Hire Purchase** - Full agreement lifecycle ✅
9. **Expense Tracking** - Complete CRUD ✅
10. **Spoilage Tracking** - Record & analyze spoiled stock ✅
11. **Database Layer** - Drizzle ORM, migrations, proper schema ✅

---

## 🔴 Critical Issues

### **1. Payment Configuration Incomplete**
**Issue**: New `paymentConfigs` model created, but not fully integrated  
**Status**: Partially implemented  
**Impact**: Business payment setup flow may not be complete  
**Fix Needed**:
- [ ] Verify `paymentConfig.routes.js` endpoints are registered in `app.js`
- [ ] Check `paymentConfig.controller.js` handles all CRUD operations
- [ ] Ensure M-Pesa integration uses payment config for business payments
- [ ] Test end-to-end: Create business → Setup payment → Initiate STK push

**Files to Review**:
- `/src/routes/paymentConfig.routes.js`
- `/src/controllers/paymentConfig.controller.js`
- `/src/services/paymentConfig.service.js`

---

### **2. M-Pesa Business Payment Integration Incomplete**
**Issue**: New `initiateBusinessStkPush()` function created but may not be wired in controller  
**Status**: Code written, not verified integrated  
**Impact**: Business M-Pesa payments may still use old hardcoded credentials  
**Fix Needed**:
- [ ] Verify `payMpesaHandler` in `sales.controller.js` calls `initiateBusinessStkPush()`
- [ ] Ensure it fetches payment config per business, not env variables
- [ ] Test actual M-Pesa flow with per-business credentials

**Files to Check**:
- `/src/utils/mpesa.js` - Contains `initiateBusinessStkPush()` function
- `/src/controllers/sales.controller.js` - `payMpesaHandler` function (line 300+)

---

### **3. Missing Dashboard/Summary Endpoint**
**Issue**: Flutter app needs dashboard stats (revenue today, pending payments, low stock, etc.)  
**Status**: Not implemented  
**Impact**: Dashboard screen in Flutter can't load data  
**Fix Needed**:
- [ ] Create `GET /api/businesses/:businessId/summary` endpoint
- [ ] Return: total sales today, revenue today, pending payments, token balance, low stock count
- [ ] Optimize query (may need view or aggregation)

**Proposed Endpoint**:
```javascript
// GET /api/businesses/:businessId/summary
{
  "business_id": 1,
  "today": {
    "sales_count": 5,
    "total_revenue": 2500.00,
    "cash_sales": 1500,
    "mpesa_sales": 1000
  },
  "pending": {
    "unpaid_sales": 2,
    "total_pending": 800
  },
  "inventory": {
    "low_stock_products": 3,
    "total_products": 25
  },
  "wallet": {
    "token_balance": 150,
    "balance_kes": 300
  }
}
```

---

### **4. Missing User Refresh Token / Token Verification Endpoint**
**Issue**: Frontend may need to verify token validity without full login  
**Status**: Not implemented  
**Impact**: Flutter app can't check auth status without making risky API calls  
**Fix Needed**:
- [ ] Create `GET /api/auth/me` endpoint - returns current user if token valid
- [ ] Returns 401 if token invalid/expired
- [ ] Used by Flutter splash screen to determine next route

**Proposed Endpoint**:
```javascript
// GET /api/auth/me
// Returns current user, no request body
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "phone_number": "254712345678",
  "role": "user",
  "created_at": "2026-01-20T10:00:00Z"
}
```

---

### **5. Missing Get User Profile Endpoint**
**Issue**: User needs own profile in settings, but no dedicated endpoint  
**Status**: Partially implemented (auth returns user, but not full details)  
**Impact**: Settings screen can't fetch/update user info  
**Fix Needed**:
- [ ] Verify `GET /api/users/:id` works for own user
- [ ] Ensure can be called by authenticated user
- [ ] Already implemented in `users.routes.js` ✅ (just verify working)

---

### **6. Missing Pagination for List Endpoints**
**Issue**: All list endpoints return all records (no pagination)  
**Status**: Not implemented  
**Impact**: Large data sets will be slow, memory-intensive  
**Fix Needed**:
- [ ] Add `page` and `limit` query parameters to all list endpoints
- [ ] Return `{ data: [...], total, page, pageSize, totalPages }`
- [ ] Endpoints to update:
  - GET `/api/businesses` ✅ (small number, likely OK)
  - GET `/api/stock/products/business/:businessId`
  - GET `/api/sales/business/:businessId`
  - GET `/api/wallet/business/:businessId/transactions`
  - GET `/api/credit/accounts`
  - All other list endpoints

**Example Implementation**:
```javascript
export const listSales = async (req, res, next) => {
  const page = parseInt(req.query.page || '1');
  const limit = parseInt(req.query.limit || '20');
  const offset = (page - 1) * limit;

  const total = await db
    .select({ count: count() })
    .from(sales)
    .where(eq(sales.business_id, businessId));

  const records = await db
    .select()
    .from(sales)
    .where(eq(sales.business_id, businessId))
    .limit(limit)
    .offset(offset);

  res.json({
    data: records,
    pagination: {
      total: total[0].count,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total[0].count / limit),
    },
  });
};
```

---

### **7. Missing Inventory Analytics Endpoint**
**Issue**: Flutter inventory screen needs summary stats  
**Status**: Not implemented  
**Impact**: Stock analytics screen empty  
**Fix Needed**:
- [ ] Create `GET /api/stock/business/:businessId/summary`
- [ ] Return: total products, total units in stock, stock value, turnover rate
- [ ] Create `GET /api/stock/business/:businessId/low-stock` - products below threshold

---

### **8. Missing Sales Analytics Endpoint**
**Issue**: Flutter sales screen needs trends/summary  
**Status**: Not fully implemented  
**Impact**: Sales analytics screen can't show data  
**Fix Needed**:
- [ ] Create `GET /api/sales/business/:businessId/analytics?period=daily|weekly|monthly`
- [ ] Return: sales count, revenue, profit, trends
- [ ] Create `GET /api/sales/business/:businessId/top-products` - best sellers

---

### **9. Wallet Balance Not Auto-Updated After Payment**
**Issue**: Wallet deduction happens on payment, but what if payment callback delayed?  
**Status**: Partially handled (transaction marked as pending, completed on callback)  
**Impact**: User sees incorrect balance briefly  
**Fix Needed**:
- [ ] Ensure `GET /api/wallet/business/:businessId` always shows accurate balance
- [ ] Mark pending transactions as "pending"
- [ ] Only count "completed" for balance
- [ ] Test scenario: Create sale → Check wallet → Complete payment → Check wallet

---

### **10. Missing Statement Verification Audit Endpoint Implementation**
**Issue**: TODOs in `/src/controllers/statementVerification.controller.js` (lines 110, 145)  
**Status**: Stubbed out, not implemented  
**Impact**: Statement verification audit feature incomplete  
**Fix Needed**:
- [ ] Implement audit log fetching in `getStatementAuditHandler`
- [ ] Query suspicious statements in database
- [ ] These are low-priority (advanced feature) but should be completed

---

### **11. No Input Sanitization/XSS Protection**
**Issue**: User inputs (business name, notes) not sanitized before DB insert  
**Status**: Helmet + CORS enabled, but no field-level sanitization  
**Impact**: Potential stored XSS if data displayed in web UI (mobile app safer)  
**Fix Needed**:
- [ ] Add input sanitization library (e.g., `xss` package) for user inputs
- [ ] Trim/escape text fields in validations or service layer
- [ ] This is lower priority for mobile-only app, but good practice

---

### **12. No Rate Limiting at Endpoint Level**
**Issue**: Arcjet configured globally, but no specific endpoint rate limits  
**Status**: Global rate limiting in place, endpoint-level not set  
**Impact**: Brute force on specific endpoints possible (e.g., password login)  
**Fix Needed**:
- [ ] Consider adding stricter limits on `/api/auth/sign-in` (e.g., 5 attempts/min)
- [ ] Consider limits on sensitive operations (payment config setup, token purchase)
- [ ] Current global limits adequate for MVP, can enhance later

---

### **13. Missing Error Response Standardization**
**Issue**: Error response formats vary across endpoints  
**Status**: Mostly consistent, but some inconsistencies  
**Impact**: Flutter error handling needs to handle multiple formats  
**Fix Needed**:
- [ ] Standardize all error responses to:
  ```json
  {
    "error": "Error type/code",
    "message": "User-friendly message",
    "details": "Additional context (optional)",
    "statusCode": 400
  }
  ```
- [ ] Review all controllers for consistency
- [ ] Create error response helper function if not exists

---

## 🟡 Medium Priority Issues

### **14. No Soft Delete for Businesses/Accounts**
**Issue**: Deleting business deletes all related data (cascading)  
**Status**: Cascading deletes configured in schema  
**Impact**: User accidentally deletes business → loses all sales history  
**Fix Needed**:
- [ ] Add `deleted_at` soft delete instead of hard delete
- [ ] Filter out deleted records in list queries
- [ ] Allow restoration within 30 days
- [ ] This is nice-to-have, not critical

---

### **15. Missing Field Encryption**
**Issue**: Sensitive data (M-Pesa passkeys, auth tokens) stored in plain text  
**Status**: Token stored in cookies (secure), but passkeys in DB unencrypted  
**Impact**: Database breach exposes M-Pesa credentials  
**Fix Needed**:
- [ ] Implement field-level encryption for:
  - `paymentConfigs.passkey`
  - `businesses.google_sheets_auth_token`
- [ ] Use library like `crypto.js` or `tweetnacl`
- [ ] Add encryption key to env variables
- [ ] This is important for production, can be added before deployment

---

### **16. Missing Transaction Logging for Audit Trail**
**Issue**: No audit log for all payment transactions  
**Status**: Partially logged via `walletTransactions`, but not comprehensive
**Impact**: Disputes, fraud tracking, regulatory compliance difficult  
**Fix Needed**:
- [ ] Ensure all financial transactions logged with:
  - User ID
  - Business ID
  - Amount
  - Type (sale, payment, token charge, refund)
  - Timestamp
  - IP address
- [ ] Already partially done, just needs verification

---

### **17. Missing Concurrent Request Handling for Payments**
**Issue**: What if M-Pesa callback arrives while user retrying payment?  
**Status**: Not explicitly handled  
**Impact**: Duplicate charges possible  
**Fix Needed**:
- [ ] Ensure payment status check before processing each transaction
- [ ] Use database locks or transactions to prevent race conditions
- [ ] This is lower priority for MVP, but test edge case

---

## 🟢 Minor Issues / Nice-to-Have

### **18. Missing Search Functionality**
**Issue**: No search for products, customers, sales, etc.  
**Status**: Not implemented  
**Impact**: Users with 100+ products can't find items easily  
**Fix Needed**:
- [ ] Add search parameter to list endpoints (e.g., `?search=productName`)
- [ ] Implement LIKE queries in database layer
- [ ] Nice-to-have for v1.1

---

### **19. No Bulk Operations**
**Issue**: Can't batch-import products, bulk-adjust stock, etc.  
**Status**: Not implemented  
**Impact**: Users with large inventory waste time  
**Fix Needed**:
- [ ] CSV import for products/stock
- [ ] Nice-to-have for v1.1

---

### **20. Missing Email Notifications**
**Issue**: No email on payment completion, password reset, etc.  
**Status**: Not implemented  
**Impact**: Users don't get payment confirmations  
**Fix Needed**:
- [ ] Send email on major events (payment, registration)
- [ ] Can be added post-MVP

---

## Database Schema Review

### ✅ Current Tables
- `users` - User accounts
- `businesses` - Business profiles
- `products` - Product catalog
- `stock_batches` - FIFO tracking
- `stock_movements` - Audit log
- `sales` - Sales transactions
- `sale_items` - Line items
- `wallets` - Token balance per business
- `wallet_transactions` - Balance changes
- `token_purchases` - Token purchase records
- `payments` - Payment records
- `credit_accounts` - Customer credit
- `credit_transactions` - Credit payment log
- `hire_purchase_agreements` - HP contracts
- `hire_purchase_payments` - HP payment schedule
- `expenses` - Business expenses
- `spoiled_stock` - Spoilage records
- `payment_configs` - Per-business M-Pesa credentials ✅ NEW
- `statement_audit_log` - Bank statement verification

### 🔍 Schema Gaps
- No `customers` table (using names in sales, consider separate table)
- No `api_keys` table (no API authentication beyond JWT)
- No `audit_log` table (comprehensive activity log)
- No `notifications` table (notification history)

---

## Endpoints Summary (16 Route Files)

| Route | Status | Issues |
|-------|--------|--------|
| `/api/auth` | ✅ Complete | Missing `/me` endpoint |
| `/api/businesses` | ✅ Complete | -  |
| `/api/users` | ✅ Complete | Accessible by own user only |
| `/api/stock` | ⚠️ Partial | Missing analytics, pagination |
| `/api/sales` | ⚠️ Partial | Missing analytics, pagination |
| `/api/wallet` | ⚠️ Partial | Needs balance verification |
| `/api/payment-config` | ⚠️ Partial | New, needs integration test |
| `/api/credit` | ✅ Complete | No pagination |
| `/api/higher-purchase` | ✅ Complete | No pagination |
| `/api/expense` | ✅ Complete | No pagination |
| `/api/spoiled-stock` | ✅ Complete | No pagination |
| `/api/records` | ⚠️ Partial | Unclear purpose |
| `/api/payme` | ⚠️ Partial | Duplicate with `/api/sales`? |
| `/api/myWallet` | ⚠️ Partial | Duplicate with `/api/wallet`? |
| `/api/walletPayment` | ⚠️ Unclear | Review routing |
| `/api/statementVerification` | ⚠️ Partial | TODOs not completed |

---

## Recommendations for Flutter Development

### **Phase 1: Fix Critical Issues (2-3 hours)**
1. **Verify payment config integration** - Ensure business payments use new system
2. **Add `/api/auth/me` endpoint** - For splash screen auth check
3. **Add dashboard summary endpoint** - `/api/businesses/:id/summary`
4. **Fix endpoint routing** - Clarify/consolidate duplicate routes

### **Phase 2: Enhance Endpoints (4-6 hours)**
5. Add pagination to all list endpoints
6. Add analytics endpoints for inventory & sales
7. Standardize error responses

### **Phase 3: Production Readiness (4-8 hours)**
8. Implement field encryption
9. Add rate limiting per endpoint
10. Complete statement verification TODOs

---

## Testing Checklist Before Flutter Release

- [ ] **Auth Flow**: Signup → Login → Get user → Logout
- [ ] **Business**: Create → List → Get → Update
- [ ] **Payment Config**: Setup → Get → Update → Verify in M-Pesa flow
- [ ] **Stock**: Add product → Add stock → Check FIFO deduction
- [ ] **Sales**: Create sale → Deduct tokens → Pay cash → Complete
- [ ] **M-Pesa**: Initiate STK push → Verify uses business config → Handle callback
- [ ] **Wallet**: Check balance → Buy tokens → Verify deduction
- [ ] **Credit**: Create account → Record payment → Check balance
- [ ] **Hire Purchase**: Create agreement → Record payment → Check progress
- [ ] **Concurrent Requests**: Rapid fire same request → Ensure no duplicates
- [ ] **Edge Cases**: 
  - Insufficient stock
  - Insufficient wallet balance
  - Invalid business access
  - Expired tokens

---

## Migration Steps (If Needed)

If you modified existing schema for payment config:
```bash
# Generate new migration
npm run db:generate

# Review migration in ./drizzle/
# Apply to database
npm run db:migrate

# Verify in Drizzle Studio
npm run db:studio
```

---

## Next Steps

1. **Run through this checklist** - Mark as you verify each issue
2. **Fix critical issues** - Payment config integration, missing endpoints
3. **Test end-to-end flows** - Use Postman or cURL before Flutter
4. **Share status with Flutter team** - Let them know what's ready vs in-progress

