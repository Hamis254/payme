# M-Pesa Restructuring - Implementation Checklist

## Pre-Implementation Review

- [ ] **Understand the Separation**
  - [ ] Wallet payments = Fixed paybill 650880 (system-wide)
  - [ ] Business payments = Per-business paybill/till (database)
  - [ ] These are completely independent systems

- [ ] **Review Documentation**
  - [ ] Read `MPESA_RESTRUCTURING_SUMMARY.md` - Overview
  - [ ] Read `ENV_RESTRUCTURING.md` - Environment setup
  - [ ] Read `MPESA_INTEGRATION_GUIDE.md` - Integration steps
  - [ ] Read `MPESA_ARCHITECTURE_DIAGRAM.md` - Data flows

---

## Database Setup

### Migration Generation
- [ ] Run: `npm run db:generate`
  - Generates migration file for `payment_configs` table
  - Check: `drizzle/` folder for new migration file
  - Verify: Migration includes all fields (shortcode, passkey, account_reference, etc.)

### Migration Application
- [ ] Run: `npm run db:migrate`
  - [ ] Verify: Table `payment_configs` exists in database
  - [ ] Verify: All columns created correctly
  - [ ] Verify: Foreign key to `businesses` table
  - [ ] Check: Default values for `verified` and `is_active`

### Data Verification
- [ ] Query database: `SELECT * FROM payment_configs` (should be empty initially)
- [ ] Query database: `DESCRIBE payment_configs` (verify schema)

---

## File Structure Verification

### New Files Created
- [ ] `src/models/paymentConfig.model.js` - Database schema
- [ ] `src/services/paymentConfig.service.js` - Service layer (CRUD)
- [ ] `src/validations/paymentConfig.validation.js` - Zod schemas
- [ ] `src/controllers/paymentConfig.controller.js` - HTTP handlers
- [ ] `src/routes/paymentConfig.routes.js` - Express routes

### Files Modified
- [ ] `src/utils/mpesa.js` - Added `initiateBusinessStkPush()`
- [ ] `src/controllers/auth.controller.js` - Added signup response flag
- [ ] `src/app.js` - Added payment-config routes
- [ ] Review changes do not break existing functionality

### Documentation Created
- [ ] `ENV_RESTRUCTURING.md` - Environment variables guide
- [ ] `MPESA_INTEGRATION_GUIDE.md` - Integration walkthrough
- [ ] `MPESA_RESTRUCTURING_SUMMARY.md` - Complete summary
- [ ] `MPESA_ARCHITECTURE_DIAGRAM.md` - Visual diagrams

---

## Environment Variables Update

### Remove from `.env`
- [ ] Delete: `MPESA_SHORTCODE_PAYBILL`
- [ ] Delete: `MPESA_PASSKEY_PAYBILL`
- [ ] Delete: `MPESA_SHORTCODE_TILL`
- [ ] Delete: `MPESA_PASSKEY_TILL`

### Verify in `.env`
- [ ] Keep: `MPESA_CONSUMER_KEY` - Shared OAuth
- [ ] Keep: `MPESA_CONSUMER_SECRET` - Shared OAuth
- [ ] Keep: `MPESA_PASSKEY_WALLET` - Wallet paybill 650880
- [ ] Keep: `MPESA_CALLBACK_URL` - Webhook URL
- [ ] Verify: `MPESA_ENV=sandbox` (or production)

### Optional
- [ ] Add: `MPESA_B2C_SHORTCODE` (if B2C needed)
- [ ] Add: `MPESA_B2C_INITIATOR`
- [ ] Add: `MPESA_B2C_SECURITY_CREDENTIAL`

---

## Authentication & Signup Flow

### Auth Endpoint Response
- [ ] Test: `POST /api/auth/sign-up`
- [ ] Verify: Response includes `setupNeeded: true`
- [ ] Verify: Response includes `setupUrl: "/setup/payment-method"`
- [ ] Verify: User is created successfully
- [ ] Verify: JWT token is set in cookies

### Auth Endpoint - Sign In
- [ ] Test: `POST /api/auth/sign-in`
- [ ] Verify: User can still sign in normally
- [ ] Verify: Existing users not affected

---

## Payment Configuration Setup

### Create Payment Config Endpoint
- [ ] Test: `POST /api/payment-config/setup`
- [ ] With body:
  ```json
  {
    "businessId": 1,
    "payment_method": "paybill",
    "shortcode": "123456",
    "passkey": "YOUR_PASSKEY",
    "account_reference": "ACC001",
    "account_name": "My Business"
  }
  ```
