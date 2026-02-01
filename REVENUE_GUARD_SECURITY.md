# Revenue Guard - Security Enhancement Documentation

**Version**: 2.0.0 (2026 Edition - Security Enhanced)  
**Date**: January 28, 2026  
**Purpose**: Complete financial transaction security and fraud prevention for PayMe platform

---

## 📋 Overview

The **Revenue Guard** middleware is a production-grade financial security layer that:

1. **Enforces token-based payment** before executing billable operations
2. **Detects and blocks fraud** through multi-factor risk scoring
3. **Prevents race conditions** with atomic database transactions
4. **Maintains audit trails** for regulatory compliance
5. **Rate limits users** to prevent abuse and DoS attacks
6. **Provides real-time warnings** for low balance scenarios

---

## 🔒 Security Features

### 1. **Authentication & Authorization**
- Validates JWT authentication before any token check
- Verifies business ownership (user must own the business)
- Prevents cross-tenant unauthorized access
- Returns 401/403 with clear error codes for failed auth

### 2. **Rate Limiting**
```javascript
- Per-minute limit: 60 requests/minute
- Per-hour limit: 1,000 requests/hour
- Returns 429 (Too Many Requests) when exceeded
- Prevents brute force and DoS attacks
```

### 3. **Fraud Detection (Multi-Factor Risk Scoring)**

#### Factor 1: Velocity Check
- Detects suspicious patterns when >10 operations occur within 60 seconds
- Risk score: +25 points
- Logs warning to audit trail

#### Factor 2: Time-of-Day Anomaly
- Flags operations during unusual hours (00:00-05:59, 22:00-23:59)
- Risk score: +10 points
- Helps identify compromised accounts

#### Factor 3: Amount Anomaly
- Compares transaction amount against 7-day average
- Flags if amount > 5x average historical transaction
- Risk score: +20 points
- Prevents unusual spending patterns

#### Factor 4: Daily Volume Check
- Compares daily operations against 30-day average
- Flags if daily volume > 3x weekly average
- Risk score: +15 points
- Identifies unexpected usage spikes

#### Factor 5: Risk Thresholds
```javascript
Risk Score 0-25:   LOW     - Allow transaction
Risk Score 26-50:  MEDIUM  - Log and monitor
Risk Score 51-75:  HIGH    - Additional logging
Risk Score 75-100: CRITICAL - BLOCK TRANSACTION (403 Forbidden)
```

### 4. **Token Balance Verification**
- Atomic read of wallet balance
- Checks against required tokens (1 token per operation)
- Prevents overdraft transactions
- Returns 402 (Payment Required) if insufficient

### 5. **Atomic Transactions**
```javascript
// All-or-nothing deduction
await db.transaction(async (tx) => {
  // 1. Lock wallet record
  // 2. Verify balance
  // 3. Deduct tokens
  // 4. Log transaction
  // 5. Commit or rollback
});
```
- Prevents "race condition" attacks where multiple clicks = multiple unpaid operations
- ACID compliance ensures data consistency
- Automatic rollback on any error

### 6. **Audit Logging (Kenya Data Protection Compliance)**
Every transaction is logged with:
- Timestamp (UTC)
- User ID & Business ID
- Event type (revenue_check, deduction, refund, fraud_detected)
- Token amount & balance before/after
- HTTP status & reason
- IP address & User-Agent
- Risk score
- Unique request ID (UUID v4)

**Purpose**: 
- Financial regulatory compliance (CBK, Treasury)
- Dispute resolution (customer claims)
- Fraud investigation trails
- Forensic analysis

### 7. **Balance Warning Headers**
```
Critical (<10 tokens):
  X-Token-Critical-Warning: "Only X tokens remaining"
  X-Token-Warning-Level: "critical"

Low (10-30 tokens):
  X-Token-Low-Warning: "Only X tokens remaining"
  X-Token-Warning-Level: "low"
```
- Clients can display UI warnings
- Prompts user to purchase tokens before balance depletes

---

