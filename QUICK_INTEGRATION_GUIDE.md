# Quick Integration Guide

**Time to Implement**: ~30 minutes  
**Files to Modify**: 4  
**Lines of Code**: ~15 total  

---

## Step 1: Apply Rate Limiting to Login (5 min)

**File**: `src/routes/auth.routes.js`

**Add import**:
```javascript
import { loginLimiter } from '#middleware/rateLimiter.middleware.js';
```

**Modify route**:
```javascript
// BEFORE:
router.post('/sign-in', signIn);

// AFTER:
router.post('/sign-in', loginLimiter, signIn);
```

**Result**: 5 login attempts per 15 minutes per IP

---

## Step 2: Secure M-Pesa Webhook (5 min)

**File**: `src/routes/sales.routes.js`

**Add import**:
```javascript
import { validateMpesaWebhook } from '#middleware/webhookSecurity.middleware.js';
```

**Modify route**:
```javascript
// BEFORE:
router.post('/mpesa/callback', mpesaCallbackHandler);

// AFTER:
router.post('/mpesa/callback', validateMpesaWebhook(), mpesaCallbackHandler);
```

**Result**: All webhooks validated (IP, timestamp, signature)

---

## Step 3: Add Idempotency to Sales (5 min)

**File**: `src/routes/sales.routes.js`

**Add import**:
```javascript
import { idempotencyMiddleware } from '#middleware/idempotency.middleware.js';
```

**Modify route**:
```javascript
// BEFORE:
router.post('/', revenueGuard, createSaleHandler);

// AFTER:
router.post('/', idempotencyMiddleware(), revenueGuard, createSaleHandler);
```

**Result**: Duplicate sales prevented (UUID-based caching)

**Client must include header**:
```javascript
// In frontend/mobile app
const idempotencyKey = crypto.randomUUID();
fetch('/api/sales', {
  method: 'POST',
  headers: {
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(saleData),
});
```

---

## Step 4: Sanitize PDF Generation (10 min)

**File**: Wherever PDF is generated (likely `src/services/statement.service.js`)

**Add import**:
```javascript
import { sanitizeBusinessName, sanitizeInput, createPdfSafeHtml } from '#utils/sanitization.js';
```

**Apply before PDF rendering**:
```javascript
// Sanitize business name
const safeName = sanitizeBusinessName(business.name);

// Sanitize HTML content
const safeHtml = createPdfSafeHtml(htmlContent);

// Or sanitize individual fields
const safeBusiness = sanitizeObject(business, ['name', 'address']);

// Then generate PDF with safe data
const pdf = await generatePdfWithSafeContent(safeHtml);
```

**Result**: XSS attacks prevented in PDFs

---

## Step 5: Enable Encryption (Optional - Advanced)

**File**: `src/models/user.model.js` or user creation service

**Add import**:
```javascript
import { encryptFields, decryptFields } from '#utils/encryption.js';
```

**When saving user**:
```javascript
const encryptedUser = encryptFields(
  userData,
  ['phone_number', 'id_number'],
  `user_${userId}`
);
```

**When retrieving user**:
```javascript
const decryptedUser = decryptFields(
  userData,
  ['phone_number', 'id_number'],
  `user_${userId}`
);
```

**Prerequisites**:
1. Set `ENCRYPTION_KEY` in `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # Copy output to ENCRYPTION_KEY=...
   ```

2. Create database migration to add encrypted columns:
   ```sql
   ALTER TABLE users ADD COLUMN phone_number_encrypted VARCHAR(255);
   ALTER TABLE users ADD COLUMN id_number_encrypted VARCHAR(255);
   ```

**Result**: Sensitive data encrypted at rest (AES-256-GCM)

---

## Step 6: Database Cleanup (Optional but Recommended)

**Idempotency Key Cleanup** (run daily at 2 AM):