- [ ] Verify: Returns 201 status
- [ ] Verify: Config is stored in database
- [ ] Verify: `verified: false` by default
- [ ] Verify: `is_active: true` by default
- [ ] Test with invalid data:
  - [ ] Missing shortcode → 400 error
  - [ ] Invalid payment_method → 400 error
  - [ ] Account reference > 12 chars → 400 error

### Get Payment Config Endpoint
- [ ] Test: `GET /api/payment-config/:businessId`
- [ ] Verify: Returns correct config
- [ ] Verify: Hides passkey (or encrypt it)
- [ ] Test with non-existent business → 404 error
- [ ] Test without authentication → 401 error

### Update Payment Config Endpoint
- [ ] Test: `PATCH /api/payment-config/:configId`
- [ ] Update passkey:
  - [ ] Send: `{ "passkey": "NEW_PASSKEY" }`
  - [ ] Verify: Updated in database
  - [ ] Verify: `updated_at` field changes
- [ ] Update account reference:
  - [ ] Send: `{ "account_reference": "NEW_REF" }`
  - [ ] Verify: Updated correctly
- [ ] Update is_active:
  - [ ] Send: `{ "is_active": false }`
  - [ ] Verify: Config deactivated (soft delete)

### Toggle Config Status Endpoint
- [ ] Test: `POST /api/payment-config/:configId/toggle`
- [ ] With body: `{ "is_active": false }`
- [ ] Verify: Config is deactivated
- [ ] Test toggle back: `{ "is_active": true }`
- [ ] Verify: Config is reactivated

---

## Wallet Token Purchase (Should be Unchanged)

### Test Wallet Token Purchase
- [ ] Test: `POST /api/wallet-payment/initiate`
- [ ] With body:
  ```json
  {
    "phone": "+254712345678",
    "amount": 100
  }
  ```
- [ ] Verify: Uses hardcoded paybill 650880
- [ ] Verify: Uses `MPESA_PASSKEY_WALLET` from .env
- [ ] Verify: M-Pesa STK push succeeds
- [ ] Verify: `CheckoutRequestID` returned

### Test Wallet Payment Callback
- [ ] Simulate M-Pesa callback to `/api/mpesa/callback`
- [ ] Verify: Wallet transaction created
- [ ] Verify: Token balance updated
- [ ] Verify: mpesa.controller.js handles it correctly

---

## Business Customer Payment (New Functionality)

### Test Business Customer Payment
- [ ] Assume payment config exists in database
- [ ] Create new endpoint (in sales or payment controller) that:
  - [ ] Calls: `getPaymentConfig(businessId)`
  - [ ] Calls: `initiateBusinessStkPush(paymentConfig, ...)`
- [ ] Verify: Uses business's shortcode from database
- [ ] Verify: Uses business's passkey from database
- [ ] Verify: M-Pesa STK push succeeds
- [ ] Verify: `CheckoutRequestID` returned

### Test Business Payment Callback
- [ ] Simulate M-Pesa callback to `/api/mpesa/callback`
- [ ] Verify: Sale transaction created
- [ ] Verify: Stock deducted
- [ ] Verify: Callback handler works for both wallet and business

---

## Error Handling & Edge Cases

### Payment Config Not Found
- [ ] Test business customer payment when config missing
- [ ] Verify: Returns clear error message
- [ ] Verify: Suggests setup URL

### Deactivated Config
- [ ] Deactivate payment config: `PATCH /api/payment-config/:id`
- [ ] Test: Attempt business customer payment
- [ ] Verify: Either rejects OR uses inactive config (decide logic)
- [ ] Document: Behavior when config inactive

### Multiple Configs per Business
- [ ] Attempt to create second config for same business
- [ ] Verify: Rejected OR updates existing (decide logic)
- [ ] Document: Can business have multiple payment methods?

### Invalid Credentials
- [ ] Test with incorrect passkey in database
- [ ] Verify: M-Pesa API returns error
- [ ] Verify: Error is logged
- [ ] Verify: User receives helpful message

---

## Security Validation

### Authentication
- [ ] All payment-config endpoints require JWT
- [ ] Test: Request without token → 401 error
- [ ] Test: Request with invalid token → 401 error
- [ ] Verify: Users can only access their own businesses

### Authorization
- [ ] Users can only setup config for their own businesses
- [ ] Test: User A tries to config User B's business → 403 error
- [ ] Verify: `req.user.id` checked against business owner

### Passkey Security
- [ ] Passkeys stored in database (encrypted recommended)
- [ ] Passkeys NOT logged or exposed in responses
- [ ] Passkeys NOT returned in GET endpoints
- [ ] Test: Check logs for sensitive data (should be none)

### Input Validation
- [ ] Shortcode validated (alphanumeric, length 5-20)
- [ ] Account reference validated (alphanumeric, max 12 chars)
- [ ] Payment method enum: 'till' or 'paybill' only
- [ ] All inputs sanitized before database insert

