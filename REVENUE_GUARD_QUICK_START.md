# Revenue Guard - Developer Quick Reference

## 🚀 Quick Start

### Adding Revenue Guard to a Route

```javascript
import { revenueGuard, deductTokens, refundTokens } from '#middleware/revenueGuard.middleware.js';

router.post(
  '/sales/create',
  authenticateToken,
  revenueGuard,  // <-- Always add this
  createSaleHandler
);
```

---

## 📋 Complete Implementation Example

### Controller Handler
```javascript
export const createSaleHandler = async (req, res, next) => {
  const requestId = req.revenueGuard.request_id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Auth required' });
    }

    // 1. Validate input
    const validationResult = createSaleSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    // 2. Create sale (business logic)
    const sale = await createSale(
      req.user.id,
      validationResult.data
    );

    // 3. DEDUCT TOKENS (after successful creation)
    await deductTokens(
      req.revenueGuard.wallet_id,
      req.revenueGuard.tokens_to_deduct,
      {
        sale_id: sale.id,
        business_id: sale.business_id,
        amount_kes: sale.total_amount,
        items_count: sale.items.length,
      }
    );

    // 4. Return success response
    res.status(201).json({
      message: 'Sale created successfully',
      sale,
      tokens_remaining: req.revenueGuard.balance_before - 1,
      request_id: requestId,
    });

  } catch (error) {
    // If creation succeeded but deduction failed, refund
    if (req.revenueGuard?.wallet_id && error.message.includes('deduction')) {
      try {
        await refundTokens(
          req.revenueGuard.wallet_id,
          req.revenueGuard.tokens_to_deduct,
          `Sale creation error: ${error.message}`
        );
      } catch (refundError) {
        logger.error('Refund failed - manual intervention needed', refundError);
      }
    }

    logger.error('Error creating sale', error);
    next(error);
  }
};
```

---

## 🔍 Understanding req.revenueGuard Object

After middleware processes, `req.revenueGuard` contains:

```javascript
{
  wallet_id: 42,                    // Database wallet ID
  business_id: 5,                   // User's business
  balance_before: 25,               // Tokens before deduction
  tokens_to_deduct: 1,              // Always 1 token per operation
  risk_score: 15,                   // Fraud risk (0-100)
  request_id: "uuid-v4-string",     // Unique request ID
  timestamp: 2026-01-28T10:30:00Z   // When checked
}
```

---

## ✅ Error Responses

### 402 Payment Required
```json
{
  "error": "Insufficient token balance. Required: 1, Available: 0",
  "code": "PAYMENT_REQUIRED",
  "balance_tokens": 0,
  "required_tokens": 1,
  "request_id": "uuid-string"
}
```

### 403 Fraud Detected
```json
{
  "error": "Transaction blocked due to security concerns. Please contact support.",
  "code": "FRAUD_DETECTED",
  "request_id": "uuid-string"
}
```

### 429 Rate Limited
```json
{
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMITED",
  "retry_after": 60,
  "request_id": "uuid-string"
}
```

---

## 📊 Request Flow Diagram

```
POST /api/sales/create
{
  business_id: 5,
  items: [...]
}
         ↓
    [authenticateToken]
         ↓
    [revenueGuard]
    ├─ Check auth ✓
    ├─ Verify business ✓
    ├─ Check rate limit ✓
    ├─ Check risk score ✓
    ├─ Check balance (≥1) ✓
    └─ Attach req.revenueGuard ✓
         ↓
    [createSaleHandler]
    ├─ Create sale ✓
    ├─ Return sale ID
    └─ CONTINUE (don't wait)
         ↓
    [deductTokens]
    ├─ Lock wallet ✓
    ├─ Verify balance ✓
    ├─ Deduct 1 token ✓
    ├─ Log transaction ✓
    └─ Commit ✓
         ↓
    [Return 201 Success]
```

---

## ⚠️ Common Mistakes

### ❌ Don't do this:
```javascript
// WRONG: Deducting before record creation
await deductTokens(...);
const sale = await createSale(...); // What if this fails?
```

### ✅ Do this instead:
```javascript
// CORRECT: Create first, then deduct
const sale = await createSale(...);
await deductTokens(...);  // Safe to deduct now
```

