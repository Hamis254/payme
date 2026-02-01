# Revenue Guard - At A Glance

## What Changed

Revenue Guard middleware is now **protecting all billable operations**. Every create operation charges 1 token.

## Billable Operations

| What | Route | Cost |
|------|-------|------|
| Create Sale | `POST /api/sales` | 1 token |
| Create Record | `POST /api/records/{id}/create` | 1 token |
| Create Credit Account | `POST /api/credit/accounts` | 1 token |
| Create Credit Sale | `POST /api/credit/sales` | 1 token |

## HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| **201** | ✅ Created successfully, token deducted | Sale saved, 1 token spent |
| **401** | ❌ Authentication required | Invalid JWT |
| **402** | ❌ Insufficient tokens | Balance < 1 token |
| **403** | ❌ Fraud detected or access denied | Risk score ≥ 75 |
| **429** | ❌ Rate limited | 61+ requests/minute |
| **500** | ❌ Server error | Database error |

## Response Format

```json
{
  "message": "Operation successful",
  "data": { ... },
  "tokens_remaining": 24,
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Every response includes `request_id` for audit trail.

## Error Format

```json
{
  "error": "Error type",
  "message": "Human-readable message",
  "code": "ERROR_CODE",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Security Checks (Per Request)

1. ✅ JWT authentication
2. ✅ Rate limiting (60/min, 1000/hr)
3. ✅ Fraud detection (5 factors)
4. ✅ Token balance check
5. ✅ Audit logging

## Fraud Detection Factors

| Factor | Threshold | Risk |
|--------|-----------|------|
| Velocity | >10 ops/60s | +25 |
| Time | 00:00-05:59, 22:00-23:59 | +10 |
| Amount | >5x historical avg | +20 |
| Volume | >3x weekly avg | +15 |
| Pattern | Suspicious combo | +5-35 |
| **Critical** | **Risk ≥ 75** | **BLOCKED** |

## Key req Properties

After `revenueGuard` middleware:

```javascript
req.revenueGuard = {
  wallet_id: 42,
  balance_before: 25,
  tokens_to_deduct: 1,
  risk_score: 15,
  request_id: "uuid-v4"
}
```

## Testing

```bash
# Create sale (should work)
curl -X POST http://localhost:3000/api/sales \
  -H "Authorization: Bearer {jwt}" \
  -H "Content-Type: application/json" \
  -d '{"businessId":5,"items":[...]}'

# Response: 201 + tokens_remaining

# Create sale (no balance)
# Response: 402 Payment Required

# Create sale 61 times in 60 seconds
# Response 61: 429 Too Many Requests
```

## Monitoring

```sql
-- Last 10 transactions
SELECT user_id, operation, tokens_deducted, timestamp
FROM wallet_transactions
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC LIMIT 10;

-- Fraud attempts
SELECT user_id, COUNT(*) as attempts, MAX(risk_score) as max_risk
FROM audit_logs
WHERE type = 'fraud_detected'
AND created_at > NOW() - INTERVAL '7 days'
GROUP BY user_id;

-- Rate limit hits
SELECT user_id, COUNT(*) as count
FROM audit_logs
WHERE type = 'rate_limited'
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id;
```

## Integration Files

```
✅ src/middleware/revenueGuard.middleware.js (411 lines)
✅ src/routes/sales.routes.js (updated)
✅ src/routes/record.routes.js (updated)
✅ src/routes/credit.routes.js (updated)
✅ src/controllers/sales.controller.js (updated)
✅ src/controllers/record.controller.js (updated)
✅ src/controllers/credit.controller.js (updated)
```

## Documentation

- **REVENUE_GUARD_SECURITY.md** - Full technical spec
- **REVENUE_GUARD_QUICK_START.md** - Developer guide
- **INTEGRATION_COMPLETE.md** - Integration details
- **REVENUE_GUARD_INTEGRATION.md** - Implementation overview

## Error Handling Pattern

```javascript
try {
  // 1. Create operation
  const record = await createRecord(...);
  
  // 2. Deduct tokens (MUST be after creation succeeds)
  await deductTokens(
    req.revenueGuard.wallet_id,
    req.revenueGuard.tokens_to_deduct,
    { record_id: record.id, ... }
  );
  
  // 3. Return success
  res.status(201).json({
    message: 'Success',
    record,
    tokens_remaining: req.revenueGuard.balance_before - 1,
    request_id: req.revenueGuard.request_id
  });
} catch (error) {
  // 4. Refund if needed
  if (req.revenueGuard?.wallet_id) {
    await refundTokens(
      req.revenueGuard.wallet_id,
      req.revenueGuard.tokens_to_deduct,
      `Error: ${error.message}`
    );
  }
  next(error);
}
```

## Token Economics

| Scenario | Action | Cost |
|----------|--------|------|
| Create sale | 1 token deducted | 2 KES |
| Operation fails | Tokens refunded | 0 KES |
| Fraud detected | Blocked, no cost | 0 KES |
| Rate limited | Blocked, no cost | 0 KES |

## Key Points

1. **Order matters**: Create record → Deduct tokens → Return success
2. **Errors refund**: If deduction succeeds but something else fails, refund
3. **Audit trail**: Every transaction logged with request_id
4. **Security first**: Fraud detection blocks suspicious patterns
5. **User friendly**: Clear error messages and `request_id` for support

---

**Status**: ✅ Active and Tested  
**All billable operations are now monetized and secured.**