---

## Performance & Logging

### Database Queries
- [ ] `getPaymentConfig()` - Single query per call
- [ ] No N+1 queries when fetching multiple configs
- [ ] Indexes on business_id and is_active (optional)

### Logging
- [ ] Payment config setup logged
- [ ] Config updates logged
- [ ] Payment config fetches logged (debug level)
- [ ] All errors logged with context
- [ ] No sensitive data in logs (passkeys hidden)

### Performance Testing
- [ ] STK push response time acceptable (<5 seconds)
- [ ] Database query response time acceptable (<100ms)
- [ ] No timeout issues

---

## Integration with Existing Features

### Wallet System
- [ ] Token purchase still works
- [ ] Wallet balance updates correctly
- [ ] No conflicts with existing wallet logic

### Sales System
- [ ] Sales can retrieve payment config
- [ ] Sales uses correct paybill/till from config
- [ ] Sales callbacks still work

### Business Management
- [ ] Business creation flow unchanged
- [ ] Payment config created AFTER business setup
- [ ] Business list still works

### Stock System
- [ ] Stock deduction on sale completion unchanged
- [ ] Inventory tracking unaffected
- [ ] FIFO logic still works

---

## Frontend Integration (Not in Scope, but Note)

- [ ] Frontend detects `setupNeeded: true` after signup
- [ ] Frontend redirects to payment method setup page
- [ ] Payment setup form:
  - [ ] Radio buttons: Till or Paybill
  - [ ] Input: Shortcode
  - [ ] Input: Passkey
  - [ ] Input: Account Reference
  - [ ] Input (optional): Account Name
- [ ] Form submission to `POST /api/payment-config/setup`
- [ ] Success message: "Payment method configured"
- [ ] Error handling: Display validation errors

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass
- [ ] No console errors
- [ ] ESLint clean: `npm run lint`
- [ ] Code formatted: `npm run format:check`
- [ ] Database backup created
- [ ] .env updated correctly

### Deployment Steps
1. [ ] Pull changes
2. [ ] Install dependencies: `npm install`
3. [ ] Run migrations: `npm run db:migrate`
4. [ ] Restart server: `npm run dev`
5. [ ] Test health: `GET /health` → 200 OK
6. [ ] Test auth: `POST /api/auth/sign-up` → setupNeeded true
7. [ ] Test payment config: `POST /api/payment-config/setup` → 201
8. [ ] Test wallet: `POST /api/wallet-payment/initiate` → works
9. [ ] Monitor logs for errors

### Post-Deployment
- [ ] User can signup and configure payment method
- [ ] Wallet token purchase still works
- [ ] No critical errors in logs
- [ ] M-Pesa callbacks processing correctly
- [ ] Monitor for 24 hours

---

## Rollback Plan

If issues arise:

```bash
# 1. Revert migration
npm run db:migrate -- --down

# 2. Restore .env (add back hardcoded variables)
MPESA_SHORTCODE_PAYBILL=...
MPESA_PASSKEY_PAYBILL=...
MPESA_SHORTCODE_TILL=...
MPESA_PASSKEY_TILL=...

# 3. Revert code (git checkout previous version)
git revert <commit>

# 4. Restart server
npm run dev
```

---

## Success Criteria

✅ **Implementation is successful when:**

1. Users signup → get `setupNeeded: true`
2. Users access `/api/payment-config/setup` → configure method
3. Payment config stored in database
4. Wallet token purchase uses paybill 650880 (unchanged)
5. Business customer payment uses per-business config from DB
6. M-Pesa callbacks work for both wallet and business
7. No hardcoded paybill/till in `.env`
8. All existing features work (wallet, sales, stock)
9. No critical errors in logs
10. Security checks pass (auth, authorization, validation)

---

## Notes & Questions

### Design Decisions to Finalize
- [ ] Can business have multiple active payment configs? (currently: 1)
- [ ] What happens when config deactivated? (reject payments or use last active?)
- [ ] Should passkey be encrypted in DB? (recommended: yes)
- [ ] Should config require verification before use? (recommended: yes)
- [ ] Can business delete config or only deactivate? (current: soft delete)

### Future Enhancements
- [ ] Encryption at rest for passkeys
- [ ] Verification process with test transaction
- [ ] Business can manage multiple payment methods
- [ ] Admin dashboard for config management
- [ ] Audit logs for all payment config changes
- [ ] Rate limiting on payment config setup
- [ ] WebSocket updates for real-time status

---

## Sign-Off

- [ ] Code review completed
- [ ] QA testing completed
- [ ] Documentation reviewed
- [ ] All checklist items verified
- [ ] Ready for production deployment

**Status**: Ready for Implementation ✅
