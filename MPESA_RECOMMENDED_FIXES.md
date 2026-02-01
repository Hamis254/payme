# M-Pesa Integration - Recommended Fixes (Code Ready)

## Fix #1: Remove or Fix `/api/payme` Endpoint

### Option A: DELETE (Recommended) ✅

**Step 1:** Delete files
```bash
rm src/controllers/payme.controller.js
rm src/routes/payme.routes.js
rm src/validations/payme.validation.js
```

**Step 2:** Update `src/app.js`
Remove these lines (around line 12-13):
```javascript
// DELETE THESE LINES:
// import paymeRoutes from '#routes/payme.routes.js';
// ...
// app.use('/api/payme', paymeRoutes);
```

**Step 3:** Update `package.json` scripts (if any payme-specific tests exist)
Remove any payme-related test commands.

**Benefits:**
- ✅ No code duplication
- ✅ No confusion about which endpoint to use
- ✅ Single source of truth: `/api/sales` flow
- ✅ Saves maintenance burden

---

### Option B: Fix It (If you want to keep it)

Replace `src/controllers/payme.controller.js` - `processPayMe()` function:

```javascript
import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import { paymeSchema } from '#validations/payme.validation.js';
import { createSale } from '#services/sales.service.js';
import { getPaymentConfig } from '#services/paymentConfig.service.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';
import { db } from '#config/database.js';
import { sales } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { eq } from 'drizzle-orm';

/**
 * FIXED: processPayMe - Now properly handles M-Pesa payments
 * This endpoint is now equivalent to the /api/sales flow but in a single call
 */
export const processPayMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = paymeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const {
      business_id,
      items,
      payment_mode,
      customer_phone,
      customer_type,
      note,
    } = validationResult.data;

    // For M-Pesa, validate payment config EXISTS before creating sale
    if (payment_mode === 'mpesa') {
      if (!customer_phone) {
        return res.status(400).json({
          error: 'Customer phone number is required for M-Pesa payment',
        });
      }

      const paymentConfig = await getPaymentConfig(business_id);
      if (!paymentConfig) {
        return res.status(400).json({
          error: 'Payment configuration not found',
          hint: 'Please setup your M-Pesa payment method first',
          setupUrl: '/api/payment-config/setup',
        });
      }
      if (!paymentConfig.is_active) {
        return res.status(400).json({
          error: 'Payment configuration is inactive',
          hint: 'Please activate or reconfigure your M-Pesa credentials',
        });
      }
    }

    // Create sale (using sales.service.js)
    const result = await createSale(
      req.user.id,
      business_id,
      items,
      payment_mode,
      {
        customer_phone,
        customer_type,
        note,
      }
    );

    const response = {
      message:
        payment_mode === 'cash'
          ? 'Sale completed successfully'
          : 'Sale created, initiating M-Pesa payment',
      sale: result.sale,
      items: result.items,
      summary: result.summary,
    };

    // If M-Pesa, immediately initiate STK push
    if (payment_mode === 'mpesa') {
      try {
        const paymentConfig = await getPaymentConfig(business_id);

        const mpesaResp = await initiateBusinessPayment({
          paymentConfig,
          phone: customer_phone,
          amount: result.summary.total_amount,
          description: `PAYME Sale #${result.sale.id}`,
        });

        // Store STK request ID
        await db
          .update(sales)
          .set({
            stk_request_id: mpesaResp.CheckoutRequestID || null,
            payment_status: 'initiated',
            updated_at: new Date(),
          })
          .where(eq(sales.id, result.sale.id));

        // Store payment initiation
        await db.insert(payments).values({
          sale_id: result.sale.id,
          stk_request_id: mpesaResp.CheckoutRequestID || null,
          phone: customer_phone,
          amount: result.summary.total_amount,
          status: 'initiated',
          callback_payload: JSON.stringify(mpesaResp),
          created_at: new Date(),
        });

        response.mpesa = {
          status: 'initiated',  // FIXED: was 'pending'
          checkoutRequestId: mpesaResp.CheckoutRequestID,
          customer_message: mpesaResp.CustomerMessage,
          amount: result.summary.total_amount,
        };

        logger.info(`M-Pesa STK initiated for sale ${result.sale.id}`, {
          checkoutRequestId: mpesaResp.CheckoutRequestID,
        });
      } catch (mpesaError) {
        logger.error('Failed to initiate M-Pesa payment', mpesaError);
        // Sale is created but M-Pesa failed - don't complete sale
        throw mpesaError;
      }
    }

    res.status(201).json(response);
  } catch (e) {
    logger.error('Error processing PayMe', e);

    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message === 'Payment configuration not found') {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes('Insufficient') || e.message.includes('stock')) {
      return res.status(400).json({ error: e.message });
    }

    next(e);
  }
};
```

**Changes Made:**
- ✅ Validates payment config exists BEFORE creating sale
- ✅ Checks config is active
- ✅ Immediately initiates STK push on successful sale creation
- ✅ Stores STK request ID in database
- ✅ Returns checkoutRequestId to frontend
- ✅ Proper error handling if M-Pesa fails
- ✅ Clear distinction between pending and initiated states

---

## Fix #2: Remove Fallback to Wallet Paybill

**File:** `src/utils/mpesa.js`  
**Function:** `initiateBusinessPayment()`

Replace lines 140-149:

```javascript
// BEFORE (RISKY):
export const initiateBusinessPayment = async ({ paymentConfig, phone, amount, description }) => {
  try {
    // ... validation code ...

    const businessShortCode = paymentConfig?.shortcode || WALLET_PAYBILL;  // ❌ FALLBACK
    const passKey = paymentConfig?.passkey || process.env.MPESA_PASSKEY;
    const accountRef = paymentConfig?.account_reference || WALLET_ACCOUNT_REFERENCE;

    if (!passKey) {
      throw new Error('Missing passkey: configure in payment settings or set MPESA_PASSKEY');
    }

    // ... rest of code
```

```javascript
// AFTER (SAFE):
export const initiateBusinessPayment = async ({ paymentConfig, phone, amount, description }) => {
  try {
    if (!phone || !amount || !description) {
      throw new Error('Missing required parameters: phone, amount, description');
    }

    // ✅ STRICT: No fallback allowed
    if (!paymentConfig) {
      throw new Error(
        'Business payment configuration is required. ' +
        'No fallback to wallet paybill. ' +
        'Please setup your M-Pesa credentials first.'
      );
    }

    if (!paymentConfig.is_active) {
      throw new Error('Payment configuration is inactive. Please activate in settings.');
    }

    if (!paymentConfig.shortcode || !paymentConfig.passkey || !paymentConfig.account_reference) {
      throw new Error('Payment configuration is incomplete. Please reconfigure.');
    }

    const accessToken = await getAccessToken();

    // ✅ No fallbacks - use config values directly
    const businessShortCode = paymentConfig.shortcode;
    const passKey = paymentConfig.passkey;
    const accountRef = paymentConfig.account_reference;

    const { password, timestamp } = buildMpesaPassword(businessShortCode, passKey);

    const payload = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: paymentConfig.payment_method === 'till_number'
        ? 'CustomerBuyGoodsOnline'
        : 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: businessShortCode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: description,
    };

    logger.info('Initiating business payment STK push', {
      businessShortCode,
      paymentMethod: paymentConfig.payment_method,
      amount,
      configVerified: paymentConfig.verified,
    });

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode, ResponseDescription, CheckoutRequestID, CustomerMessage } = response.data;

    if (ResponseCode === '0') {
      logger.info('Business payment STK push initiated', {
        checkoutRequestId: CheckoutRequestID,
        businessShortCode,
      });
      return {
        success: true,
        CheckoutRequestID,
        ResponseCode,
        ResponseDescription,
        CustomerMessage,
      };
    } else {
      throw new Error(`M-Pesa error: ${ResponseCode} - ${ResponseDescription || CustomerMessage}`);
    }
  } catch (e) {
    logger.error('Business payment STK push failed', {
      error: e.message,
      configExists: !!paymentConfig,
      configActive: paymentConfig?.is_active,
    });
    throw e;
  }
};
```

---

## Fix #3: Add Payment Config Validation to Sales Controller

**File:** `src/controllers/sales.controller.js`  
**Function:** `payMpesaHandler()`

Add validation at line 289 (after getting paymentConfig):

```javascript
// BEFORE (INCOMPLETE):
const paymentConfig = await getPaymentConfig(sale.business_id);