## 🔄 Transaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. REQUEST ARRIVES                                               │
│    (Create Sale/Record/Credit transaction)                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. REVENUE GUARD MIDDLEWARE                                      │
│    ✓ Validate authentication (JWT)                              │
│    ✓ Verify business ownership                                  │
│    ✓ Check rate limits                                          │
│    ✓ Calculate risk score (5-factor analysis)                   │
│    ✓ Block if critical risk (≥75)                               │
│    ✓ Verify token balance (≥1 token)                            │
│    ✓ Attach revenue data to request                             │
│    ✓ Log audit event                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                      (Authorized)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. CONTROLLER LOGIC                                              │
│    ✓ Create record/sale/transaction                             │
│    ✓ Calculate profit/amounts                                   │
│    ✓ Return record ID in response                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. ATOMIC TOKEN DEDUCTION (deductTokens)                        │
│    ✓ Begin transaction                                          │
│    ✓ Lock wallet (SELECT FOR UPDATE)                            │
│    ✓ Verify balance again (defense against race conditions)     │
│    ✓ Deduct 1 token                                             │
│    ✓ Update balance                                             │
│    ✓ Log wallet_transaction                                     │
│    ✓ Commit (or rollback on error)                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                     (Deduction Success)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. RESPONSE TO CLIENT                                            │
│    ✓ Include request ID                                         │
│    ✓ Include balance remaining                                  │
│    ✓ Include warning headers if balance critical                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💾 Database Schema

