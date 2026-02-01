# Expense Management - Quick Reference

## What's New

Complete system for tracking business expenses (rent, utilities, salaries, fuel, etc.) with flexible categorization. Essential for accurate profit calculations.

---

## Quick Facts

✅ **11 Expense Categories**: rent, utilities, salaries, supplies, transportation, marketing, maintenance, insurance, licenses, other, **n/a**  
✅ **N/A Support**: Businesses that don't have certain expenses use "n/a" (e.g., retail doesn't need fuel)  
✅ **4 Payment Methods**: cash, mpesa, bank_transfer, cheque  
✅ **5 Status Workflow**: recorded → verified → approved → paid (or cancelled)  
✅ **6 Analytics Types**: summary, by_category, by_payment_method, monthly_trend, top_expenses, category_breakdown  

---

## Key Files

```
✅ src/models/expense.model.js - Database schema
✅ src/services/expense.service.js - Business logic (14 functions)
✅ src/controllers/expense.controller.js - HTTP handlers (7 handlers)
✅ src/routes/expense.routes.js - REST API (7 endpoints)
✅ src/validations/expense.validation.js - Input validation (5 schemas)
```

All files: **LINT-CLEAN (0 errors)**

---

## API Endpoints

### Record Expense
```bash
POST /api/expenses/:businessId/record
{
  "category": "transportation",
  "description": "Fuel for delivery van",
  "amount": 2500,
  "paymentMethod": "mpesa",
  "expenseDate": "2026-01-28T10:30:00Z",
  "note": "Weekly fuel budget"
}
```

### List Expenses
```bash
GET /api/expenses/5?category=transportation&status=paid&limit=20
# Optional filters: category, paymentMethod, status, startDate, endDate, limit, offset
```

### View Summary
```bash
GET /api/expenses/5/summary
# Returns: total_count, total_amount, average_amount, max_amount, min_amount
```

### Get Analytics
```bash
GET /api/expenses/5/analytics?analysisType=by_category
# analysisType: summary | by_category | by_payment_method | monthly_trend | top_expenses | category_breakdown
```

### Update Expense
```bash
PATCH /api/expenses/5/1
{ "status": "paid", "note": "Updated note" }
```

### Delete Expense
```bash
DELETE /api/expenses/5/1
```

---

## Example: Record Fuel Expense (Matatu Business)

```json
POST /api/expenses/15/record
{
  "category": "transportation",
  "description": "Shell fuel station - regular fill",
  "amount": 5000,
  "paymentMethod": "cash",
  "expenseDate": "2026-01-28T14:00:00Z",
  "note": "Weekly fuel for main matatu"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Expense recorded successfully",
  "expense": {
    "id": 42,
    "category": "transportation",
    "description": "Shell fuel station - regular fill",
    "amount": 5000,
    "payment_method": "cash",
    "status": "recorded",
    "created_at": "2026-01-28T14:00:00Z"
  }
}
```

---

## Example: Retail Business NOT Using Fuel

```json
POST /api/expenses/20/record
{
  "category": "n/a",  // NOT applicable to retail
  "description": "Not used",
  "amount": 0,
  "paymentMethod": "cash",
  "expenseDate": "2026-01-28T10:00:00Z"
}
```

Instead, retail uses other categories:

```json
{
  "category": "supplies",
  "description": "Shopping bags and boxes",
  "amount": 1500,
  "paymentMethod": "mpesa",
  "expenseDate": "2026-01-28T10:00:00Z"
}
```

---

## Expense Categories by Business Type

### 🚐 Matatu/Transport Business
- transportation ✅ (fuel, maintenance)
- salaries ✅ (conductor, cleaner)
- insurance ✅ (vehicle, public liability)
- maintenance ✅ (repairs, spare parts)
- licenses ✅ (PSV license, road tax)
- supplies ✅ (cleaning materials)
- other ✅ (unexpected costs)
- rent, utilities, marketing: **n/a**

### 🏪 Retail Shop
- supplies ✅ (inventory, packaging)
- rent ✅ (shop space)
- utilities ✅ (electricity, water)
- salaries ✅ (shop assistant)
- marketing ✅ (posters, promotions)
- insurance ✅ (stock insurance)
- maintenance ✅ (shelving repairs)
- other ✅ (miscellaneous)
- transportation, licenses: **n/a** (or minimal)

### 🍽️ Restaurant
- rent ✅ (kitchen space)
- utilities ✅ (electricity, water, gas)
- salaries ✅ (chef, waiter, cleaner)
- supplies ✅ (napkins, containers)
- transportation ✅ (delivery bike/car)
- marketing ✅ (menu boards, ads)
- maintenance ✅ (equipment repair)
- licenses ✅ (health permit, business license)
- insurance ✅ (liability)
- other ✅

---

## Analytics Examples

### By Category
```bash
GET /api/expenses/5/analytics?analysisType=by_category
```

**Shows**: Which categories use most money

```json
{
  "by_category": [
    {
      "category": "salaries",
      "count": 12,
      "total_amount": 75000,
      "percentage": 60
    },
    {
      "category": "transportation",
      "count": 8,
      "total_amount": 35000,
      "percentage": 28
    },
    {
      "category": "supplies",
      "count": 15,
      "total_amount": 18000,
      "percentage": 12
    }
  ]
}
```

