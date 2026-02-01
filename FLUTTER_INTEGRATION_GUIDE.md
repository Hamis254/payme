# Flutter Integration Quick Start - PayMe API

**For**: Flutter developers integrating with PayMe backend  
**Time to Read**: 5 minutes  
**Status**: Backend ready for integration (with noted caveats)

---

## 1️⃣ API Base Configuration

```dart
class ApiConfig {
  static const String baseUrl = 'https://your-api-url.com';
  // For development:
  // static const String baseUrl = 'http://10.0.2.2:3000'; // Android emulator
  
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 10);
}
```

**Current Environment**: Sandbox (M-Pesa testing)  
**When to Switch to Production**: Update `MPESA_ENV` in backend `.env`

---

## 2️⃣ Authentication Flow

### **Step 1: Signup**
```
POST /api/auth/sign-up
Body: {
  "name": "John Doe",
  "phone_number": "254712345678",  // or 0712345678
  "email": "john@example.com",
  "password": "securepass123"
}

Response: {
  "message": "User registered",
  "setupNeeded": true,
  "setupUrl": "/setup/payment-method",
  "user": { ... }
}
```
✅ **Note**: `setupNeeded: true` tells Flutter to redirect to payment setup screen

### **Step 2: Login**
```
POST /api/auth/sign-in
Body: {
  "email": "john@example.com",
  "password": "securepass123"
}

Response: {
  "message": "User signed in successfully",
  "user": { ... }
}
```
✅ **Token stored in httpOnly cookie** - Dio will auto-include in requests

### **Step 3: Check Auth Status** (NEW - Add if missing)
```
GET /api/auth/me
Headers: Cookie: token=...

Response: {
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "phone_number": "254712345678",
  "role": "user",
  "created_at": "2026-01-20T10:00:00Z"
}
```
⚠️ **Must implement** - Required for splash screen to determine next route

### **Step 4: Logout**
```
POST /api/auth/sign-out
Response: { "message": "User signed out successfully" }
```

---

## 3️⃣ Business Management

### **Create Business**
```
POST /api/businesses
Body: {
  "name": "Nairobi Supermarket",
  "location": "Nairobi CBD",
  "location_description": "Shop #42, Mama Ngina Street",
  "payment_method": "paybill",      // or "till_number" or "wallet"
  "payment_identifier": "950200"    // The till/paybill number
}
```

### **List Businesses**
```
GET /api/businesses
Response: {
  "message": "Businesses retrieved successfully",
  "businesses": [ ... ],
  "count": 2
}
```
⚠️ **No pagination yet** - Will get all businesses (fine for most users)

### **Get Business Details**
```
GET /api/businesses/:businessId
```

### **Update Business**
```
PUT /api/businesses/:businessId
Body: {
  "name": "Updated Name",
  "location": "New Location",
  "payment_method": "till_number",
  "payment_identifier": "123456"
}
```

### **Switch Active Business** (Frontend Pattern)
```dart
final selectedBusinessProvider = StateProvider<Business?>((ref) => null);

// When user taps business:
ref.read(selectedBusinessProvider.notifier).state = selectedBusiness;
// All subsequent API calls use businessId from this provider
```

---

## 4️⃣ Payment Configuration (NEW)

⚠️ **Important**: This is newly implemented - verify in backend before using

### **Setup Payment Method** (Post-signup)
```
POST /api/payment-config/setup
Body: {
  "business_id": 1,
  "payment_method": "paybill",      // "till" or "paybill"
  "shortcode": "950200",
  "passkey": "bfb279f9aa9bdbcf158e97dd1a2c6f6f91",
  "account_reference": "SHOP01",     // Max 12 chars
  "account_name": "Main Paybill"
}

Response: {
  "message": "Payment config created",
  "config": { ... }
}
```

### **Get Payment Config**
```
GET /api/payment-config/:businessId
```

### **Update Payment Config**
```
PATCH /api/payment-config/:configId
Body: { "shortcode": "new_shortcode", ... }
```

### **Enable/Disable Payment Method**
```
POST /api/payment-config/:configId/toggle
```

---

## 5️⃣ Inventory Management

### **Create Product**
```
POST /api/stock/products
Body: {
  "business_id": 1,
  "name": "Coca Cola 500ml",
  "base_price": 100.00,
  "low_stock_threshold": 10
}
```

