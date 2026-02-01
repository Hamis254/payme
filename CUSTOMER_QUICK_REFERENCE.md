# Customer Management - Quick Reference Guide

**TL;DR**: Store contacts, track purchases, identify repeat customers. 10 endpoints, 4 tables, fully integrated.

---

## API Endpoints (Copy-Paste Ready)

### ✅ Create Customer
```bash
POST /api/customers/:businessId/
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "+254701234567",
  "email": "john@example.com",
  "address": "123 Main St",
  "customer_type": "regular",
  "prefer_sms": true,
  "prefer_email": false
}
```

### 📋 List Customers
```bash
GET /api/customers/:businessId/?limit=20&offset=0&sort_by=created_at&filter_type=regular
```

**Query Parameters**:
- `limit` - 1-100 (default 20)
- `offset` - pagination (default 0)
- `sort_by` - created_at|name|id (default created_at)
- `sort_order` - asc|desc (default desc)
- `filter_type` - walk_in|regular|vip|wholesale (optional)
- `is_active` - true|false (default true)

### 🔍 Search Customers
```bash
GET /api/customers/:businessId/search?q=John&limit=10
```

### 👤 Get Single Customer (with all data)
```bash
GET /api/customers/:businessId/:customerId
```

Returns: customer info + notes + preferences + purchase history

### ✏️ Update Customer
```bash
PATCH /api/customers/:businessId/:customerId
Content-Type: application/json

{
  "name": "Updated Name",
  "customer_type": "vip",
  "prefer_email": true
}
```

### 🗑️ Delete Customer (soft delete)
```bash
DELETE /api/customers/:businessId/:customerId
```

### 📝 Add Note
```bash
POST /api/customers/:businessId/:customerId/notes
Content-Type: application/json

{
  "note_type": "preference",
  "content": "Prefers morning deliveries"
}
```

**note_type**: personal|preference|issue|feedback

### 📖 Get Notes
```bash
GET /api/customers/:businessId/:customerId/notes
```

### ⚙️ Update Preferences
```bash
PATCH /api/customers/:businessId/:customerId/preferences
Content-Type: application/json

{
  "favorite_products": "[1, 5, 8]",
  "preferred_payment": "mpesa",
  "can_receive_offers": true,
  "do_not_contact": false
}
```

### 📊 Get Customer Metrics
```bash
GET /api/customers/:businessId/:customerId/metrics
```

Returns: total purchases, lifetime value, loyalty tier, repeat frequency

### 💳 Get Purchase History
```bash
GET /api/customers/:businessId/:customerId/history?limit=10&offset=0
```

### ⭐ Get Repeat Customers
```bash
GET /api/customers/:businessId/repeat?limit=20&offset=0&min_purchases=2
```

---

## Service Functions (Direct Usage)

```javascript
import {
  createCustomer,
  getCustomer,
  listCustomers,
  searchCustomers,
  updateCustomer,
  deleteCustomer,
  addNote,
  getNotes,
  updatePreferences,
  getPurchaseHistory,
  getCustomerMetrics,
  getRepeatCustomers,
  updatePurchaseHistory, // Called after sale completion
} from '#services/customer.service.js';

// Create
const customer = await createCustomer(businessId, {
  name: 'John',
  phone: '+254701234567'
});

// Get
const customer = await getCustomer(customerId, businessId);

// List
const { customers, total } = await listCustomers(businessId, {
  limit: 20,
  offset: 0,
  filter_type: 'regular'
});

// Search
const results = await searchCustomers(businessId, 'John', 10);

// Update
await updateCustomer(customerId, businessId, {
  customer_type: 'vip'
});

// Delete
await deleteCustomer(customerId, businessId);

// Notes
await addNote(customerId, businessId, {
  note_type: 'preference',
  content: 'Prefers cash only'
});
const notes = await getNotes(customerId, businessId);

// Preferences
await updatePreferences(customerId, businessId, {
  preferred_payment: 'mpesa',
  can_receive_offers: true
});

// Metrics
const metrics = await getCustomerMetrics(customerId, businessId);

// Purchase history
const history = await getPurchaseHistory(customerId, businessId, {
  limit: 10
});

// Repeat customers
const repeat = await getRepeatCustomers(businessId, {
  min_purchases: 2
});

// IMPORTANT: Call after sale completion
await updatePurchaseHistory(customerId, {
  total_amount: 2500,
  items_count: 5
});
```

---

## Integration with Sales

After a sale is completed, update customer purchase history:

```javascript
// In sales.service.js completeSale() function
import { updatePurchaseHistory } from '#services/customer.service.js';

export async function completeSale(saleId) {
  const sale = await getSale(saleId);
  
  // Process payment, update inventory...
  
  // Update customer metrics
  if (sale.customer_id) {
    await updatePurchaseHistory(sale.customer_id, {
      total_amount: sale.total_amount,
      items_count: sale.items.length
    });
  }
}
```

