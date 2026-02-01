# Credit System Implementation Guide

## Overview

The PayMe Credit System allows businesses to extend credit to customers, track credit sales, manage payments, and generate comprehensive reports. The system includes credit limits, balance tracking, and aging reports.

## Current Status

### ✅ COMPLETED

#### 1. Database Models (`src/models/credit.model.js`)

- **creditAccounts**: Customer credit accounts with limits and balances
- **creditSales**: Credit sales transactions linked to regular sales
- **creditPayments**: Payment records with status tracking
- **creditLedger**: Double-entry ledger for all credit transactions

#### 2. Service Layer (`src/services/credit.service.js`)

Complete business logic implementation:

- `getCreditAccountById` - Fetch account with ownership verification
- `getCreditAccountsForBusiness` - List accounts with filters (status, search, pagination)
- `updateCreditAccount` - Update credit limits and details
- `deactivateCreditAccount` - Safely deactivate accounts (requires zero balance)
- `getCreditSalesForAccount` - List credit sales with filters
- `getCreditSaleWithDetails` - Get credit sale with line items
- `getCreditPaymentsForAccount` - Get payment history
- `getCreditLedgerForAccount` - Get ledger entries with filters
- `getCreditSummaryForBusiness` - Business-wide analytics
- `getAgingReport` - Accounts receivable aging (current, 1-30, 31-60, 61-90, 90+ days)
- `getCustomerStatement` - Customer statement with date range

#### 3. Partial Controller (`src/controllers/credit.controller.js`)

Basic operations implemented:

- `createCreditAccount` - Create new credit account for customer
- `createCreditSale` - Record credit sale (integrates with sales system)
- `recordCreditPayment` - Record customer payment

#### 4. Validation Schemas (`src/validations/credit.validation.js`)

- Account creation and update validation
- Credit sale validation
- Payment recording validation
- Query parameter validation

#### 5. Routes (`src/routes/credit.routes.js`)

Basic routes registered:

- `POST /api/credit/accounts` - Create account
- `POST /api/credit/sales` - Create credit sale
- `POST /api/credit/payments` - Record payment

---

## 🚧 REMAINING WORK

### 1. Complete Credit Controller

Add remaining controller functions to `src/controllers/credit.controller.js`:

```javascript
// List all credit accounts for business
export const getCreditAccounts = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { status, search, page = 1, limit = 20 } = req.query;

  const accounts = await creditService.getCreditAccountsForBusiness(
    businessId,
    { status, search, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: accounts,
  });
});

// Get single credit account
export const getCreditAccount = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;

  const account = await creditService.getCreditAccountById(
    accountId,
    businessId
  );

  res.json({
    success: true,
    data: account,
  });
});

// Update credit account
export const updateCreditAccount = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const updates = req.body;

  const account = await creditService.updateCreditAccount(
    accountId,
    businessId,
    updates
  );

  res.json({
    success: true,
    message: 'Credit account updated successfully',
    data: account,
  });
});

// Deactivate credit account
export const deactivateCreditAccount = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;

  await creditService.deactivateCreditAccount(accountId, businessId);

  res.json({
    success: true,
    message: 'Credit account deactivated successfully',
  });
});

// Get credit sales for account
export const getCreditSales = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

  const sales = await creditService.getCreditSalesForAccount(
    accountId,
    businessId,
    { status, startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: sales,
  });
});

// Get single credit sale with details
export const getCreditSale = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { saleId } = req.params;

  const sale = await creditService.getCreditSaleWithDetails(saleId, businessId);

  res.json({
    success: true,
    data: sale,
  });
});

// Get payments for account
export const getCreditPayments = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 20 } = req.query;

  const payments = await creditService.getCreditPaymentsForAccount(
    accountId,
    businessId,
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: payments,
  });
});

// Get ledger entries
export const getCreditLedger = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 50 } = req.query;

  const ledger = await creditService.getCreditLedgerForAccount(
    accountId,
    businessId,
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: ledger,
  });
});

// Get credit summary for business
export const getCreditSummary = catchAsync(async (req, res) => {
  const { businessId } = req.user;

  const summary = await creditService.getCreditSummaryForBusiness(businessId);

  res.json({
    success: true,
    data: summary,
  });
});

// Get aging report
export const getAgingReport = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { asOfDate } = req.query;

  const report = await creditService.getAgingReport(businessId, asOfDate);

  res.json({
    success: true,
    data: report,
  });
});

// Get customer statement
export const getCustomerStatement = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate } = req.query;

  const statement = await creditService.getCustomerStatement(
    accountId,
    businessId,
    startDate,
    endDate
  );

  res.json({
    success: true,
    data: statement,
  });
});
```

**Don't forget to import catchAsync:**

```javascript
import { catchAsync } from '#utils/catchAsync.js';
```

### 2. Update Credit Routes

Replace entire `src/routes/credit.routes.js` with:

```javascript
import { Router } from 'express';
import { authenticate } from '#middleware/auth.middleware.js';
import { validateRequest } from '#middleware/validation.middleware.js';
import {
  createCreditAccount,
  getCreditAccounts,
  getCreditAccount,
  updateCreditAccount,
  deactivateCreditAccount,
  createCreditSale,
  getCreditSales,
  getCreditSale,
  recordCreditPayment,
  getCreditPayments,
  getCreditLedger,
  getCreditSummary,
  getAgingReport,
  getCustomerStatement,
} from '#controllers/credit.controller.js';
import {
  createCreditAccountSchema,
  updateCreditAccountSchema,
  createCreditSaleSchema,
  recordCreditPaymentSchema,
  creditQuerySchema,
} from '#validations/credit.validation.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Account management
router.post(
  '/accounts',
  validateRequest(createCreditAccountSchema),
  createCreditAccount
);
router.get('/accounts', validateRequest(creditQuerySchema), getCreditAccounts);
router.get('/accounts/:accountId', getCreditAccount);
router.patch(
  '/accounts/:accountId',
  validateRequest(updateCreditAccountSchema),
  updateCreditAccount
);
router.delete('/accounts/:accountId', deactivateCreditAccount);

// Sales
router.post(
  '/sales',
  validateRequest(createCreditSaleSchema),
  createCreditSale
);
router.get(
  '/accounts/:accountId/sales',
  validateRequest(creditQuerySchema),
  getCreditSales
);
router.get('/sales/:saleId', getCreditSale);

// Payments
router.post(
  '/payments',
  validateRequest(recordCreditPaymentSchema),
  recordCreditPayment
);
router.get(
  '/accounts/:accountId/payments',
  validateRequest(creditQuerySchema),
  getCreditPayments
);

// Ledger
router.get(
  '/accounts/:accountId/ledger',
  validateRequest(creditQuerySchema),
  getCreditLedger
);

// Reports & Analytics
router.get('/summary', getCreditSummary);
router.get('/reports/aging', getAgingReport);
router.get(
  '/accounts/:accountId/statement',
  validateRequest(creditQuerySchema),
  getCustomerStatement
);

export default router;
```

### 3. Add Missing Import

Create `src/utils/catchAsync.js` if it doesn't exist:

```javascript
/**
 * Wraps async route handlers to catch errors and pass to Express error handler
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
export const catchAsync = fn => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

### 4. Run Tests

```bash
# Run linter
npm run lint

# Format code
npm run format

# Test the endpoints with your API client
```

---

## API Reference

### Authentication

All endpoints require authentication via JWT token in cookies or Authorization header.

### Base URL

```
/api/credit
```

### Endpoints

#### 1. Create Credit Account

```http
POST /api/credit/accounts
Authorization: Bearer <token>

{
  "customerId": "uuid",
  "creditLimit": 50000,
  "paymentTermDays": 30,
  "notes": "Trusted customer, monthly payment"
}

Response:
{
  "success": true,
  "message": "Credit account created successfully",
  "data": {
    "id": "uuid",
    "customerId": "uuid",
    "creditLimit": 50000,
    "currentBalance": 0,
    "availableCredit": 50000,
    "status": "active",
    ...
  }
}
```

#### 2. List Credit Accounts

```http
GET /api/credit/accounts?status=active&search=John&page=1&limit=20
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "accounts": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

#### 3. Get Single Account

```http
GET /api/credit/accounts/:accountId
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "customerId": "uuid",
    "customerName": "John Doe",
    "creditLimit": 50000,
    "currentBalance": 15000,
    "availableCredit": 35000,
    "status": "active",
    ...
  }
}
```

#### 4. Update Credit Account

```http
PATCH /api/credit/accounts/:accountId
Authorization: Bearer <token>

{
  "creditLimit": 75000,
  "paymentTermDays": 45,
  "notes": "Increased limit due to good payment history"
}

Response:
{
  "success": true,
  "message": "Credit account updated successfully",
  "data": {...}
}
```

#### 5. Deactivate Account

```http
DELETE /api/credit/accounts/:accountId
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Credit account deactivated successfully"
}
```

#### 6. Create Credit Sale

```http
POST /api/credit/sales
Authorization: Bearer <token>

{
  "creditAccountId": "uuid",
  "saleId": "uuid",
  "amount": 5000,
  "dueDate": "2025-02-25"
}

Response:
{
  "success": true,
  "message": "Credit sale recorded successfully",
  "data": {...}
}
```

#### 7. List Credit Sales for Account

```http
GET /api/credit/accounts/:accountId/sales?status=outstanding&page=1
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "sales": [...],
    "pagination": {...}
  }
}
```

#### 8. Get Credit Sale Details

```http
GET /api/credit/sales/:saleId
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "amount": 5000,
    "amountPaid": 2000,
    "balance": 3000,
    "status": "partial",
    "items": [...]
  }
}
```

#### 9. Record Payment

```http
POST /api/credit/payments
Authorization: Bearer <token>

{
  "creditAccountId": "uuid",
  "amount": 5000,
  "paymentMethod": "cash",
  "referenceNumber": "PAY-001",
  "notes": "Payment for January invoices"
}

Response:
{
  "success": true,
  "message": "Payment recorded successfully",
  "data": {...}
}
```