### **List Products**
```
GET /api/stock/products/business/:businessId
Response: { "products": [ ... ], "count": 25 }
```
⚠️ **No pagination yet** - Will get all products

### **Get Product Details**
```
GET /api/stock/products/:productId
```

### **Update Product**
```
PUT /api/stock/products/:productId
Body: { "name": "...", "base_price": 100.00 }
```

### **Add Stock (FIFO)**
```
POST /api/stock/add
Body: {
  "product_id": 5,
  "quantity": 50,
  "unit_cost": 60.00,    // Cost per unit when purchased
  "supplier": "Supplier Name",
  "notes": "New batch"
}

Response: {
  "message": "Stock added",
  "batch": {
    "id": 123,
    "product_id": 5,
    "quantity_added": 50,
    "current_stock": 150   // Total stock now
  }
}
```

### **Get Inventory Summary**
```
GET /api/stock/inventory/business/:businessId
Response: {
  "products": [
    {
      "product_id": 5,
      "name": "Coca Cola 500ml",
      "total_stock": 150,
      "stock_value": 9000.00,   // At current cost
      "low_stock": false
    }
  ]
}
```

### **Record Spoilage**
```
POST /api/spoiled-stock
Body: {
  "business_id": 1,
  "product_id": 5,
  "quantity": 3,
  "reason": "expired",  // or "damaged", "theft", etc.
  "notes": "Bottle damaged during transport"
}
```

---

## 6️⃣ Sales & Payment

### **Create Sale**
```
POST /api/sales
Body: {
  "business_id": 1,
  "customer_name": "Jane Smith",
  "payment_mode": "cash",           // or "m-pesa"
  "customer_type": "retail",        // or "wholesale", "credit"
  "items": [
    {
      "product_id": 5,
      "quantity": 2,
      "unit_price": 100.00,
      "unit_cost": 60.00             // For profit calculation
    },
    {
      "product_id": 10,
      "quantity": 1,
      "unit_price": 500.00,
      "unit_cost": 300.00
    }
  ],
  "note": "Regular customer"
}

Response: {
  "sale": {
    "id": 42,
    "business_id": 1,
    "total_amount": 700.00,
    "total_profit": 160.00,
    "status": "pending",
    "items": [ ... ]
  }
}
```
✅ **Tokens deducted on creation** (1 token = 1 transaction)  
✅ **Stock NOT deducted yet** - Only deducted on payment completion

### **Pay with Cash**
```
POST /api/sales/:saleId/pay/cash
Body: {
  "amount_paid": 700.00,
  "change_given": 0
}

Response: {
  "message": "Payment processed",
  "sale": {
    "id": 42,
    "status": "completed",
    "items_deducted": true
  }
}
```
✅ **Stock deducted using FIFO** on completion

### **Pay with M-Pesa (STK Push)**
```
POST /api/sales/:saleId/pay/mpesa
Body: {
  "customer_phone": "254712345678"  // Customer's phone number
}

Response: {
  "message": "STK push initiated",
  "sale_id": 42,
  "status": "awaiting_payment",
  "stk_initiated": true,
  "customer_phone": "254712345678"
}
```

✅ **Callback from Safaricom** (`POST /api/sales/mpesa/callback`) updates sale status  
✅ **Stock deducted when callback confirms payment**

### **Check Sale Status**
```
GET /api/sales/:saleId
Response: {
  "id": 42,
  "status": "completed",        // pending, completed, cancelled
  "payment_status": "paid",
  "total_amount": 700.00,
  "items_deducted": true,
  "created_at": "2026-01-20T15:30:00Z"
}
```

### **Cancel Sale (if pending)**
```
POST /api/sales/:saleId/cancel
Response: {
  "message": "Sale cancelled",
  "refund": {
    "tokens": 1,
    "amount": 0
  }
}
```
✅ **Tokens refunded** if payment not yet completed

### **Get Sales History**
```
GET /api/sales/business/:businessId
Response: {
  "sales": [ ... ],
  "count": 47,
  "total_revenue": 125000.00
}
```

---

## 7️⃣ Wallet & Token Purchases

### **Get Wallet Balance**
```
GET /api/wallet/business/:businessId
Response: {
  "business_id": 1,
  "token_balance": 145,
  "wallet_balance": 290.00,         // KES equivalent (1 token = 2 KES)
  "last_transaction": "2026-01-20T15:30:00Z"
}
```