---

## Validation Examples

All inputs are validated with Zod schemas:

### Valid Customer Creation
```javascript
{
  name: "John Doe",                    // Required, 1-255 chars
  phone: "+254701234567",              // Optional, max 20
  email: "john@example.com",           // Optional, valid email
  address: "123 Main St, Nairobi",     // Optional, max 500
  customer_type: "regular",            // Optional: walk_in|regular|vip|wholesale
  prefer_sms: true,                    // Optional, default true
  prefer_email: false,                 // Optional, default false
  prefer_call: false                   // Optional, default false
}
```

### Invalid Inputs (will get 400 error)
```javascript
{ name: "" }                           // Empty name
{ name: "X".repeat(300) }              // Name too long
{ email: "invalid-email" }             // Invalid email
{ phone: "X".repeat(25) }              // Phone too long
```

---

## Response Examples

### Success Response (201 Created)
```json
{
  "message": "Customer created successfully",
  "customer": {
    "id": 1,
    "business_id": 5,
    "name": "John Doe",
    "phone": "+254701234567",
    "email": "john@example.com",
    "customer_type": "regular",
    "is_active": true,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### Error Response (400 Validation Failed)
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "name",
      "message": "Customer name is required"
    }
  ]
}
```

### Error Response (404 Not Found)
```json
{
  "error": "Customer not found"
}
```

---

## Database Schema (Quick View)

**customers**: id, business_id, name, phone, email, address, customer_type, is_active, prefer_sms, prefer_email, prefer_call, created_at, updated_at

**customer_notes**: id, customer_id, business_id, note_type, content, created_by, created_at, updated_at

**customer_preferences**: id, customer_id, business_id, favorite_products, preferred_payment, average_spend, best_contact_time, do_not_contact, can_receive_offers, can_receive_loyalty, created_at, updated_at

**customer_purchase_history**: id, customer_id, business_id, total_purchases, total_spent, total_items_bought, avg_transaction_value, first_purchase_date, last_purchase_date, days_since_last_purchase, is_repeat_customer, repeat_frequency, created_at, updated_at

---

## Customer Classification

Customers are automatically classified by repeat frequency:

| Purchases | Category | Use Case |
|-----------|----------|----------|
| 0 | new | Not yet purchased |
| 1 | one_time | One-time customers |
| 2-4 | occasional | Occasional buyers |
| 5-9 | regular | Regular customers |
| 10+ | frequent | Loyal, frequent buyers |

---

## File Locations

- **Models**: `src/models/customer.model.js` (55 lines)
- **Service**: `src/services/customer.service.js` (560 lines)
- **Controller**: `src/controllers/customer.controller.js` (280 lines)
- **Routes**: `src/routes/customer.routes.js` (50 lines)
- **Validation**: `src/validations/customer.validation.js` (85 lines)
- **Migration**: `drizzle/0015_stiff_quasar.sql`

---

## Common Operations

### Find all VIP customers
```bash
GET /api/customers/:businessId/?filter_type=vip&sort_by=name
```

### Get top spenders (repeat customers sorted by spend)
```bash
GET /api/customers/:businessId/repeat?min_purchases=2&limit=50
```

### Search customer by phone
```bash
GET /api/customers/:businessId/search?q=%2B254701234567
```

### Update customer to VIP after 5 purchases
```bash
PATCH /api/customers/:businessId/:customerId
{
  "customer_type": "vip"
}
```

### Add preference note
```bash
POST /api/customers/:businessId/:customerId/notes
{
  "note_type": "preference",
  "content": "Bulk buyer - interested in wholesale pricing"
}
```

### Track customer loyalty
```bash
GET /api/customers/:businessId/:customerId/metrics
# Response includes: loyalty_tier, repeat_frequency, lifetime_value
```

---

## Authentication

All endpoints require JWT token in cookies:

```bash
Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Token is automatically validated by `authenticateToken` middleware.

---

## Troubleshooting

**"Customer not found"**: 
- Verify customerId and businessId are correct
- Check customer belongs to your business (not another user's)

**"Validation failed"**:
- Check request body matches schema
- Email must be valid format (if provided)
- Phone max 20 chars
- Name min 1, max 255 chars

**Search returns empty**:
- Ensure search term matches name/phone/email
- Phone should include country code (+254...)
- Search is substring match

---

## Production Checklist

- [ ] All endpoints require authentication
- [ ] Validate all inputs with Zod schemas
- [ ] Customer data isolated by business_id
- [ ] Purchase history updated after each sale
- [ ] Soft deletes preserve historical data
- [ ] Error handling logs to Winston
- [ ] Response times under 200ms
- [ ] All indexes created on database
- [ ] Rate limiting via Arcjet