### wallet_transactions (Audit Log)
```sql
CREATE TABLE wallet_transactions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'deduction' | 'refund'
  amount_tokens NUMERIC(12,2),
  balance_before NUMERIC(12,2),
  balance_after NUMERIC(12,2),
  status VARCHAR(50) NOT NULL, -- 'completed' | 'failed'
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### wallets (Current Balances)
```sql
CREATE TABLE wallets (
  id SERIAL PRIMARY KEY,
  business_id INTEGER UNIQUE NOT NULL,
  balance_tokens NUMERIC(12,2) DEFAULT 0,
  total_tokens_purchased NUMERIC(12,2) DEFAULT 0,
  total_tokens_spent NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🛡️ Error Handling

### HTTP Status Codes

| Status | Code | Scenario | Action |
|--------|------|----------|--------|
| 401 | AUTH_REQUIRED | No JWT token | Redirect to login |
| 400 | BUSINESS_ID_MISSING | Missing business_id parameter | Include business_id in request |
| 403 | UNAUTHORIZED | User doesn't own business | Verify business ownership |
| 403 | FRAUD_DETECTED | Risk score ≥75 | Contact support (account frozen temporarily) |
| 429 | RATE_LIMITED | Too many requests | Wait 60 seconds, retry |
| 402 | PAYMENT_REQUIRED | Insufficient balance | Purchase tokens |
| 500 | REVENUE_CHECK_ERROR | Unexpected error | Retry (log to support) |

---

## 🔧 Integration Guide

### Step 1: Add Middleware to Route
```javascript
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';

router.post(
  '/sales/create',
  authenticateToken,
  revenueGuard,           // <-- Add here
  createSaleHandler
);
```

### Step 2: Deduct Tokens After Success
```javascript
export const createSaleHandler = async (req, res, next) => {
  try {
    const sale = await createSale(...);
    
    // AFTER successful sale creation:
    await deductTokens(
      req.revenueGuard.wallet_id,
      req.revenueGuard.tokens_to_deduct,
      {
        sale_id: sale.id,
        amount_kes: sale.total_amount,
        items_count: sale.items.length,
      }
    );
    
    res.status(201).json({
      message: 'Sale created',
      sale,
      request_id: req.revenueGuard.request_id,
    });
  } catch (error) {
    next(error);
  }
};
```

### Step 3: Refund Tokens on Failure
```javascript
catch (error) {
  // If deduction already happened but something failed later:
  if (req.revenueGuard?.wallet_id) {
    await refundTokens(
      req.revenueGuard.wallet_id,
      req.revenueGuard.tokens_to_deduct,
      `Sale creation failed: ${error.message}`
    );
  }
  next(error);
}
```

---

## 📊 Monitoring & Alerts

### Critical Events to Monitor
1. **Fraud Detected** - Risk score ≥75 (potential account compromise)
2. **Rate Limit Exceeded** - Possible DoS attack or automation bot
3. **Multiple Refunds** - Indicates system errors or user fraud
4. **Velocity Spike** - More than 10 ops in 60 seconds

### Query Examples

**Check fraud attempts:**
```sql
SELECT user_id, COUNT(*) as attempts, MAX(risk_score)
FROM audit_logs
WHERE type = 'fraud_detected'
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id;
```

**Monitor token usage:**
```sql
SELECT 
  b.business_name,
  w.balance_tokens,
  COUNT(wt.id) as transactions_today,
  SUM(CAST(wt.amount_tokens AS DECIMAL)) as tokens_spent_today
FROM wallets w
JOIN businesses b ON w.business_id = b.id
LEFT JOIN wallet_transactions wt 
  ON w.id = wt.wallet_id 
  AND wt.created_at > NOW() - INTERVAL '1 day'
GROUP BY b.id, w.id;
```

---

## 🚀 Performance Considerations

### Optimization Strategies
1. **Database Indexes** - Index on (user_id, created_at) for rate limiting queries
2. **Caching** - Cache wallet balance for 5-10 seconds (acceptable for pre-flight check)
3. **Async Logging** - Audit logs written asynchronously (non-blocking)
4. **Connection Pooling** - Neon serverless handles this automatically

### Expected Latency
- Pre-flight check: ~20-50ms (includes DB queries + risk scoring)
- Token deduction: ~100-200ms (includes atomic transaction)
- Total per request: ~150-300ms

---

## 📋 Compliance

### Kenya-Specific Regulations
- **Kenya Data Protection Act, 2019** - Full audit trail for disputes
- **Central Bank of Kenya (CBK)** - Transaction traceability
- **National Treasury** - Financial reporting capability
- **FATF AML/CFT Standards** - Transaction monitoring

### Security Standards
- **PCI DSS 3.2.1** - Payment card industry standards (if applicable)
- **ISO 27001** - Information security management
- **OWASP Top 10** - Web application security

---

## 🔐 Best Practices

### For Development Team
1. ✅ Always include `req.revenueGuard.request_id` in responses
2. ✅ Always call `deductTokens()` after successful record creation
3. ✅ Always call `refundTokens()` if operation fails mid-way
4. ✅ Log all revenue-related errors to separate audit table
5. ✅ Never trust client-side token balance - always verify server-side

### For Operations Team
1. ✅ Monitor fraud alerts daily (risk_score ≥50)
2. ✅ Set up alerts for unexpected rate limit spikes
3. ✅ Weekly review of refund patterns
4. ✅ Monthly reconciliation of token balances

### For Security Team
1. ✅ Quarterly review of audit logs for patterns
2. ✅ Penetration testing of rate limiting & fraud detection
3. ✅ Regular review of access logs
4. ✅ Implement DDoS protection at CDN level

---

## 🆘 Troubleshooting

### Issue: Users blocked with "Fraud Detected"
**Solution**: Check if they're using VPN or unusual access patterns
- Review `audit_logs` for risk_score breakdown
- Contact user to verify identity
- Manually reset fraud flag if legitimate

### Issue: Tokens deducted but sale didn't create
**Solution**: Rollback with refundTokens() 
- Check transaction logs for completion status
- Verify no race conditions occurred
- Alert user about automatic refund

### Issue: Slow response times (>500ms)
**Solution**: Optimize database queries
- Check if rate limit queries are slow (add indexes)
- Verify risk scoring logic isn't N+1
- Consider caching wallet balance

---

## 📝 Changelog

### v2.0.0 (Jan 28, 2026) - Security Enhanced
- ✅ Added 5-factor fraud detection (velocity, time, amount, volume, pattern)
- ✅ Implemented atomic transactions for race condition prevention
- ✅ Added comprehensive audit logging
- ✅ Implemented rate limiting (per-minute + per-hour)
- ✅ Added risk score calculation (0-100)
- ✅ Added balance warning headers
- ✅ Added refund handler for failed operations
- ✅ Added request ID tracking for support

### v1.1.0 (Original)
- Basic token balance check
- Simple 402 response

---

## 📞 Support

For security concerns, contact: **security@payme.dev**

---

**Last Updated**: January 28, 2026