### **Get Available Token Packages**
```
GET /api/wallet/packages
Response: {
  "packages": [
    {
      "id": 1,
      "tokens": 10,
      "price": 20.00,
      "discount": 0,
      "discount_percentage": 0
    },
    {
      "id": 2,
      "tokens": 30,
      "price": 50.00,
      "discount": 10,
      "discount_percentage": 17
    }
  ]
}
```

### **Purchase Tokens (STK Push)**
```
POST /api/wallet/purchase
Body: {
  "business_id": 1,
  "package_id": 2,                  // Selects 30 tokens for KSH 50
  "customer_phone": "254712345678"
}

Response: {
  "message": "STK push initiated for token purchase",
  "wallet_transaction": {
    "id": 100,
    "status": "pending",
    "tokens_requested": 30,
    "amount": 50.00,
    "customer_phone": "254712345678"
  }
}
```
✅ **Uses fixed paybill 650880** (system wallet)  
✅ **Callback adds tokens to wallet on success**

### **Get Transaction History**
```
GET /api/wallet/business/:businessId/transactions
Response: {
  "transactions": [
    {
      "id": 100,
      "type": "purchase",            // reserve, charge, refund, purchase
      "change_tokens": 30,
      "previous_balance": 115,
      "new_balance": 145,
      "reference": "TOK_PURCHASE_100",
      "timestamp": "2026-01-20T15:30:00Z"
    },
    {
      "id": 99,
      "type": "reserve",
      "change_tokens": -1,
      "reference": "SALE_42",
      "timestamp": "2026-01-20T15:29:00Z"
    }
  ]
}
```

---

## 8️⃣ Credit Management

### **Create Credit Account**
```
POST /api/credit
Body: {
  "business_id": 1,
  "customer_name": "John Smith",
  "phone_number": "254712345678",
  "email": "john@example.com",
  "credit_limit": 5000.00,
  "max_days_overdue": 30
}
```

### **List Credit Accounts**
```
GET /api/credit/accounts
Response: {
  "accounts": [
    {
      "id": 1,
      "customer_name": "John Smith",
      "credit_limit": 5000.00,
      "outstanding_balance": 1200.00,
      "utilization": 24,              // Percentage
      "is_overdue": false,
      "days_overdue": 0,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ]
}
```

### **Get Credit Account Details**
```
GET /api/credit/accounts/:accountId
Response: {
  "account": { ... },
  "transactions": [ ... ]  // Payment history
}
```

### **Record Credit Payment**
```
PATCH /api/credit/accounts/:accountId
Body: {
  "amount_paid": 500.00
}

Response: {
  "message": "Payment recorded",
  "account": {
    "outstanding_balance": 700.00,
    "utilization": 14
  }
}
```

---

## 9️⃣ Hire Purchase / Installments

### **Create Hire Purchase Agreement**
```
POST /api/higher-purchase/:businessId/create
Body: {
  "customer_name": "Jane Doe",
  "item_name": "iPhone 14",
  "total_price": 50000.00,
  "down_payment": 10000.00,
  "payment_schedule": "monthly",    // monthly, weekly, daily
  "number_of_installments": 12,
  "first_payment_date": "2026-02-01"
}
```

### **List Hire Purchase Agreements**
```
GET /api/higher-purchase/:businessId
Response: {
  "agreements": [
    {
      "id": 1,
      "customer_name": "Jane Doe",
      "item_name": "iPhone 14",
      "total_price": 50000.00,
      "amount_paid": 15000.00,
      "outstanding": 35000.00,
      "next_payment_due": "2026-02-01",
      "status": "active"
    }
  ]
}
```

### **Record HP Payment**
```
POST /api/higher-purchase/:businessId/:agreementId/payment
Body: {
  "amount_paid": 3500.00,
  "payment_date": "2026-01-25",
  "payment_method": "cash"           // cash, m-pesa, check
}
```

---

## 🔟 Expense Tracking

### **Record Expense**
```
POST /api/expense/:businessId/record
Body: {
  "category": "transport",           // rent, utilities, salaries, transport, etc.
  "description": "Delivery to customers",
  "amount": 500.00,
  "expense_date": "2026-01-20",
  "payment_method": "cash",
  "notes": "Delivered 5 orders"
}
```

### **List Expenses**
```
GET /api/expense/:businessId
Response: {
  "expenses": [ ... ],
  "total": 2500.00
}
```