```javascript
// In a cron job or scheduled task
import { cleanupExpiredIdempotencyKeys } from '#middleware/idempotency.middleware.js';

schedule.scheduleJob('0 2 * * *', async () => {
  const deleted = await cleanupExpiredIdempotencyKeys();
  logger.info(`Cleaned up ${deleted} expired idempotency keys`);
});
```

---

## Verification Checklist

After applying all changes, verify:

- [ ] ESLint passes: `npm run lint:fix`
- [ ] Server starts: `npm run dev`
- [ ] Rate limiting works: Try 6 logins in 15 min → HTTP 429
- [ ] Webhook validation works: Send invalid IP → Rejected
- [ ] Idempotency works: Send same request twice → Same response
- [ ] XSS prevention works: Business name with `<script>` → Escaped

---

## Testing Commands

```bash
# Lint check
npm run lint:fix

# Test rate limiting
curl -X POST http://localhost:3000/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}' \
  # Run 6 times → 6th request gets 429

# Test webhook validation
curl -X POST http://localhost:3000/api/sales/mpesa/callback \
  -H "Content-Type: application/json" \
  -d '{}' \
  # Should return 200 but reject processing (invalid IP)

# Test idempotency
curl -X POST http://localhost:3000/api/sales \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"...sale data..."}' \
  # Run twice → 2nd request returns cached response with Idempotency-Replay: true
```

---

## Environment Variables Required

Add to `.env`:

```bash
# Required for encryption
ENCRYPTION_KEY=<generated-64-hex-chars>

# Required for webhook signature verification
MPESA_CALLBACK_SECRET=<from-safaricom>

# Optional: rate limiting cleanup interval (default: 60000ms)
RATE_LIMIT_CLEANUP_INTERVAL=60000

# Optional: idempotency cache duration (default: 86400000ms = 24 hours)
IDEMPOTENCY_CACHE_DURATION=86400000

# Optional: M-Pesa environment (default: sandbox)
MPESA_ENV=sandbox  # or 'production'
```

---

## Common Issues & Solutions

### Issue: "ENCRYPTION_KEY not found"
**Solution**: Generate and add to `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Issue: Rate limiting not working
**Solution**: Verify middleware is applied BEFORE route handler:
```javascript
// ✅ CORRECT
router.post('/sign-in', loginLimiter, signIn);

// ❌ WRONG
router.post('/sign-in', signIn, loginLimiter);
```

### Issue: Idempotency key validation fails
**Solution**: Ensure client sends valid UUID v4 format:
```javascript
// ✅ CORRECT
const key = crypto.randomUUID(); // 550e8400-e29b-41d4-a716-446655440000

// ❌ WRONG
const key = 'my-custom-key'; // Not valid UUID format
```

### Issue: Webhook validation failing
**Solution**: Check environment:
1. Production: Must be from Safaricom IPs (196.201.214.200, 206, etc.)
2. Sandbox: May need to whitelist test IPs
3. Check `MPESA_ENV` is set correctly in `.env`

---

## Rollback Plan

If any security feature causes issues:

```bash
# Remove rate limiting
# In auth.routes.js: router.post('/sign-in', signIn);

# Remove webhook validation
# In sales.routes.js: router.post('/mpesa/callback', mpesaCallbackHandler);

# Remove idempotency
# In sales.routes.js: router.post('/', revenueGuard, createSaleHandler);

# Restart server
npm run dev
```

---

## Support & Documentation

- **Rate Limiting**: See `SECURITY_HARDENING.md` Section 2
- **Webhook Security**: See `SECURITY_HARDENING.md` Section 4
- **Idempotency**: See `SECURITY_HARDENING.md` Section 5
- **XSS Prevention**: See `SECURITY_HARDENING.md` Section 3
- **Encryption**: See `SECURITY_HARDENING.md` Section 1
- **DevOps**: See `DEVOPS_GUIDE.md`

---

**Total Implementation Time**: ~30 minutes  
**Testing Time**: ~1-2 hours  
**Ready for Production**: ✅ YES

Start with Step 1 and work through in order. Each step is independent and can be tested separately.