---

### ❌ Don't do this:
```javascript
// WRONG: Ignoring deduction errors
try {
  const sale = await createSale(...);
} catch (e) {
  next(e);  // What about the tokens already deducted?
}
```

### ✅ Do this instead:
```javascript
// CORRECT: Handle deduction errors
try {
  const sale = await createSale(...);
} catch (e) {
  if (req.revenueGuard?.wallet_id) {
    await refundTokens(
      req.revenueGuard.wallet_id,
      1,
      `Error: ${e.message}`
    );
  }
  next(e);
}
```

---

## 🧪 Testing Scenarios

### Test 1: Sufficient Balance
```bash
curl -X POST http://localhost:3000/api/sales/create \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": 5,
    "items": [{"product_id": 1, "quantity": 5}]
  }'

# Expected: 201 Created
# Tokens: 25 → 24
```

### Test 2: Insufficient Balance
```bash
# For user with 0 tokens:

# Expected: 402 Payment Required
# {"error": "Insufficient token balance..."}
# Tokens: 0 → 0 (no change)
```

### Test 3: Rate Limit
```bash
# Make 61 requests within 60 seconds

# Request 61:
# Expected: 429 Too Many Requests
# {"error": "Too many requests..."}
```

### Test 4: Fraud Detection (Velocity)
```bash
# Make 10+ operations in 60 seconds

# Expected: 403 Fraud Detected
# {"error": "Transaction blocked due to security concerns..."}
# Risk score: 25+
```

---

## 📈 Monitoring

### Check Recent Audit Events
```sql
SELECT * FROM audit_logs
WHERE user_id = 123
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 100;
```

### Monitor Fraud Alerts
```sql
SELECT 
  user_id,
  COUNT(*) as fraud_attempts,
  MAX(risk_score) as max_risk,
  MAX(created_at) as last_attempt
FROM audit_logs
WHERE type = 'fraud_detected'
AND created_at > NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING COUNT(*) >= 3;
```

### Check Token Spending
```sql
SELECT 
  b.business_name,
  COUNT(wt.id) as deductions_today,
  SUM(CAST(wt.amount_tokens AS DECIMAL)) as tokens_spent,
  w.balance_tokens
FROM wallet_transactions wt
JOIN wallets w ON wt.wallet_id = w.id
JOIN businesses b ON w.business_id = b.id
WHERE wt.created_at > NOW() - INTERVAL '1 day'
GROUP BY b.id, w.id;
```

---

## 🔐 Security Checklist

Before deploying to production:

- [ ] All billable routes have `revenueGuard` middleware
- [ ] All handlers call `deductTokens()` after success
- [ ] All error handlers call `refundTokens()` if needed
- [ ] Request ID is included in all responses
- [ ] Audit logging is configured
- [ ] Rate limits are appropriate for your use case
- [ ] Risk scoring thresholds match your risk appetite
- [ ] Database indexes are created for audit queries
- [ ] Alert rules are set up for fraud detection
- [ ] Team is trained on the system

---

## 📞 Debugging

### User says "Blocked as fraud"
1. Get their request ID from error response
2. Query audit logs:
```sql
SELECT * FROM audit_logs WHERE request_id = '{request_id}';
```
3. Check risk_score breakdown in metadata
4. If legitimate, contact support team

### Tokens deducted but operation didn't happen
1. Check wallet_transactions table:
```sql
SELECT * FROM wallet_transactions 
WHERE wallet_id = {wallet_id}
ORDER BY created_at DESC;
```
2. Look for corresponding sale record
3. If sale exists but deduction happened, data is consistent
4. If sale missing, refund should have been triggered (check refund entries)

### Slow response times
1. Check middleware latency:
```javascript
const start = Date.now();
// ... middleware ...
console.log(`Revenue Guard took ${Date.now() - start}ms`);
```
2. Add database indexes if missing
3. Consider caching wallet balance for 5-10 seconds

---

## 📚 Related Files

- `src/middleware/revenueGuard.middleware.js` - Main middleware
- `src/models/myWallet.model.js` - Database schema
- `REVENUE_GUARD_SECURITY.md` - Full documentation
- `src/config/logger.js` - Logging configuration

---

**Last Updated**: January 28, 2026