#### 10. Get Payments for Account

```http
GET /api/credit/accounts/:accountId/payments?startDate=2025-01-01
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "payments": [...],
    "pagination": {...}
  }
}
```

#### 11. Get Account Ledger

```http
GET /api/credit/accounts/:accountId/ledger?startDate=2025-01-01
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "uuid",
        "date": "2025-01-15",
        "type": "sale",
        "debit": 5000,
        "credit": 0,
        "balance": 5000,
        "description": "Credit sale #123",
        ...
      },
      ...
    ],
    "pagination": {...}
  }
}
```

#### 12. Get Credit Summary

```http
GET /api/credit/summary
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "totalAccounts": 45,
    "activeAccounts": 40,
    "suspendedAccounts": 3,
    "totalCreditLimit": 2250000,
    "totalOutstanding": 458000,
    "totalOverdue": 125000,
    "overdueAccounts": 8,
    "creditUtilization": 20.36
  }
}
```

#### 13. Get Aging Report

```http
GET /api/credit/reports/aging?asOfDate=2025-01-25
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "asOfDate": "2025-01-25",
    "summary": {
      "current": 150000,
      "days1to30": 80000,
      "days31to60": 45000,
      "days61to90": 28000,
      "days90plus": 35000,
      "total": 338000
    },
    "accounts": [
      {
        "accountId": "uuid",
        "customerName": "John Doe",
        "current": 15000,
        "days1to30": 8000,
        "days31to60": 0,
        "days61to90": 0,
        "days90plus": 0,
        "total": 23000
      },
      ...
    ]
  }
}
```

#### 14. Get Customer Statement

```http
GET /api/credit/accounts/:accountId/statement?startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "account": {...},
    "period": {
      "startDate": "2025-01-01",
      "endDate": "2025-01-31"
    },
    "openingBalance": 0,
    "transactions": [
      {
        "date": "2025-01-15",
        "type": "sale",
        "description": "Credit sale #123",
        "debit": 5000,
        "credit": 0,
        "balance": 5000
      },
      ...
    ],
    "closingBalance": 15000,
    "totalSales": 20000,
    "totalPayments": 5000
  }
}
```

---

## Business Logic

### Credit Account Lifecycle

1. **Active**: Normal operations, can make sales
2. **Suspended**: Credit limit reached or manually suspended
3. **Inactive**: Account closed (requires zero balance)

### Credit Limits

- `creditLimit`: Maximum amount customer can owe
- `currentBalance`: Current outstanding amount
- `availableCredit = creditLimit - currentBalance`

### Credit Sales

- Must be linked to a regular sale record
- Automatically updates account balance
- Creates ledger entries
- Cannot exceed available credit

### Payments

- Applied to oldest outstanding sales first (FIFO)
- Updates credit sale balances
- Creates ledger entries
- Frees up credit limit

### Ledger System

Double-entry bookkeeping:

- **Debit**: Increases balance (sales)
- **Credit**: Decreases balance (payments)
- Running balance calculation

---

## Testing Checklist

### Account Management

- [ ] Create credit account
- [ ] List accounts with filters
- [ ] Get single account details
- [ ] Update credit limit
- [ ] Deactivate account (with balance - should fail)
- [ ] Deactivate account (zero balance - should succeed)

### Sales

- [ ] Create credit sale (within limit)
- [ ] Create credit sale (exceeding limit - should fail)
- [ ] List credit sales with filters
- [ ] Get credit sale with line items

### Payments

- [ ] Record payment (full)
- [ ] Record payment (partial)
- [ ] Record payment (overpayment - should fail)
- [ ] List payments for account

### Reports

- [ ] Get business credit summary
- [ ] Get aging report
- [ ] Get customer statement
- [ ] View ledger entries

### Edge Cases

- [ ] Suspended account cannot make new sales
- [ ] Payment updates oldest sales first
- [ ] Account balance matches ledger balance
- [ ] Credit utilization calculates correctly

---

## Environment Variables

No additional environment variables needed. Uses existing database configuration.

---

## Next Steps for Production

1. **Automated Reminders**
   - Email/SMS notifications for overdue payments
   - Payment due date reminders

2. **Interest Calculation**
   - Late payment penalties
   - Interest on overdue balances

3. **Credit Approval Workflow**
   - Multi-level approval for high credit limits
   - Credit score integration

4. **Advanced Reports**
   - Payment trends
   - Customer credit analysis
   - Cash flow forecasting

5. **Bulk Operations**
   - Bulk payment import
   - Mass credit limit adjustments
   - Batch statement generation

---

## Notes

- All monetary values in KES (Kenyan Shillings)
- All dates in ISO 8601 format
- Pagination defaults: page=1, limit=20
- All operations logged in ledger for audit trail
- Business isolation enforced at service layer

---

**Last Updated**: January 25, 2025
**Status**: Service layer complete, controller and routes need completion