if (!paymentConfig) {
  return res.status(400).json({
    error: 'Payment configuration not found. Please setup your M-Pesa credentials first.',
    hint: 'Configure your paybill or till number in the payment settings',
  });
}

if (!paymentConfig.is_active) {
  return res.status(400).json({
    error: 'Payment configuration is inactive. Please activate or reconfigure your M-Pesa credentials.',
  });
}

// ... continues to initiate payment
```

```javascript
// AFTER (ENHANCED):
const paymentConfig = await getPaymentConfig(sale.business_id);

// Validation 1: Config exists
if (!paymentConfig) {
  logger.warn('Payment config not found for sale', {
    saleId,
    businessId: sale.business_id,
    userId: req.user.id,
  });
  return res.status(400).json({
    error: 'Payment configuration not found',
    hint: 'Please setup your M-Pesa payment method',
    setupUrl: '/api/payment-config/setup',
  });
}

// Validation 2: Config is active
if (!paymentConfig.is_active) {
  logger.warn('Payment config inactive for sale', {
    saleId,
    configId: paymentConfig.id,
  });
  return res.status(400).json({
    error: 'Payment configuration is inactive',
    hint: 'Please enable your M-Pesa configuration in settings',
  });
}

// Validation 3: Config is complete (all fields present)
if (!paymentConfig.shortcode || !paymentConfig.passkey || !paymentConfig.account_reference) {
  logger.error('Payment config incomplete for sale', {
    saleId,
    configId: paymentConfig.id,
    hasShortcode: !!paymentConfig.shortcode,
    hasPasskey: !!paymentConfig.passkey,
    hasAccountRef: !!paymentConfig.account_reference,
  });
  return res.status(500).json({
    error: 'Payment configuration is incomplete',
    hint: 'Please reconfigure your M-Pesa credentials',
  });
}