**Action**: If salaries are 60%, review if you're overstaffed.

---

### Monthly Trend
```bash
GET /api/expenses/5/analytics?analysisType=monthly_trend
```

**Shows**: Spending patterns over time

```json
{
  "monthly_trend": [
    {
      "month": "2026-01-01",
      "count": 42,
      "total_amount": 125000,
      "average_amount": 2976
    },
    {
      "month": "2025-12-01",
      "count": 38,
      "total_amount": 110000,
      "average_amount": 2895
    }
  ]
}
```

**Action**: If January is 13% higher, plan budget accordingly.

---

### Top Expenses
```bash
GET /api/expenses/5/analytics?analysisType=top_expenses&limit=5
```

**Shows**: Single biggest expense items

```json
{
  "top_expenses": [
    {
      "id": 100,
      "category": "salaries",
      "description": "Monthly staff payroll",
      "amount": 15000,
      "status": "paid",
      "expense_date": "2026-01-28"
    }
  ]
}
```

**Action**: Unexpected high expense? Review details and adjust.

---

## Profit Calculation Example

### Full Financial Statement (January 2026)

```
Sales Revenue                    KES 500,000
Less: Cost of Goods Sold         KES 250,000
─────────────────────────────────────────────
Gross Profit                     KES 250,000

Less: Operating Expenses
  Salaries                  KES 75,000
  Rent                      KES 30,000
  Utilities                 KES 8,000
  Transportation            KES 10,000
  Supplies                  KES 5,000
  Maintenance               KES 3,000
  Total Expenses            KES 131,000

Less: Spoilage Loss              KES 5,000
─────────────────────────────────────────────
NET PROFIT                       KES 114,000
─────────────────────────────────────────────

Profit Margin: 114,000 / 500,000 = 22.8%
```

**How to calculate in code**:
```javascript
const sales = 500000;
const cogs = 250000;
const expenses = getTotalExpenses(businessId, '2026-01-01', '2026-01-31');
const spoilage = getSpoilageLoss(businessId, '2026-01-01', '2026-01-31');

const grossProfit = sales - cogs;
const netProfit = grossProfit - expenses - spoilage;
const profitMargin = (netProfit / sales) * 100;
```

---

## Status Workflow

Use status to track expense through approval:

| Status | Meaning | Next Step |
|--------|---------|-----------|
| **recorded** | Just entered | Manager verifies |
| **verified** | Manager checked | Approval required |
| **approved** | Approved by owner | Payment made |
| **paid** | Actually paid | Included in profit |
| **cancelled** | Rejected/voided | Ignored in reports |

**Update status**:
```bash
PATCH /api/expenses/5/1
{ "status": "paid" }
```

---

## Payment Methods

- **cash** - Direct cash, keep receipt
- **mpesa** - M-Pesa, save transaction ID
- **bank_transfer** - Bank-to-bank, save reference
- **cheque** - Paper cheque, save number

**Example with M-Pesa**:
```json
{
  "category": "supplies",
  "description": "Office supplies from Stationery Ltd",
  "amount": 3000,
  "paymentMethod": "mpesa",
  "paymentReference": "RQT891234567",
  "paymentPhone": "+254712345678",
  "expenseDate": "2026-01-28T10:00:00Z"
}
```

---

## Integration Points

### 1. Profit Reports
```javascript
// In reportService.js
const expenses = await getTotalExpenses(businessId, startDate, endDate);
const netProfit = revenue - cogs - expenses;
```

### 2. Financial Dashboards
```javascript
// Show expense breakdown
const breakdown = await getExpenseByCategory(businessId);
// Show monthly trends
const trend = await getMonthlytExpenseTrend(businessId);
```

### 3. Budget Planning
```javascript
// Use historical trend to plan next month
const lastYear = await getMonthlytExpenseTrend(businessId);
// Compare this month vs same month last year
```

---

## Data Capture Best Practices

### ✅ DO:
- Use clear descriptions: "Monthly rent for shop" not "Rent"
- Keep receipts/photos for large expenses
- Record expense date accurately
- Use correct category (or "n/a" if not applicable)
- Update status as it moves through workflow

### ❌ DON'T:
- Mix categories: use "supplies" for office items, not "other"
- Forget to record - do it same day as expense
- Use wrong business ID
- Round amounts - be precise

---

## Error Messages

| Error | Fix |
|-------|-----|
| "Invalid category" | Use valid category from list (or "n/a") |
| "Invalid payment method" | Use: cash, mpesa, bank_transfer, cheque |
| "Amount must be greater than 0" | Amount must be positive number |
| "Expense not found" | Check expense ID and business ID |
| "Business not found" | User doesn't own this business |

---

## Status: READY TO DEPLOY ✅

- **Database**: Migration ready
- **Routes**: Ready to register in app.js
- **Tests**: Ready for integration testing
- **Documentation**: Complete with examples

---

## Files Summary

| File | Lines | Purpose |
|------|-------|---------|
| expense.model.js | 73 | Database schema |
| expense.validation.js | 156 | Input validation |
| expense.service.js | 465 | Business logic |
| expense.controller.js | 318 | HTTP handlers |
| expense.routes.js | 238 | REST API |
| **TOTAL** | **1,250** | Complete system |

All files lint-clean: ✅ 0 errors