### **Get Expense Summary**
```
GET /api/expense/:businessId/summary
Response: {
  "total_expenses": 2500.00,
  "by_category": {
    "transport": 500.00,
    "rent": 2000.00
  },
  "expense_count": 2
}
```

---

## Data Models (Dart)

### **Core Models to Implement**

```dart
class User {
  final int id;
  final String name;
  final String phoneNumber;
  final String email;
  final String role;
  
  User.fromJson(Map<String, dynamic> json)
    : id = json['id'],
      name = json['name'],
      phoneNumber = json['phone_number'],
      email = json['email'],
      role = json['role'];
}

class Business {
  final int id;
  final String name;
  final String location;
  final String paymentMethod;
  final String paymentIdentifier;
  final bool verified;
  
  Business.fromJson(Map<String, dynamic> json)
    : id = json['id'],
      name = json['name'],
      location = json['location'],
      paymentMethod = json['payment_method'],
      paymentIdentifier = json['payment_identifier'],
      verified = json['verified'];
}

class Product {
  final int id;
  final String name;
  final double basePrice;
  final int currentStock;
  
  Product.fromJson(Map<String, dynamic> json)
    : id = json['id'],
      name = json['name'],
      basePrice = (json['base_price'] as num).toDouble(),
      currentStock = json['current_stock'];
}

class Sale {
  final int id;
  final double totalAmount;
  final String status;  // pending, completed, cancelled
  final List<SaleItem> items;
  
  Sale.fromJson(Map<String, dynamic> json)
    : id = json['id'],
      totalAmount = (json['total_amount'] as num).toDouble(),
      status = json['status'],
      items = (json['items'] as List)
          .map((i) => SaleItem.fromJson(i))
          .toList();
}

class Wallet {
  final int tokenBalance;
  final double walletBalance;
  
  Wallet.fromJson(Map<String, dynamic> json)
    : tokenBalance = json['token_balance'],
      walletBalance = (json['wallet_balance'] as num).toDouble();
}
```

---

## Error Handling

### **Common Error Codes**

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad request (validation) | Show error message to user |
| 401 | Unauthorized (token invalid) | Redirect to login |
| 403 | Forbidden (not business owner) | Show "access denied" |
| 404 | Not found | Handle gracefully |
| 409 | Conflict (email exists) | Tell user to use different email |
| 422 | Unprocessable (insufficient stock) | Show specific message |
| 500 | Server error | Show "server error" & log |

### **Standard Error Response**
```json
{
  "error": "Validation failed",
  "details": {
    "phone_number": "Invalid Kenyan phone number"
  }
}
```

---

## Testing Checklist

Before deploying Flutter app:

- [ ] **Auth**: Signup → Login → Get me → Logout
- [ ] **Business**: Create → List → Get → Update
- [ ] **Stock**: Add product → Add stock → List inventory
- [ ] **Sales**: Create sale → Pay with cash → Check stock deducted
- [ ] **M-Pesa**: Create sale → Pay with M-Pesa → Check callback updates sale
- [ ] **Wallet**: Get balance → Buy tokens → Check balance updated
- [ ] **Credit**: Create account → Record payment → Check balance
- [ ] **Error Cases**:
  - [ ] Insufficient stock → Error message
  - [ ] Insufficient tokens → Can't create sale
  - [ ] Invalid token → Redirect to login
  - [ ] Unknown business → 403 error

---

## Backend Setup (for reference)

```bash
# Install dependencies
npm install

# Create .env file (ask backend team for values)
# Required: DATABASE_URL, JWT_SECRET, MPESA_*, ARCJET_KEY

# Run migrations
npm run db:migrate

# Start server
npm run dev

# Test health endpoint
curl http://localhost:3000/health
```

---

## Important Notes

⚠️ **M-Pesa Sandbox**: Uses shared test credentials  
⚠️ **Phone Numbers**: Must be valid Kenyan format (0712345678 or +254712345678)  
⚠️ **Tokens**: 1 token ≈ KES 2  
⚠️ **FIFO Stock**: Deduction uses oldest batches first (for accurate profit)  
⚠️ **Payment Config**: Each business must setup before M-Pesa payments work  

---

## Support

For backend issues:
1. Check error logs: `logs/combined.log`
2. Check database state in Drizzle Studio: `npm run db:studio`
3. Test endpoint with Postman or cURL
4. Review BACKEND_ANALYSIS_ISSUES.md for known issues