// Validation 4: Config is verified (optional but recommended)
if (!paymentConfig.verified) {
  logger.warn('Payment config not verified for sale', {
    saleId,
    configId: paymentConfig.id,
    hint: 'Payment may fail if credentials are invalid',
  });
  // Don't block - but log warning
  // Optional: return warning in response
}

// ✅ All validations passed - proceed with STK push
try {
  const mpesaResp = await initiateBusinessPayment({
    paymentConfig,
    phone,
    amount: Number(sale.sale.total_amount),
    description: description || `PAYME Sale #${saleId}`,
  });

  // ... rest of success handling
} catch (mpesaError) {
  logger.error('M-Pesa initialization failed for sale', {
    saleId,
    error: mpesaError.message,
    configId: paymentConfig.id,
  });

  // Provide helpful error message
  if (mpesaError.message.includes('credentials')) {
    return res.status(400).json({
      error: 'Payment credentials are invalid',
      hint: 'Please reconfigure your M-Pesa settings',
    });
  }

  return res.status(500).json({
    error: 'Failed to initiate payment',
    message: mpesaError.message,
  });
}
```

---

## Fix #4: Add Config Verification Endpoint

**File:** `src/services/paymentConfig.service.js`

Add new function:

```javascript
import axios from 'axios';
import base64 from 'base-64';

/**
 * Verify payment configuration by testing with M-Pesa Daraja
 * @param {number} configId - Payment config ID
 * @returns {Promise<boolean>} True if verified
 */
export const verifyPaymentConfig = async (configId) => {
  try {
    const config = await getPaymentConfigById(configId);

    if (!config) {
      throw new Error('Configuration not found');
    }

    // Get M-Pesa access token
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error('M-Pesa credentials not configured');
    }

    const auth = base64.encode(`${consumerKey}:${consumerSecret}`);

    const tokenResponse = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Build test password
    const timestamp = new Date()
      .toISOString()
      .replace(/[:-]/g, '')
      .slice(0, 14);
    const password = base64.encode(
      `${config.shortcode}${config.passkey}${timestamp}`
    );

    // Test STK Push with minimal amount
    const testPayload = {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType:
        config.payment_method === 'till_number'
          ? 'CustomerBuyGoodsOnline'
          : 'CustomerPayBillOnline',
      Amount: 1, // Test with 1 KSH
      PartyA: '254712345678', // Test phone
      PartyB: config.shortcode,
      PhoneNumber: '254712345678',
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: config.account_reference,
      TransactionDesc: 'CONFIG_VERIFICATION_TEST',
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      testPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode } = response.data;

    if (ResponseCode === '0') {
      // ✅ Credentials are valid
      await db
        .update(paymentConfigs)
        .set({
          verified: true,
          updated_at: new Date(),
        })
        .where(eq(paymentConfigs.id, configId));

      logger.info('Payment config verified', { configId });
      return true;
    } else {
      throw new Error(
        `M-Pesa test failed: ${response.data.ResponseDescription || response.data.ResponseCode}`
      );
    }
  } catch (e) {
    logger.error('Payment config verification failed', {
      configId,
      error: e.message,
    });
    throw e;
  }
};
```

**File:** `src/controllers/paymentConfig.controller.js`

Add new handler:

```javascript
/**
 * POST /api/payment-config/:configId/verify
 * Verify payment configuration works with M-Pesa
 */
export const verifyPaymentConfigHandler = async (req, res, next) => {
  try {
    const { configId } = req.params;
    const userId = req.user?.id;

    if (!configId || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Verify user owns this config's business
    const config = await getPaymentConfigById(parseInt(configId));

    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    // Check business ownership
    const business = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, config.business_id), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business || business.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Verify config
    await verifyPaymentConfig(parseInt(configId));

    res.status(200).json({
      success: true,
      message: 'Payment configuration verified successfully',
      config: {
        id: config.id,
        verified: true,
        payment_method: config.payment_method,
        shortcode: config.shortcode,
      },
    });
  } catch (e) {
    logger.error('Error verifying payment config', e);

    if (e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }

    if (e.message.includes('credentials')) {
      return res.status(400).json({
        error: 'Invalid M-Pesa credentials',
        message: e.message,
      });
    }

    res.status(400).json({
      error: 'Verification failed',
      message: e.message,
    });
  }
};
```

**File:** `src/routes/paymentConfig.routes.js`

Add route:

```javascript
/**
 * POST /api/payment-config/:configId/verify
 * Verify payment configuration credentials
 */
router.post('/:configId/verify', verifyPaymentConfigHandler);
```

---

## Fix #5: Enhanced Error Handling in Sales Controller

**File:** `src/controllers/sales.controller.js`  
**Function:** `payMpesaHandler()` - Error handling section

```javascript
// BEFORE:
} catch (e) {
  logger.error('Error initiating M-Pesa payment', e);
  next(e);
}

// AFTER:
} catch (e) {
  logger.error('Error initiating M-Pesa payment', {
    error: e.message,
    saleId,
    userId: req.user.id,
  });

  // Handle specific errors with helpful messages
  if (e.message.includes('configuration')) {
    return res.status(400).json({
      error: 'Payment configuration error',
      message: 'Please setup or reconfigure your M-Pesa credentials',
      setupUrl: '/api/payment-config/setup',
    });
  }

  if (e.message.includes('credentials')) {
    return res.status(400).json({
      error: 'Invalid payment credentials',
      message: 'Your M-Pesa credentials are invalid',
      action: 'Please reconfigure in payment settings',
    });
  }

  if (e.message.includes('timeout')) {
    return res.status(503).json({
      error: 'Safaricom service unavailable',
      message: 'M-Pesa service is temporarily unavailable. Please try again.',
    });
  }

  // Default error
  next(e);
}
```

---

## Summary of Changes

| Fix # | File | Change Type | Priority |
|-------|------|------------|----------|
| 1 | payme.* | Delete or rewrite | CRITICAL |
| 2 | mpesa.js | Remove fallback | CRITICAL |
| 3 | sales.controller.js | Add validation | HIGH |
| 4 | paymentConfig.* | Add verify endpoint | MEDIUM |
| 5 | sales.controller.js | Better errors | MEDIUM |

**Total Implementation Time:** ~3 hours

**Testing Time:** ~2 hours

**Total:** ~5 hours to production-ready M-Pesa integration
